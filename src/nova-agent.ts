import { CirculatorySystem } from './event-bus';
import { GrowthStage, Biometrics, LifecycleTransition, PersonalityVector, SystemUpgrade } from './types';
import { NervousSystem } from './nervous-system';
import { MusculoskeletalSystem } from './musculoskeletal-system';
import { EndocrineSystem } from './endocrine-system';
import { RespiratorySystem } from './respiratory-system';
import { DigestiveSystem } from './digestive-system';
import { UrinarySystem } from './urinary-system';
import { ReproductiveSystem } from './reproductive-system';
import { System } from './system';
import { MemoryStore } from './memory';
import { ForagingSystem } from './foraging';
import { SelfLearningSystem } from './learning';

interface StageRequirement {
  actionsRequired: number;
  toolsRequired: number;
  knowledgeRequired: number;
  minNutrientLevel: number;
}

const STAGE_REQUIREMENTS: Record<GrowthStage, StageRequirement> = {
  [GrowthStage.NEWBORN]: { actionsRequired: 0, toolsRequired: 0, knowledgeRequired: 0, minNutrientLevel: 0 },
  [GrowthStage.CHILD]: { actionsRequired: 5, toolsRequired: 0, knowledgeRequired: 0, minNutrientLevel: 0.1 },
  [GrowthStage.ADOLESCENT]: { actionsRequired: 20, toolsRequired: 3, knowledgeRequired: 10, minNutrientLevel: 0.3 },
  [GrowthStage.ADULT]: { actionsRequired: 50, toolsRequired: 5, knowledgeRequired: 50, minNutrientLevel: 0.5 },
  [GrowthStage.MATURE]: { actionsRequired: 100, toolsRequired: 8, knowledgeRequired: 200, minNutrientLevel: 0.6 },
  [GrowthStage.ELDER]: { actionsRequired: 999, toolsRequired: 99, knowledgeRequired: 999, minNutrientLevel: 0.9 }
};

export class NovaAgent {
  public bus: CirculatorySystem;
  public memory: MemoryStore;
  public foraging: ForagingSystem;
  public learning: SelfLearningSystem;
  private systems: Map<string, System> = new Map();
  private stage: GrowthStage = GrowthStage.NEWBORN;
  private transitions: LifecycleTransition[] = [];
  private actionCount = 0;
  private startTime: number;
  private isRunning = false;
  private upgrades: SystemUpgrade[] = [];
  private personality: PersonalityVector = {
    verbosity: 0.5, riskTolerance: 0.5,
    creativity: 0.5, curiosity: 0.5, thoroughness: 0.5
  };
  private wisdomScore = 0;

  get Personality(): PersonalityVector { return { ...this.personality }; }
  get Wisdom(): number { return this.wisdomScore; }
  get Upgrades(): SystemUpgrade[] { return [...this.upgrades]; }

