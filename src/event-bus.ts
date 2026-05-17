import { EventEmitter } from 'events';
import { NovaEvent, EnergyFlow, HeartbeatState, GrowthStage, WasteMetrics } from './types';

export class CirculatorySystem extends EventEmitter {
  private static instance: CirculatorySystem;
  private eventLog: NovaEvent[] = [];
  private readonly maxLogSize = 500;

  //  Energy
  private _energy = 50;
  private _maxEnergy = 100;
  private _debt = 0;
  private readonly minEnergy = 0;
  private readonly maxEnergyBase = 100;
  private energyFlows: Map<string, EnergyFlow> = new Map();
  private totalEnergyProduced = 0;
  private totalEnergyConsumed = 0;

  //  Growth stage affects capacity
  private _growthStage: GrowthStage = GrowthStage.NEWBORN;

  //  Metabolism
  private bmrPerBeat = 0.2;

  //  Waste (Excretory)
  private _waste: WasteMetrics = {
    total: 0, hallucinationWaste: 0, errorWaste: 0,
    staleKnowledge: 0, lastCleanup: Date.now()
  };
  private readonly maxWaste = 100;

  get waste(): WasteMetrics { return { ...this._waste }; }
  get wasteLevel(): number { return this._waste.total; }

  addWaste(type: 'hallucination' | 'error' | 'stale', amount: number): void {
    if (type === 'hallucination') this._waste.hallucinationWaste += amount;
    else if (type === 'error') this._waste.errorWaste += amount;
    else if (type === 'stale') this._waste.staleKnowledge += amount;
    this._waste.total = Math.min(this.maxWaste,
      this._waste.hallucinationWaste + this._waste.errorWaste + this._waste.staleKnowledge);
    this.pulse('waste:accumulated', { type, amount, total: this._waste.total }, 'CirculatorySystem');
    if (this._waste.total > 70) this.pulse('waste:critical', this._waste, 'CirculatorySystem');
  }

  flushWaste(amount: number): void {
    const reduction = Math.min(this._waste.total, Math.round(amount));
    const ratio = this._waste.total > 0 ? reduction / this._waste.total : 0;
    this._waste.hallucinationWaste = Math.max(0, Math.round(this._waste.hallucinationWaste * (1 - ratio)));
    this._waste.errorWaste = Math.max(0, Math.round(this._waste.errorWaste * (1 - ratio)));
    this._waste.staleKnowledge = Math.max(0, Math.round(this._waste.staleKnowledge * (1 - ratio)));
    this._waste.total = Math.max(0, this._waste.total - reduction);
    this._waste.lastCleanup = Date.now();
    this.pulse('waste:flushed', { amount: reduction, remaining: this._waste.total }, 'CirculatorySystem');
  }

  //  Heartbeat
  private _beat = 0;
  private _heartRate = 60;
  private _alive = false;
  private beatTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private lastBeatTime = 0;

  private constructor() {
    super();
    this.setMaxListeners(50);
  }

  public static getInstance(): CirculatorySystem {
    if (!CirculatorySystem.instance) {
      CirculatorySystem.instance = new CirculatorySystem();
    }
    return CirculatorySystem.instance;
  }

  setGrowthStage(stage: GrowthStage): void {
    this._growthStage = stage;
    const multipliers: Record<GrowthStage, number> = {
      [GrowthStage.NEWBORN]: 0.5,
      [GrowthStage.CHILD]: 0.7,
      [GrowthStage.ADOLESCENT]: 0.85,
      [GrowthStage.ADULT]: 1.0,
      [GrowthStage.MATURE]: 1.3,
      [GrowthStage.ELDER]: 1.0
    };
    const bmrMultipliers: Record<GrowthStage, number> = {
      [GrowthStage.NEWBORN]: 0.1,
      [GrowthStage.CHILD]: 0.15,
      [GrowthStage.ADOLESCENT]: 0.2,
      [GrowthStage.ADULT]: 0.25,
      [GrowthStage.MATURE]: 0.35,
      [GrowthStage.ELDER]: 0.4
    };
    this._maxEnergy = Math.round(this.maxEnergyBase * multipliers[stage]);
    this.bmrPerBeat = 0.1 + bmrMultipliers[stage];
    this._energy = Math.min(this._energy, this._maxEnergy);
  }

  // ═══════════ Heartbeat ═══════════

  startHeart(): void {
    if (this._alive) return;
    this._alive = true;
    this.startTime = Date.now();
    this.lastBeatTime = Date.now();
    this.beatTimer = setInterval(() => this.beat(), 1000);
    this.pulse('heart:start', this.getHeartbeatState(), 'CirculatorySystem');
  }

  stopHeart(): void {
    this._alive = false;
    if (this.beatTimer) clearInterval(this.beatTimer);
    this.pulse('heart:stop', this.getHeartbeatState(), 'CirculatorySystem');
  }

