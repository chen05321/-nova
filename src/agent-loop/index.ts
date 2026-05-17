import { CirculatorySystem } from '../event-bus';
import { NervousSystem } from '../nervous-system';
import { getBuiltinTools, Tool } from '../tools';
import { MemoryStore } from '../memory';
import { MCPClient, loadMCPConfigs } from '../mcp';

interface TurnResult {
  thought: string;
  action?: { tool: string; args: Record<string, string> };
  observation?: string;
  completed: boolean;
  maxTurns: number;
}

export class AgentLoop {
  private bus: CirculatorySystem;
  private tools: Map<string, Tool> = new Map();
  private memory: MemoryStore;
  private turnCount = 0;
  private readonly maxTurns = 50;
  private running = false;

  private mcpClients: MCPClient[] = [];

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.memory = new MemoryStore();

    for (const tool of getBuiltinTools()) {
      this.tools.set(tool.name, tool);
      this.registerToolWithSystem(tool);
    }

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
          this.tools.set(tool.name, tool);
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

  private buildSystemPrompt(objective: string): string {
    const facts = this.memory.getFacts().slice(0, 5);
    const factBlock = facts.length > 0
      ? `\nKnown facts:\n${facts.map(f => `- ${f.content} (confidence: ${(f.confidence * 100).toFixed(0)}%)`).join('\n')}`
      : '';

    const toolsDesc = Array.from(this.tools.values()).map(t =>
      `  - ${t.name}: ${t.description}`
    ).join('\n');

    return `You are Nova, an autonomous AI agent. Your current objective is: ${objective}

Available tools:${toolsDesc}

To use a tool, respond with:
TOOL: tool_name
ARGS: {"key": "value"}

To give your final answer, respond with:
FINAL: your answer

You can use tools multiple times. Think step by step.${factBlock}

Rules:
- Complete the objective as efficiently as possible
- If a tool fails, try another approach
- Use shell for file operations, web for fetching URLs, read/write for file I/O`;
  }

  private async think(thought: string): Promise<TurnResult> {
    const response = await this.getLLMResponse(thought);
    return this.parseResponse(response);
  }

  private async getLLMResponse(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('LLM timeout')), 60000);

      const handler = (event: any) => {
        if (event.origin === 'NervousSystem') {
          clearTimeout(timeout);
          this.bus.removeListener('agent:chunk', chunkHandler);
          this.bus.removeListener('agent:response', handler);
          resolve(event.payload?.response || '');
        }
      };

      const chunkHandler = (event: any) => {
        if (event.origin === 'NervousSystem' && event.payload?.chunk) {
          this.bus.pulse('thought:chunk', { chunk: event.payload.chunk }, 'AgentLoop');
        }
      };

      this.bus.on('agent:chunk', chunkHandler);
      this.bus.on('agent:response', handler);
      this.bus.pulse('agent:prompt', { text: message }, 'AgentLoop');
    });
  }

  private parseResponse(response: string): TurnResult {
    const toolMatch = response.match(/TOOL:\s*(\w+)\s*\nARGS:\s*(\{[\s\S]*?\})/);
    if (toolMatch) {
      try {
        const args = JSON.parse(toolMatch[2]);
        return {
          thought: response,
          action: { tool: toolMatch[1], args },
          observation: undefined,
          completed: false,
          maxTurns: this.maxTurns
        };
      } catch {
        // JSON parse failed, treat as observation
      }
    }

    const finalMatch = response.match(/FINAL:\s*([\s\S]*)/);
    if (finalMatch) {
      return {
        thought: response,
        completed: true,
        maxTurns: this.maxTurns
      };
    }

    return {
      thought: response,
      completed: true,
      maxTurns: this.maxTurns
    };
  }

  async execute(objective: string): Promise<string> {
    if (this.running) return 'Agent is already running';
    this.running = true;
    this.turnCount = 0;
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

    this.running = true;
    this.turnCount = 0;
    let result = '';
    let conversation: string[] = [];

    const systemPrompt = this.buildSystemPrompt(objective);
    this.bus.pulse('agent:prompt', {
      text: `[System]\n${systemPrompt}\n\n[User]\nObjective: ${objective}`
    }, 'AgentLoop');

    while (this.turnCount < this.maxTurns && this.running) {
      this.turnCount++;
      this.bus.pulse('agent:status', { type: 'thinking', turn: this.turnCount }, 'AgentLoop');

      const lastMsg = conversation.length > 0
        ? conversation[conversation.length - 1]
        : objective;

      const turn = await this.think(lastMsg);

      if (turn.action) {
        const toolName = turn.action.tool;
        const toolArgs = turn.action.args;
        this.bus.pulse('agent:status', { type: 'tool', tool: toolName, args: toolArgs }, 'AgentLoop');

        const tool = this.tools.get(toolName);
        if (tool) {
          try {
            const toolResult = await tool.execute(toolArgs);
            const obs = toolResult.success
              ? `[${toolName}] Output:\n${toolResult.output.substring(0, 2000)}`
              : `[${toolName}] Error:\n${toolResult.error}`;
            conversation.push(`Tool result: ${obs}`);
            this.memory.addMessage('assistant',
              `Used ${toolName}: ${toolResult.success ? 'success' : 'failed'}`);

            if (toolResult.success) {
              this.bus.pulse('agent:status', { type: 'tool_result', tool: toolName, result: toolResult.output.substring(0, 100) }, 'AgentLoop');
            } else {
              this.bus.pulse('agent:status', { type: 'tool_error', tool: toolName, error: toolResult.error }, 'AgentLoop');
            }
          } catch (err) {
            conversation.push(`Tool error: ${String(err)}`);
            this.bus.pulse('agent:status', { type: 'tool_error', tool: toolName, error: String(err) }, 'AgentLoop');
          }
        } else {
          conversation.push(`Tool not found: ${turn.action.tool}`);
          this.bus.pulse('agent:status', { type: 'tool_error', tool: toolName, error: 'not found' }, 'AgentLoop');
        }
      }

      if (turn.completed) {
        const finalMatch = turn.thought.match(/FINAL:\s*([\s\S]*)/);
        result = finalMatch ? finalMatch[1] : turn.thought;
        this.memory.addMessage('assistant', `Completed: ${result.substring(0, 200)}`);
        this.bus.pulse('agent:status', { type: 'complete' }, 'AgentLoop');
        break;
      }

      if (this.turnCount >= this.maxTurns) {
        result = `Reached max turns (${this.maxTurns}) without completion.`;
        this.memory.addMessage('system', result);
      }
    }

    this.running = false;
    return result || 'No result produced';
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