  nervous!: NervousSystem;
  musculoskeletal!: MusculoskeletalSystem;
  endocrine!: EndocrineSystem;
  respiratory!: RespiratorySystem;
  digestive!: DigestiveSystem;
  urinary!: UrinarySystem;
  reproductive!: ReproductiveSystem;

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.memory = new MemoryStore();
    this.startTime = Date.now();
    this.loadPersonality();
    this.foraging = new ForagingSystem(this.personality);
    this.learning = new SelfLearningSystem();
    this.setupLifecycle();
  }

  private loadPersonality(): void {
    const facts = this.memory.getFacts('personality');
    if (facts.length > 0) {
      const saved = facts[0];
      try { this.personality = JSON.parse(saved.content); } catch {}
    }
  }

  private savePersonality(): void {
    this.memory.addFact(JSON.stringify(this.personality), 'personality', 0.9);
    this.memory.addFact(`wisdom:${this.wisdomScore}`, 'wisdom', 0.9);
  }

  private setupLifecycle(): void {
    // ═══════════ FEEDBACK LOOP MATRIX ═══════════

    // 1. Digestive → Respiratory: knowledge processing consumes tokens
    this.bus.on('knowledge:assimilated', (data) => {
      const count = (data as any)?.payload?.count || 1;
      this.bus.consumeEnergy('NovaAgent', count);
    });

    // 2. Urinary → Endocrine: high toxins trigger cortisol
    this.bus.on('urinary:toxic', () => {
      this.bus.pulse('hormone:shift', { type: 'cortisol', level: 0.8, source: 'FeedbackLoop' }, 'NovaAgent');
    });

    // 3. Musculoskeletal → Digestive: successful action triggers memory
    this.bus.on('action:completed', (data) => {
      const info = (data as any)?.payload;
      if (info?.tool) {
        this.bus.pulse('learning:new', { id: `action_${Date.now()}`, content: `${info.tool}:${info.success ? 'success' : 'fail'}` }, 'NovaAgent');
      }
    });

    // 4. Reproductive → Nervous: evolution improves efficiency
    this.bus.on('evolution:mutation', () => {
      this.bus.consumeEnergy('NovaAgent', 5);
      this.wisdomScore += 1;
    });

    // 5. Endocrine → Energy coupling
    this.bus.on('hormone:shift', (data) => {
      const s = (data as any)?.payload;
      if (s?.type === 'adrenaline' && s?.level > 0.6) this.bus.produceEnergy('NovaAgent', 3);
      if (s?.type === 'dopamine' && s?.level > 0.6) this.personality.creativity = Math.min(1, this.personality.creativity + 0.05);
      if (s?.type === 'cortisol' && s?.level > 0.6) this.personality.riskTolerance = Math.max(0, this.personality.riskTolerance - 0.05);
    });

    // 6. High waste degrades performance
    this.bus.on('waste:critical', () => {
      this.bus.consumeEnergy('NovaAgent', 3);
    });

    // 7. Evolution takes effect
    this.bus.on('evolution:mutation', (data) => {
      const mut = (data as any)?.payload?.mutation;
      if (mut) {
        this.wisdomScore += 2;
        this.memory.addFact(`进化: ${mut.type} on ${mut.target}`, 'evolution', 0.8);
        // Random personality improvement
        const keys = Object.keys(this.personality) as (keyof typeof this.personality)[];
        const key = keys[Math.floor(Math.random() * keys.length)];
        this.personality[key] = Math.min(0.95, this.personality[key] + 0.03);
      }
    });

    // ═══════════ CORE LIFECYCLE ═══════════

    // Action → growth check
    this.bus.on('action:completed', () => {
      this.actionCount++;
      this.checkGrowth();
    });

    // Energy feedback: successful actions produce energy
    this.bus.on('action:completed', () => {
      this.bus.produceEnergy('NovaAgent', 2);
    });

    // Errors drain energy + add waste
    this.bus.on('action:failed', (data) => {
      this.bus.consumeEnergy('NovaAgent', 3);
      this.bus.addWaste('error', 5);
    });
    this.bus.on('system:error', () => {
      this.bus.consumeEnergy('NovaAgent', 5);
      this.bus.addWaste('error', 8);
    });
    this.bus.on('memory:purged', () => {
      this.bus.addWaste('stale', 2);
    });

    // Waste auto-cleanup when energy is sufficient
    this.bus.on('energy:produced', () => {
      const stats = this.bus.getEnergyStats();
      if (stats.percent > 60 && this.bus.wasteLevel > 20) {
        this.bus.flushWaste(3);
      }
    });

    // Personality drifts slightly over time toward extremes
    setInterval(() => {
      for (const key of Object.keys(this.personality) as (keyof PersonalityVector)[]) {
        const drift = (Math.random() - 0.48) * 0.02;
        this.personality[key] = Math.max(0.1, Math.min(0.9, this.personality[key] + drift));
      }
    }, 60000);

    // Save personality every 5 minutes
    setInterval(() => this.savePersonality(), 300000);

    // ═══════════ ELDER CHECK ═══════════
    this.bus.on('heart:beat', () => {
      if (this.stage === GrowthStage.MATURE) {
        const waste = this.bus.wasteLevel;
        const uptime = (Date.now() - this.startTime) / 1000;
        if (waste > 80 && uptime > 3600) {
          this.transition(GrowthStage.ELDER);
        }
      }
    });
  }

  private checkGrowth(): void {
    const stages = Object.values(GrowthStage);
    const currentIndex = stages.indexOf(this.stage);

    for (let i = currentIndex + 1; i < stages.length; i++) {
      const nextStage = stages[i];
      if (this.meetsRequirements(nextStage)) {
        this.transition(nextStage);
        break;
      }
    }
  }

  private meetsRequirements(stage: GrowthStage): boolean {
    const req = STAGE_REQUIREMENTS[stage];
    if (this.actionCount < req.actionsRequired) return false;

    const toolsBiometrics = this.systems.get('MusculoskeletalSystem')?.getBiometrics();
    const toolCount = (toolsBiometrics?.metadata as { toolCount?: number })?.toolCount ?? 0;
    if (toolCount < req.toolsRequired) return false;

    const digestiveBio = this.systems.get('DigestiveSystem')?.getBiometrics();
    const knowledgeCount = (digestiveBio?.metadata as { knowledgeFragments?: number })?.knowledgeFragments ?? 0;
    if (knowledgeCount < req.knowledgeRequired) return false;

    const nutrientLevel = (digestiveBio?.metadata as { nutrientLevel?: number })?.nutrientLevel ?? 0;
    if (nutrientLevel < req.minNutrientLevel) return false;

    return true;
  }

  private transition(newStage: GrowthStage): void {
    const oldStage = this.stage;
    this.stage = newStage;
    this.bus.setGrowthStage(newStage);

    const transition: LifecycleTransition = {
      from: oldStage,
      to: newStage,
      trigger: `actionCount:${this.actionCount}`,
      timestamp: Date.now()
    };
    this.transitions.push(transition);

    this.bus.pulse('lifecycle:transition', transition, 'NovaAgent');
    console.log(`\n[超体] Growth: ${oldStage} → ${newStage} (after ${this.actionCount} actions)`);

    this.onStageTransition(newStage);
  }

  private onStageTransition(stage: GrowthStage): void {
    switch (stage) {
      case GrowthStage.CHILD:
        console.log('[超体] Child stage: Tool use enabled, beginning to explore');
        break;
      case GrowthStage.ADOLESCENT:
        console.log('[超体] Adolescent stage: Resource-aware, building knowledge base');
        break;
      case GrowthStage.ADULT:
        console.log('[超体] Adult stage: Goal-seeking, autonomous operation');
        break;
      case GrowthStage.MATURE:
        console.log('[超体] Mature stage: Self-evolution enabled, full autonomy achieved');
        break;
      case GrowthStage.ELDER:
        console.log('[超体] Elder stage: System is slowing down, preparing for rebirth...');
        setTimeout(() => this.reincarnate(), 30000);
        break;
    }
  }

  private reincarnate(): void {
    console.log('\n[超体] ♻ Processing rebirth cycle...');
    const wisdom = this.wisdomScore;
    const savedPersonality = { ...this.personality };
    savedPersonality.curiosity = Math.min(1, savedPersonality.curiosity + 0.1);

    this.startTime = Date.now();
    this.actionCount = 0;
    this.transitions = [];
    this.bus.pulse('reproductive:rebirth', { wisdom, personality: savedPersonality }, 'NovaAgent');

    this.stage = GrowthStage.NEWBORN;
    this.bus.setGrowthStage(GrowthStage.NEWBORN);
    this.wisdomScore = Math.floor(wisdom * 0.3);

    this.memory.addFact(`rebirth_wisdom:${this.wisdomScore}`, 'wisdom', 0.9);
    this.savePersonality();
    console.log(`[超体] ✨ Reborn as NEWBORN with ${this.wisdomScore} wisdom retained`);
  }

  // ═══════════ ANABOLIC UPGRADES ═══════════

  getAvailableUpgrades(): SystemUpgrade[] {
    return [
      { id: 'eff_nervous', name: '神经效率', description: '降低 LLM 调用能耗 20%', system: 'NervousSystem', cost: 30, effect: 'efficiency+0.1', applied: false },
      { id: 'eff_resp', name: '肺活量', description: '提升 token 容量 25%', system: 'RespiratorySystem', cost: 25, effect: 'capacity+25%', applied: false },
      { id: 'eff_digest', name: '消化增强', description: '知识处理速度翻倍', system: 'DigestiveSystem', cost: 20, effect: 'digest_speed*2', applied: false },
      { id: 'eff_memory', name: '记忆扩展', description: '短期记忆容量 +50%', system: 'UrinarySystem', cost: 15, effect: 'capacity+50%', applied: false },
      { id: 'eff_tools', name: '工具精通', description: '工具成功率 +10%', system: 'MusculoskeletalSystem', cost: 35, effect: 'success_rate+0.1', applied: false },
      { id: 'eff_repro', name: '进化加速', description: '进化就绪速度翻倍', system: 'ReproductiveSystem', cost: 40, effect: 'evolution_speed*2', applied: false },
    ];
  }

  applyUpgrade(upgradeId: string): boolean {
    const available = this.getAvailableUpgrades();
    const upgrade = available.find(u => u.id === upgradeId && !u.applied);
    if (!upgrade) return false;

    const stats = this.bus.getEnergyStats();
    if (stats.current < upgrade.cost) return false;

    this.bus.consumeEnergy('NovaAgent', upgrade.cost);
    upgrade.applied = true;
    this.upgrades.push(upgrade);
    this.wisdomScore += 2;
    this.memory.addFact(`upgrade:${upgrade.name}`, 'upgrade', 0.9);
    this.savePersonality();
    console.log(`[超体] ⚡ Anabolic upgrade: ${upgrade.name} (-${upgrade.cost} energy)`);
    return true;
  }

  async boot(): Promise<void> {
    console.log('[超体] Booting systems...');

    this.nervous = new NervousSystem();
    this.musculoskeletal = new MusculoskeletalSystem();
    this.endocrine = new EndocrineSystem();
    this.respiratory = new RespiratorySystem();
    this.digestive = new DigestiveSystem();
    this.urinary = new UrinarySystem();
    this.reproductive = new ReproductiveSystem();

    this.systems.set('NervousSystem', this.nervous);
    this.systems.set('MusculoskeletalSystem', this.musculoskeletal);
    this.systems.set('EndocrineSystem', this.endocrine);
    this.systems.set('RespiratorySystem', this.respiratory);
    this.systems.set('DigestiveSystem', this.digestive);
    this.systems.set('UrinarySystem', this.urinary);
    this.systems.set('ReproductiveSystem', this.reproductive);

    for (const [name, system] of this.systems) {
      await system.init();
      console.log(`  ✓ ${name} initialized`);
    }

    this.bus.setGrowthStage(this.stage);
    this.bus.startHeart();
    this.foraging.start(60000); // every 60s
    // Deep learning: every 5 minutes
    setInterval(() => this.learning.learnCycle(), 300000);
    this.isRunning = true;
    this.bus.pulse('system:boot-complete', { stage: this.stage }, 'NovaAgent');
    console.log(`\n[超体] ❤ Boot complete. Stage: ${this.stage} | Energy: ${this.bus.getEnergyStats().percent}%`);
  }

  async input(text: string): Promise<void> {
    console.log(`\n[USER] ${text}`);
    this.bus.pulse('input:raw', { text, timestamp: Date.now() }, 'User');
  }

  registerTool(name: string, description: string, execute: (...args: string[]) => Promise<unknown>): void {
    this.bus.pulse('tool:register', {
      name,
      description,
      handler: execute,
      usageCount: 0,
      successRate: 1.0
    } as never, 'User');
  }

  getStatus(): {
    stage: GrowthStage;
    uptime: number;
    actionCount: number;
    biometrics: Biometrics[];
    transitions: LifecycleTransition[];
  } {
    return {
      stage: this.stage,
      uptime: Date.now() - this.startTime,
      actionCount: this.actionCount,
      biometrics: Array.from(this.systems.values()).map(s => s.getBiometrics()),
      transitions: this.transitions
    };
  }

  getStage(): GrowthStage {
    return this.stage;
  }

  getEventLog() {
    return this.bus.getEventLog();
  }
}
