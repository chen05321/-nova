import { System } from './system';
import { Biometrics } from './types';

interface TokenBucket {
  capacity: number;
  tokens: number;
  refillRate: number;
  lastRefill: number;
}

export class RespiratorySystem extends System {
  private bucket: TokenBucket;
  private breathCycle = 0;
  private isHoldingBreath = false;

  constructor() {
    super();
    this.bucket = {
      capacity: 10000,
      tokens: 10000,
      refillRate: 100,
      lastRefill: Date.now()
    };
  }

  async init(): Promise<void> {
    this.subscribe('*', () => this.breathe());

    setInterval(() => this.breathRhythm(), 1000);
    this.initialized = true;
    this.log('Respiratory system initialized (capacity: 10000 tokens, refill: 100/s)');
  }

  async breathe(): Promise<boolean> {
    this.refillBucket();

    if (this.bucket.tokens < 10) {
      this.isHoldingBreath = true;
      this.bus.pulse('respiratory:limit', {
        remaining: this.bucket.tokens,
        status: 'BREATH_HOLD'
      }, this.name);
      return false;
    }

    this.bucket.tokens -= 1;
    this.isHoldingBreath = false;
    return true;
  }

  async breatheDeep(amount: number): Promise<boolean> {
    this.refillBucket();
    if (this.bucket.tokens < amount) {
      this.bus.pulse('respiratory:insufficient', {
        needed: amount,
        available: this.bucket.tokens
      }, this.name);
      return false;
    }

    this.bucket.tokens -= amount;
    this.bus.pulse('respiratory:deep-breathe', { consumed: amount }, this.name);
    return true;
  }

  private refillBucket(): void {
    const now = Date.now();
    const elapsed = now - this.bucket.lastRefill;
    const refillAmount = (elapsed / 1000) * this.bucket.refillRate;
    this.bucket.tokens = Math.min(this.bucket.capacity, this.bucket.tokens + refillAmount);
    this.bucket.lastRefill = now;
  }

  private breathRhythm(): void {
    this.breathCycle++;
    this.refillBucket();

    // Each breath produces energy (life force from environment)
    if (this.breathCycle % 5 === 0) {
      const usage = 1 - (this.bucket.tokens / this.bucket.capacity);
      const energyGain = Math.round((1 - usage) * 3) + 1;
      this.produceEnergy(energyGain);
    }

    const usage = 1 - (this.bucket.tokens / this.bucket.capacity);
    if (usage > 0.8) {
      this.bus.pulse('respiratory:shallow', {
        cycle: this.breathCycle,
        usage
      }, this.name);
    }

    if (this.breathCycle % 10 === 0) {
      this.bus.pulse('respiratory:rhythm', {
        breathRate: this.breathCycle,
        tokensRemaining: this.bucket.tokens
      }, this.name);
    }
  }

  getTokenStatus(): { available: number; capacity: number; usage: number } {
    this.refillBucket();
    return {
      available: this.bucket.tokens,
      capacity: this.bucket.capacity,
      usage: 1 - (this.bucket.tokens / this.bucket.capacity)
    };
  }

  getBiometrics(): Biometrics {
    const usage = 1 - (this.bucket.tokens / this.bucket.capacity);
    return {
      system: this.name,
      status: usage > 0.9 ? 'degraded' : usage > 0.7 ? 'stressed' : 'healthy',
      load: usage,
      metadata: {
        tokensRemaining: Math.floor(this.bucket.tokens),
        capacity: this.bucket.capacity,
        breathCycle: this.breathCycle,
        isHoldingBreath: this.isHoldingBreath,
        refillRate: this.bucket.refillRate
      }
    };
  }
}
