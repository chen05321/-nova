import { CirculatorySystem } from './event-bus';
import { Biometrics } from './types';

export abstract class System {
  protected bus: CirculatorySystem;
  protected name: string;
  protected initialized = false;
  protected energyEfficiency = 1;
  protected upgrades = 0;

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.name = this.constructor.name;
  }

  abstract init(): Promise<void>;
  abstract getBiometrics(): Biometrics;

  // ═══════ Energy Cycle ═══════

  protected consumeEnergy(amount: number): boolean {
    const ok = this.bus.consumeEnergy(this.name, amount);
    if (!ok) {
      this.log(`⚠ Low energy, can't consume ${amount}`);
    }
    return ok;
  }

  protected produceEnergy(amount: number): void {
    this.bus.produceEnergy(this.name, Math.round(amount * this.energyEfficiency));
  }

  protected upgradeEfficiency(): void {
    this.upgrades++;
    this.energyEfficiency = Math.min(2, 1 + this.upgrades * 0.1);
    this.log(`⚡ Efficiency improved to ${(this.energyEfficiency * 100).toFixed(0)}%`);
  }

  // ═══════ Base Methods ═══════

  protected log(message: string): void {
    this.bus.pulse('system:log', { system: this.name, message }, this.name);
  }

  protected subscribe(event: string, handler: (data: unknown) => void): void {
    this.bus.on(event, handler);
  }
}
