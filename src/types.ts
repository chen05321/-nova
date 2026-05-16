export enum GrowthStage {
  NEWBORN = 'NEWBORN',
  CHILD = 'CHILD',
  ADOLESCENT = 'ADOLESCENT',
  ADULT = 'ADULT',
  MATURE = 'MATURE'
}

export type SystemStatus = 'healthy' | 'stressed' | 'evolving' | 'degraded';

export interface Biometrics {
  system: string;
  status: SystemStatus;
  load: number;
  metadata: Record<string, unknown>;
}

export interface HermesEvent {
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