  private beat(): void {
    this._beat++;
    this.lastBeatTime = Date.now();

    // BMR: each beat consumes energy just to stay alive
    const hour = new Date().getHours();
    const nightMultiplier = (hour < 6 || hour > 23) ? 2 : 1; // night costs double
    this._energy = Math.max(0, this._energy - this.bmrPerBeat * nightMultiplier);

    // Gradually recover from debt
    if (this._debt > 0 && this._beat % 5 === 0) {
      this._debt = Math.max(0, this._debt - 1);
    }

    // Passive recovery when above 30%
    if (this._energy < 30 && this._energy > 5 && this._beat % 3 === 0) {
      this._energy = Math.min(this._maxEnergy, this._energy + 1);
    }

    // Waste cleanup during heartbeat (slow natural decay)
    if (this._waste.total > 0 && this._beat % 10 === 0) {
      this.flushWaste(1);
    }

    if (this._energy <= 0) {
      this.pulse('heart:critical', this.getHeartbeatState(), 'CirculatorySystem');
    }

    // Heart rate varies with energy
    this._heartRate = 40 + Math.round((1 - this._energy / this._maxEnergy) * 60);

    this.pulse('heart:beat', this.getHeartbeatState(), 'CirculatorySystem');
  }

  getHeartbeatState(): HeartbeatState {
    return {
      beat: this._beat,
      energy: Math.round(this._energy),
      maxEnergy: this._maxEnergy,
      heartRate: this._heartRate,
      alive: this._alive,
      uptime: this.startTime ? Date.now() - this.startTime : 0
    };
  }

  get energyLevel(): number { return this._energy; }
  get maxEnergyLevel(): number { return this._maxEnergy; }
  get debt(): number { return this._debt; }
  get growthStage(): GrowthStage { return this._growthStage; }

  getEnergyMode(): 'critical' | 'low' | 'normal' | 'surplus' {
    const pct = this._energy / this._maxEnergy;
    if (pct < 0.15) return 'critical';
    if (pct < 0.4) return 'low';
    if (pct > 0.8) return 'surplus';
    return 'normal';
  }

  // ═══════════ Energy Management ═══════════

  consumeEnergy(system: string, amount: number): boolean {
    if (this._energy >= amount) {
      this._energy = Math.max(0, this._energy - amount);
      this.totalEnergyConsumed += amount;
      this.trackFlow(system, amount, 0);
      this.pulse('energy:consumed', { system, amount, remaining: this._energy }, system);
      return true;
    }

    // Allow debt for critical operations
    if (amount > 0) {
      const debtAmount = amount - this._energy;
      this._energy = 0;
      this._debt += debtAmount;
      this.totalEnergyConsumed += amount;
      this.trackFlow(system, amount, 0);
      this.pulse('energy:debt', { system, debt: this._debt }, system);
      return true;
    }

    return false;
  }

  produceEnergy(system: string, amount: number): void {
    // Debt repayment: half of new energy goes to debt first
    let actualGain = amount;
    if (this._debt > 0) {
      const repayment = Math.min(this._debt, Math.ceil(amount * 0.5));
      this._debt -= repayment;
      actualGain = amount - repayment;
    }

    const oldEnergy = this._energy;
    this._energy = Math.min(this._maxEnergy, this._energy + actualGain);
    this.totalEnergyProduced += amount;

    const netGain = this._energy - oldEnergy;
    this.trackFlow(system, 0, netGain);
    this.pulse('energy:produced', { system, amount: netGain, total: this._energy, debt: this._debt }, system);
  }

  private trackFlow(system: string, consumed: number, produced: number): void {
    const existing = this.energyFlows.get(system) || {
      system, consumed: 0, produced: 0, efficiency: 1, totalEnergy: 0
    };
    existing.consumed += consumed;
    existing.produced += produced;
    existing.totalEnergy = this._energy;
    existing.efficiency = existing.consumed > 0
      ? Math.min(1, existing.produced / existing.consumed)
      : 1;
    this.energyFlows.set(system, existing);
  }

  getEnergyFlows(): EnergyFlow[] {
    return Array.from(this.energyFlows.values());
  }

  getEnergyStats(): { current: number; max: number; percent: number; mode: string; debt: number } {
    return {
      current: Math.round(this._energy),
      max: this._maxEnergy,
      percent: Math.round((this._energy / this._maxEnergy) * 100),
      mode: this.getEnergyMode(),
      debt: this._debt
    };
  }

  // ═══════════ Event Bus ═══════════

  public pulse(event: string, payload: unknown, origin: string): void {
    const message: NovaEvent = {
      origin,
      timestamp: Date.now(),
      payload
    };
    this.emit(event, message);
    this.emit('*', message);
    this.eventLog.push(message);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }
  }

  public getEventLog(): NovaEvent[] {
    return [...this.eventLog];
  }

  public getEventsByOrigin(origin: string): NovaEvent[] {
    return this.eventLog.filter(e => e.origin === origin);
  }
}
