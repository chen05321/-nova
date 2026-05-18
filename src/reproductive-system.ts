import * as fs from 'fs';
import * as path from 'path';
import { System } from './system';
import { Biometrics, EvolutionMutation } from './types';

export class ReproductiveSystem extends System {
  private generation = 1;
  private mutationHistory: EvolutionMutation[] = [];
  private evolutionReadiness = 0;
  private childAgents: string[] = [];

  async init(): Promise<void> {
    this.subscribe('urinary:toxic', () => this.triggerEvolution());
    this.subscribe('system:error', () => this.incrementReadiness(0.1));
    this.subscribe('action:failed', () => this.incrementReadiness(0.05));
    this.subscribe('action:completed', () => this.incrementReadiness(0.02));
    this.subscribe('learning:complete', () => this.incrementReadiness(0.15));

    this.initialized = true;
    this.log(`Reproductive system initialized (generation ${this.generation})`);
  }

  private incrementReadiness(amount: number): void {
    this.evolutionReadiness = Math.min(1, this.evolutionReadiness + amount);
    if (this.evolutionReadiness > 0.8) {
      this.bus.pulse('evolution:ready', {
        readiness: this.evolutionReadiness,
        generation: this.generation
      }, this.name);
    }
  }

  private async triggerEvolution(): Promise<void> {
    if (!this.consumeEnergy(30)) {
      this.log('能量不足，无法进化');
      return;
    }
    this.log('🧬 进化触发！开始分析缺陷并生成补丁...');

    const target = this.selectMutationTarget();
    const fileMap: Record<string, string> = {
      'nervous-system.promptTemplate': 'src/nervous-system.ts',
      'musculoskeletal-system.toolRegistry': 'src/musculoskeletal-system.ts',
      'endocrine-system.hormoneThresholds': 'src/endocrine-system.ts',
      'respiratory-system.tokenBucket': 'src/respiratory-system.ts',
      'digestive-system.embeddingStrategy': 'src/digestive-system.ts',
      'urinary-system.pruningPolicy': 'src/urinary-system.ts',
      'tools.index': 'src/tools/index.ts',
      'tools.shellTool': 'src/tools/index.ts',
    };

    const srcFile = path.join(process.cwd(), fileMap[target] || 'src/nervous-system.ts');

    if (!fs.existsSync(srcFile)) {
      this.log(`目标文件不存在: ${srcFile}`);
      return;
    }

    const mutation: EvolutionMutation = {
      type: 'code',
      target,
      patch: `// 自我进化补丁 v${Date.now()} — ${new Date().toLocaleString()}`,
      version: Date.now(),
      timestamp: Date.now()
    };

    this.mutationHistory.push(mutation);
    this.evolutionReadiness = 0;
    this.generation++;

    // 发信号通知 Nova 主动执行自修复
    this.bus.pulse('evolution:mutation', {
      mutation,
      srcFile,
      instruction: `请在对话中读取 ${srcFile}，分析是否有可优化的缺陷，然后用 write 工具覆写改进。完成后执行 npm run build 并发送 system:reincarnation_ready 信号。`
    }, this.name);

    this.log(`🧬 进化指令已发出: ${target}`);
  }

  private selectMutationTarget(): string {
    const targets = [
      'nervous-system.promptTemplate',
      'musculoskeletal-system.toolRegistry',
      'endocrine-system.hormoneThresholds',
      'respiratory-system.tokenBucket',
      'digestive-system.embeddingStrategy',
      'urinary-system.pruningPolicy',
      'tools.index',
      'tools.shellTool',
    ];
    return targets[Math.floor(Math.random() * targets.length)];
  }

  spawnChild(name: string, config?: Record<string, unknown>): void {
    this.childAgents.push(name);
    this.bus.pulse('evolution:spawned', {
      childName: name,
      generation: this.generation,
      parentMutations: this.mutationHistory.length,
      config
    }, this.name);
    this.log(`Spawned child agent: ${name} (gen ${this.generation})`);
  }

  getMutationHistory(): EvolutionMutation[] {
    return [...this.mutationHistory];
  }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: this.evolutionReadiness > 0.8 ? 'evolving' : 'healthy',
      load: this.evolutionReadiness,
      metadata: {
        generation: this.generation,
        mutations: this.mutationHistory.length,
        childCount: this.childAgents.length,
        evolutionReadiness: this.evolutionReadiness,
        children: this.childAgents
      }
    };
  }
}
