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
    // Evolution costs significant energy
    if (!this.consumeEnergy(20)) {
      this.log('Not enough energy to evolve');
      return;
    }
    this.log('Evolution trigger received (consumed 20 energy)');

    const mutation: EvolutionMutation = {
      type: this.selectMutationType(),
      target: this.selectMutationTarget(),
      patch: `// Auto-generated mutation v${Date.now()}`,
      version: Date.now(),
      timestamp: Date.now()
    };

    this.mutationHistory.push(mutation);
    this.evolutionReadiness = 0;

    this.bus.pulse('evolution:mutation', { mutation }, this.name);
    this.log(`Mutation applied: ${mutation.type} on ${mutation.target}`);
  }

  private selectMutationType(): EvolutionMutation['type'] {
    const types: EvolutionMutation['type'][] = ['code', 'prompt', 'config', 'tool'];
    const weights = [0.3, 0.3, 0.2, 0.2];
    const r = Math.random();
    let cumulative = 0;
    for (let i = 0; i < types.length; i++) {
      cumulative += weights[i];
      if (r < cumulative) return types[i];
    }
    return 'config';
  }

  private selectMutationTarget(): string {
    const targets = [
      'nervous-system.promptTemplate',
      'musculoskeletal-system.toolRegistry',
      'endocrine-system.hormoneThresholds',
      'respiratory-system.tokenBucket',
      'digestive-system.embeddingStrategy',
      'urinary-system.pruningPolicy'
    ];
    return targets[Math.floor(Math.random() * targets.length)];
  }

  spawnChild(name: string, config?: Record<string, unknown>): void {
    this.childAgents.push(name);
    this.generation++;

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
