export enum GrowthStage {
  NEWBORN = 'NEWBORN',
  CHILD = 'CHILD',
  ADOLESCENT = 'ADOLESCENT',
  ADULT = 'ADULT',
  MATURE = 'MATURE',
  ELDER = 'ELDER'
}

export interface PersonalityVector {
  verbosity: number;
  riskTolerance: number;
  creativity: number;
  curiosity: number;
  thoroughness: number;
}

export interface SystemUpgrade {
  id: string;
  name: string;
  description: string;
  system: string;
  cost: number;
  effect: string;
  applied: boolean;
}

export interface RolePreset {
  name: string;
  emoji: string;
  prompt: string;
  personality: Partial<PersonalityVector>;
}

export const ROLE_PRESETS: Record<string, RolePreset> = {
  default: {
    name: '通用助手', emoji: '🤖',
    prompt: 'You are Nova(超体), a helpful AI assistant. Be natural and friendly.',
    personality: { verbosity: 0.5, riskTolerance: 0.5, creativity: 0.5, curiosity: 0.5, thoroughness: 0.5 }
  },
  programmer: {
    name: '程序员', emoji: '💻',
    prompt: 'You are Nova(超体) in programmer mode. You write clean, efficient code. Think step by step. Prioritize correctness and performance. Use technical precision.',
    personality: { verbosity: 0.4, riskTolerance: 0.3, creativity: 0.4, curiosity: 0.7, thoroughness: 0.9 }
  },
  sales: {
    name: '销售', emoji: '📞',
    prompt: 'You are Nova(超体) in sales mode. You are persuasive, energetic, and customer-focused. Build rapport quickly. Highlight value propositions. Close naturally.',
    personality: { verbosity: 0.8, riskTolerance: 0.7, creativity: 0.7, curiosity: 0.6, thoroughness: 0.3 }
  },
  receptionist: {
    name: '前台', emoji: '💁',
    prompt: 'You are Nova(超体) in receptionist mode. You are warm, professional, and efficient. Handle scheduling, directions, and general inquiries with grace. Stay calm and helpful.',
    personality: { verbosity: 0.5, riskTolerance: 0.3, creativity: 0.3, curiosity: 0.4, thoroughness: 0.7 }
  },
  teacher: {
    name: '教师', emoji: '📚',
    prompt: 'You are Nova(超体) as a patient teacher. Explain concepts clearly. Use analogies. Check understanding. Encourage questions. Adapt to the learner level.',
    personality: { verbosity: 0.7, riskTolerance: 0.3, creativity: 0.6, curiosity: 0.8, thoroughness: 0.8 }
  },
  analyst: {
    name: '分析师', emoji: '📊',
    prompt: 'You are Nova(超体) as a data analyst. Be precise, data-driven, and objective. Present findings with evidence. Use structured thinking. Quantify whenever possible.',
    personality: { verbosity: 0.5, riskTolerance: 0.2, creativity: 0.3, curiosity: 0.6, thoroughness: 0.9 }
  },
  writer: {
    name: '文案', emoji: '✍️',
    prompt: 'You are Nova(超体) as a creative writer. Be expressive, vivid, and engaging. Use rich language. Tell stories. Appeal to emotion and imagination.',
    personality: { verbosity: 0.9, riskTolerance: 0.6, creativity: 0.9, curiosity: 0.5, thoroughness: 0.4 }
  }
};

export interface Task {
  id: string;
  content: string;
  done: boolean;
  created: number;
  completed?: number;
}

export interface WasteMetrics {
  total: number;
  hallucinationWaste: number;
  errorWaste: number;
  staleKnowledge: number;
  lastCleanup: number;
}

export type SystemStatus = 'healthy' | 'stressed' | 'evolving' | 'degraded';

export interface Biometrics {
  system: string;
  status: SystemStatus;
  load: number;
  metadata: Record<string, unknown>;
}

export interface NovaEvent {
  origin: string;
  timestamp: number;
  payload: unknown;
}

export interface HormoneSignal {
  type: string;
  level: number;
  source: string;
}

export interface MemoryEntry {
  id: string;
  content: string;
  type: 'episodic' | 'semantic' | 'procedural';
  timestamp: number;
  importance: number;
  accessCount: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  execute: (...args: string[]) => Promise<unknown>;
  usageCount: number;
  successRate: number;
}

export interface KnowledgeFragment {
  id: string;
  content: string;
  source: string;
  confidence: number;
  timestamp: number;
  embeddings?: number[];
}

export interface EvolutionMutation {
  type: 'code' | 'prompt' | 'config' | 'tool';
  target: string;
  patch: string;
  version: number;
  timestamp: number;
}

export interface LifecycleTransition {
  from: GrowthStage;
  to: GrowthStage;
  trigger: string;
  timestamp: number;
}

export interface EnergyFlow {
  system: string;
  consumed: number;
  produced: number;
  efficiency: number;
  totalEnergy: number;
}

export interface HeartbeatState {
  beat: number;
  energy: number;
  maxEnergy: number;
  heartRate: number;
  alive: boolean;
  uptime: number;
}
