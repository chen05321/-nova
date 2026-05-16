import { System } from './system';
import { Biometrics, ToolDefinition } from './types';

type ToolHandler = (...args: string[]) => Promise<unknown>;

export class MusculoskeletalSystem extends System {
  private tools: Map<string, ToolDefinition & { handler: ToolHandler }> = new Map();
  private activeActions = 0;
  private actionHistory: { tool: string; success: boolean; timestamp: number }[] = [];

  async init(): Promise<void> {
    this.subscribe('thought:ready', (data) => this.executeAction(data));
    this.subscribe('tool:register', (data) => this.registerTool(data as ToolDefinition & { handler: ToolHandler }));
    this.initialized = true;
    this.log('Musculoskeletal system initialized with 0 tools');
  }

  registerTool(definition: ToolDefinition & { handler: ToolHandler }): void {
    this.tools.set(definition.name, {
      ...definition,
      usageCount: 0,
      successRate: 1.0
    });
    this.bus.pulse('tool:registered', { name: definition.name }, this.name);
    this.log(`Tool registered: ${definition.name}`);
  }

  private async executeAction(data: unknown): Promise<void> {
    const decision = (data as { payload: { decision: string } }).payload?.decision;
    if (!decision) return;

    this.activeActions++;
    this.log(`Executing action: ${decision}`);

    const tool = this.findBestTool(decision);
    if (tool) {
      try {
        tool.usageCount++;
        await tool.handler(decision);
        tool.successRate = (tool.successRate * (tool.usageCount - 1) + 1) / tool.usageCount;
        this.actionHistory.push({ tool: tool.name, success: true, timestamp: Date.now() });
        this.bus.pulse('action:completed', { tool: tool.name, success: true }, this.name);
      } catch {
        tool.successRate = (tool.successRate * (tool.usageCount - 1)) / tool.usageCount;
        this.actionHistory.push({ tool: tool.name, success: false, timestamp: Date.now() });
        this.bus.pulse('action:failed', { tool: tool.name }, this.name);
      }
    } else {
      this.bus.pulse('action:no-tool', { decision }, this.name);
    }

    this.activeActions--;
  }

  private findBestTool(decision: string): (ToolDefinition & { handler: ToolHandler }) | undefined {
    let best: (ToolDefinition & { handler: ToolHandler }) | undefined;
    let bestScore = -1;

    for (const tool of this.tools.values()) {
      const relevance = tool.description.includes(decision) ? 1 : 0;
      const score = relevance * 0.6 + tool.successRate * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = tool;
      }
    }

    return best;
  }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: this.activeActions > 5 ? 'stressed' : 'healthy',
      load: this.activeActions / 10,
      metadata: {
        toolCount: this.tools.size,
        activeActions: this.activeActions,
        actionHistoryLength: this.actionHistory.length,
        tools: Array.from(this.tools.entries()).map(([k, v]) => ({
          name: k,
          usage: v.usageCount,
          successRate: v.successRate
        }))
      }
    };
  }
}
