import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CirculatorySystem } from '../event-bus';
import { ToolRegistry, Tool } from '../tools';
import { MemoryStore } from '../memory';
import { MCPClient, loadMCPConfigs } from '../mcp';

export class AgentLoop {
  private bus: CirculatorySystem;
  private memory: MemoryStore;
  private running = false;
  private mcpClients: MCPClient[] = [];
  private daemonTimer: ReturnType<typeof setInterval> | null = null;

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

  // 后台无人值守调度器：每 30 秒检查 tasks.json 执行未完成任务
  public startDaemonLoop(intervalMs = 30000): void {
    if (this.daemonTimer) return;
    this.daemonTimer = setInterval(async () => {
      if (this.running) return;
      try {
        const taskFile = path.join(os.homedir(), '.nova', 'tasks.json');
        if (!fs.existsSync(taskFile)) return;
        const tasks = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
        const pendingTask = tasks.find((t: any) => !t.done);
        if (!pendingTask) return;

        console.log(`\n[守护进程] 💡 发现挂起任务: ${pendingTask.content}`);
        this.bus.pulse('hormone:shift', { type: 'adrenaline', level: 0.4, source: 'Daemon' }, 'AgentLoop');
        await this.execute(pendingTask.content);
        pendingTask.done = true;
        pendingTask.completed = Date.now();
        fs.writeFileSync(taskFile, JSON.stringify(tasks, null, 2), 'utf-8');
      } catch (err) {
        this.bus.pulse('system:error', { error: `Daemon调度失败: ${err}` }, 'AgentLoop');
      }
    }, intervalMs);
    console.log(`  ⚙ 后台守护调度器已并网，轮询: ${intervalMs}ms`);
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
        resolve('Agent 长考超时熔断保护，请精简需求重试。');
      }, 300000);
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
