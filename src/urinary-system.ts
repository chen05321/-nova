import { System } from './system';
import { Biometrics, MemoryEntry } from './types';

export class UrinarySystem extends System {
  private shortTermMemory: Map<string, MemoryEntry> = new Map();
  private toxinLevel = 0;
  private memoryCapacity = 100;

  async init(): Promise<void> {
    setInterval(() => this.filterCycle(), 30000);
    this.subscribe('memory:store', (data) => this.storeMemory(data));

    this.initialized = true;
    this.log('Urinary system initialized (capacity: 100 entries)');
  }

  storeMemory(data: unknown): void {
    const entry = data as MemoryEntry;
    this.shortTermMemory.set(entry.id, entry);
    this.toxinLevel = Math.min(1, this.toxinLevel + 0.02);

    if (this.shortTermMemory.size >= this.memoryCapacity) {
      this.bus.pulse('urinary:overflow', {
        size: this.shortTermMemory.size,
        capacity: this.memoryCapacity
      }, this.name);
    }
  }

  private filterCycle(): void {
    const before = this.shortTermMemory.size;

    let pruned = 0;
    for (const [id, entry] of this.shortTermMemory) {
      const age = Date.now() - entry.timestamp;
      const daysInMs = 24 * 60 * 60 * 1000;

      if (entry.importance < 0.3 && age > daysInMs) {
        this.shortTermMemory.delete(id);
        pruned++;
      } else if (entry.accessCount === 0 && age > 7 * daysInMs) {
        this.shortTermMemory.delete(id);
        pruned++;
      }
    }

    this.toxinLevel = Math.max(0, this.toxinLevel - 0.15);

    if (pruned > 0) {
      this.bus.pulse('memory:purged', { pruned, remaining: this.shortTermMemory.size }, this.name);
      this.log(`Filtered ${pruned} low-importance memories (toxin: ${this.toxinLevel.toFixed(2)})`);
    }

    if (this.toxinLevel > 0.8) {
      this.bus.pulse('urinary:toxic', { toxinLevel: this.toxinLevel }, this.name);
      this.log('Toxin level critical: initiating emergency pruning');
      this.emergencyPrune();
    }
  }

  private emergencyPrune(): void {
    const sorted = Array.from(this.shortTermMemory.entries())
      .sort(([, a], [, b]) => a.importance - b.importance);

    const toRemove = Math.floor(this.shortTermMemory.size * 0.3);
    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      this.shortTermMemory.delete(sorted[i][0]);
    }
    this.toxinLevel = 0.3;
    this.log(`Emergency pruning removed ${toRemove} memories`);
  }

  storePermanent(entry: MemoryEntry): void {
    entry.importance = Math.min(1, entry.importance + 0.5);
    this.shortTermMemory.set(entry.id, entry);
  }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: this.toxinLevel > 0.8 ? 'degraded' : this.toxinLevel > 0.5 ? 'stressed' : 'healthy',
      load: this.toxinLevel,
      metadata: {
        memoryCount: this.shortTermMemory.size,
        capacity: this.memoryCapacity,
        toxinLevel: this.toxinLevel,
        lastPrune: Date.now()
      }
    };
  }
}
