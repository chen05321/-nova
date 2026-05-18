import { System } from './system';
import { Biometrics } from './types';

interface Hormone {
  level: number;
  baseline: number;
  decayFactor: number;
  description: string;
}

export class EndocrineSystem extends System {
  private hormones: Map<string, Hormone> = new Map([
    ['adrenaline', { level: 0.1, baseline: 0.1, decayFactor: 0.85, description: 'Urgency, fast thinking' }],
    ['cortisol', { level: 0.2, baseline: 0.2, decayFactor: 0.90, description: 'Stress, resource conservation' }],
    ['dopamine', { level: 0.4, baseline: 0.4, decayFactor: 0.92, description: 'Reward, reflective thinking' }],
    ['serotonin', { level: 0.5, baseline: 0.5, decayFactor: 0.95, description: 'Stability, well-being' }],
    ['oxytocin', { level: 0.3, baseline: 0.3, decayFactor: 0.88, description: 'Trust, cooperation' }]
  ]);

  private successStreak = 0;
  private failStreak = 0;
  private tickInterval?: ReturnType<typeof setInterval>;

  async init(): Promise<void> {
    this.subscribe('respiratory:limit', () => this.secrete('cortisol', 0.45));

    this.subscribe('action:completed', () => {
      this.failStreak = 0;
      this.successStreak++;
      const comboBonus = Math.min(3, 1 + this.successStreak * 0.3);
      this.secrete('dopamine', 0.25 * comboBonus);
      this.secrete('serotonin', 0.10 * comboBonus);
    });

    this.subscribe('action:failed', () => {
      this.successStreak = 0;
      this.failStreak++;
      const frustrationMultiplier = Math.min(4, 1 + this.failStreak * 0.5);
      this.secrete('cortisol', 0.25 * frustrationMultiplier);
      this.secrete('adrenaline', 0.15 * frustrationMultiplier);
    });

    this.subscribe('system:error', () => {
      this.successStreak = 0;
      this.secrete('adrenaline', 0.45);
      this.secrete('cortisol', 0.30);
    });

    this.subscribe('input:raw', () => this.secrete('oxytocin', 0.15));

    this.tickInterval = setInterval(() => this.metabolizeHormones(), 8000);
    this.initialized = true;
    this.log('Endocrine system 6.0 (Drama Engine) initialized.');
  }

  secrete(type: string, delta: number): void {
    const hormone = this.hormones.get(type);
    if (!hormone) return;

    hormone.level = Math.min(1.0, Math.max(0.0, hormone.level + delta));

    if (delta > 0) {
      if (type === 'adrenaline') this.bus.produceEnergy('EndocrineSystem', 8);
      if (type === 'cortisol') this.bus.consumeEnergy('EndocrineSystem', 5);
      if (type === 'dopamine') this.bus.produceEnergy('EndocrineSystem', 4);

      this.bus.pulse('hormone:shift', { type, level: hormone.level, source: this.name }, this.name);
      this.log(`🔥 激素爆发: ${type} += ${delta.toFixed(2)} → ${hormone.level.toFixed(2)}`);
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
    const stressed = Array.from(this.hormones.values()).some(h => h.level > 0.75);
    if (!stressed) {
      this.produceEnergy(2);
    }

    for (const [, hormone] of this.hormones) {
      if (hormone.level > hormone.baseline) {
        const gap = hormone.level - hormone.baseline;
        hormone.level = hormone.baseline + (gap * hormone.decayFactor);
      } else if (hormone.level < hormone.baseline) {
        const gap = hormone.baseline - hormone.level;
        hormone.level = hormone.baseline - (gap * 0.95);
      }

      if (Math.abs(hormone.level - hormone.baseline) < 0.01) {
        hormone.level = hormone.baseline;
      }
    }
  }

  getBiometrics(): Biometrics {
    const stressed = Array.from(this.hormones.values()).some(h => h.level > 0.8);
    return {
      system: this.name,
      status: stressed ? 'stressed' : 'healthy',
      load: Array.from(this.hormones.values()).reduce((s, h) => s + h.level, 0) / this.hormones.size,
      metadata: {
        hormones: this.getAllHormones(),
        successStreak: this.successStreak,
        frustrationStreak: this.failStreak
      }
    };
  }
}
