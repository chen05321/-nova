import { System } from './system';
import { Biometrics } from './types';

interface Hormone {
  level: number;
  baseline: number;
  decayRate: number;
  description: string;
}

export class EndocrineSystem extends System {
  private hormones: Map<string, Hormone> = new Map([
    ['adrenaline', { level: 0.1, baseline: 0.1, decayRate: 0.05, description: 'Urgency, fast thinking' }],
    ['cortisol', { level: 0.2, baseline: 0.2, decayRate: 0.03, description: 'Stress, resource conservation' }],
    ['dopamine', { level: 0.5, baseline: 0.5, decayRate: 0.02, description: 'Reward, reflective thinking' }],
    ['serotonin', { level: 0.5, baseline: 0.5, decayRate: 0.01, description: 'Stability, well-being' }],
    ['oxytocin', { level: 0.3, baseline: 0.3, decayRate: 0.04, description: 'Trust, cooperation' }]
  ]);

  private tickInterval?: ReturnType<typeof setInterval>;

  async init(): Promise<void> {
    this.subscribe('respiratory:limit', () => this.secrete('cortisol', 0.3));
    this.subscribe('action:completed', () => this.secrete('dopamine', 0.15));
    this.subscribe('action:failed', () => this.secrete('cortisol', 0.15));
    this.subscribe('system:error', () => this.secrete('adrenaline', 0.2));
    this.subscribe('input:raw', () => this.secrete('oxytocin', 0.05));

    this.tickInterval = setInterval(() => this.metabolizeHormones(), 5000);
    this.initialized = true;
    this.log('Endocrine system initialized with 5 hormone regulators');
  }

  secrete(type: string, delta: number): void {
    const hormone = this.hormones.get(type);
    if (!hormone) return;

    hormone.level = Math.min(1, Math.max(0, hormone.level + delta));

    if (delta > 0) {
      // Hormones affect energy
      if (type === 'adrenaline') this.bus.produceEnergy('EndocrineSystem', 5);
      if (type === 'cortisol') this.bus.consumeEnergy('EndocrineSystem', 3);
      if (type === 'dopamine') this.bus.produceEnergy('EndocrineSystem', 2);
      if (type === 'serotonin') this.bus.produceEnergy('EndocrineSystem', 1);

      this.bus.pulse('hormone:shift', { type, level: hormone.level, source: this.name }, this.name);
      this.log(`Hormone secreted: ${type} → ${hormone.level.toFixed(2)}`);
    }
  }

  getHormone(type: string): number {
    return this.hormones.get(type)?.level ?? 0;
  }

  getAllHormones(): Record<string, number> {
    const result: Record<string, number> = {};
    this.hormones.forEach((h, k) => { result[k] = h.level; });
    return result;
  }

  private metabolizeHormones(): void {
    // Successful regulation produces a small amount of energy
    const stressed = Array.from(this.hormones.values()).some(h => h.level > 0.7);
    if (!stressed) {
      this.produceEnergy(1);
    }
    for (const [name, hormone] of this.hormones) {
      if (hormone.level > hormone.baseline) {
        hormone.level = Math.max(hormone.baseline, hormone.level - hormone.decayRate);
      } else if (hormone.level < hormone.baseline) {
        hormone.level = Math.min(hormone.baseline, hormone.level + hormone.decayRate * 0.5);
      }
    }
    this.log('Hormones metabolized toward baseline');
  }

  getBiometrics(): Biometrics {
    const stressed = Array.from(this.hormones.values()).some(h => h.level > 0.8);
    return {
      system: this.name,
      status: stressed ? 'stressed' : 'healthy',
      load: Array.from(this.hormones.values()).reduce((s, h) => s + h.level, 0) / this.hormones.size,
      metadata: { hormones: this.getAllHormones() }
    };
  }
}
