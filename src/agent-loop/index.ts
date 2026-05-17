import { CirculatorySystem } from '../event-bus';
import { ToolRegistry, Tool } from '../tools';
import { MemoryStore } from '../memory';
import { MCPClient, loadMCPConfigs } from '../mcp';

export class AgentLoop {
  private bus: CirculatorySystem;
  private memory: MemoryStore;
  private running = false;
  private mcpClients: MCPClient[] = [];

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.memory = new MemoryStore();
    this.loadMCPTools();
  }

  private async loadMCPTools(): Promise<void> {
    const configs = loadMCPConfigs();
    const servers = Object.entries(configs);

    if (servers.length === 0) return;

    console.log(`  🔌 Loading ${servers.length} MCP server(s)...`);

    for (const [name, cfg] of servers) {
      try {
        const client = new MCPClient(name, cfg);
        await client.connect();
        const mcpTools = client.getTools();

        for (const tool of mcpTools) {
          ToolRegistry.register(tool);
          this.registerToolWithSystem(tool);
        }

        this.mcpClients.push(client);
        console.log(`  ✓ MCP/${name}: ${mcpTools.length} tools loaded`);
      } catch (err) {
        console.log(`  ✗ MCP/${name}: failed - ${err}`);
      }
    }
  }

  private registerToolWithSystem(tool: Tool): void {
    this.bus.pulse('tool:register', {
      name: tool.name,
      description: tool.description,
      handler: async (args: string) => {
        const parsed = JSON.parse(args);
        return tool.execute(parsed);
      },
      usageCount: 0,
      successRate: 1.0
    } as never, 'AgentLoop');
  }

  async execute(objective: string): Promise<string> {
    if (this.running) return 'Agent is already running';
    this.running = true;
    this.bus.pulse('agent:status', { type: 'thinking', turn: 1 }, 'AgentLoop');

    this.bus.pulse('agent:prompt', {
      text: `[Objective]\n${objective}\n\nUse tools as needed. Reply with FINAL: when done.`
    }, 'AgentLoop');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.bus.removeListener('agent:response', handler);
        this.running = false;
        resolve('Agent response timeout');
      }, 120000);

      const handler = (event: any) => {
        if (event.origin === 'NervousSystem') {
          clearTimeout(timeout);
          this.running = false;
          this.bus.pulse('agent:status', { type: 'complete' }, 'AgentLoop');
          resolve(event.payload?.response || 'No response');
        }
      };
      this.bus.on('agent:response', handler);
    });
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  getMemory(): MemoryStore {
    return this.memory;
  }
}
