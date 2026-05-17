import { System } from './system';
import { Biometrics, ToolDefinition } from './types';

type ToolHandler = (...args: string[]) => Promise<unknown>;

export class MusculoskeletalSystem extends System {
  private tools: Map<string, ToolDefinition & { handler: ToolHandler }> = new Map();

  async init(): Promise<void> {
    this.subscribe('tool:register', (data) => this.registerTool(data as ToolDefinition & { handler: ToolHandler }));
    this.initialized = true;
    this.log('Musculoskeletal system ready');
  }

  registerTool(definition: ToolDefinition & { handler: ToolHandler }): void {
    this.tools.set(definition.name, { ...definition, usageCount: 0, successRate: 1.0 });
    this.bus.pulse('tool:registered', { name: definition.name }, this.name);
  }

  applyGlobalSuccessBonus(bonus: number): void {
    for (const [, tool] of this.tools) {
      tool.successRate = Math.min(1.0, tool.successRate + bonus);
    }
  }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: 'healthy',
      load: 0,
      metadata: {
        toolCount: this.tools.size,
        tools: Array.from(this.tools.entries()).map(([k, v]) => ({ name: k, usage: v.usageCount, successRate: v.successRate }))
      }
    };
  }
}
