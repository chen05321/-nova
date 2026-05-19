/**
 * NervousSystem (Rewritten) — 神经中枢 / 注意力分配 / 知识路由
 *
 * 原版：大型fetch封装 + 简单事件广播，没有真正的"神经"
 * 新版：
 * 1. 知识路由：接收 DigestiveSystem 消化后的知识，分发到合适系统
 * 2. 注意力分配：根据当前状态决定各系统的注意力权重
 * 3. 跨系统协调：主动调度系统间协同工作
 * 4. 决策中枢：所有"应该做什么"的决策从这里发出
 */

import { CirculatorySystem, SystemSignal } from './event-bus';
import { KnowledgeCore } from './knowledge-core/index';
import {
  Biometrics, SystemStatus, GrowthStage, KnowledgeEvent,
  AttentionAllocation, SystemLink, KnowledgeNode
} from './types';

interface AttentionState {
  primary: string;           // 当前主导系统
  allocations: AttentionAllocation[];
  lastRebalance: number;
  rebalanceInterval: number; // ms
}

interface KnowledgeRoute {
  knowledgeId: string;
  from: string;
  to: string[];
  routedAt: number;
}

interface NervousStats {
  totalSignalsProcessed: number;
  totalKnowledgeRouted: number;
  totalCrossSystemOps: number;
  avgReactionTime: number;
  rebalances: number;
  activeFoci: string[];
}

interface SystemContext {
  name: string;
  capabilities: string[];
  lastActive: number;
  load: number;
  knowledgeInterests: string[];
}

export class NervousSystem {
  private bus!: CirculatorySystem;
  private knowledgeCore!: KnowledgeCore;
  private attention!: AttentionState;
  private routes: KnowledgeRoute[] = [];
  private stats: NervousStats = {
    totalSignalsProcessed: 0, totalKnowledgeRouted: 0,
    totalCrossSystemOps: 0, avgReactionTime: 0,
    rebalances: 0, activeFoci: []
  };
  private isInitialized = false;
  private signalTimestamps: number[] = [];
  private registeredSystems: Map<string, SystemContext> = new Map();
  private focusTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.knowledgeCore = KnowledgeCore.getInstance();
    this.attention = {
      primary: 'NervousSystem',
      allocations: [],
      lastRebalance: Date.now(),
      rebalanceInterval: 30000,
    };
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.registerSystem('DigestiveSystem', ['digestion', 'knowledge_processing'], ['programming', 'concept', 'general']);
    this.registerSystem('MusculoskeletalSystem', ['action', 'tool_use'], ['programming', 'experience']);
    this.registerSystem('EndocrineSystem', ['hormone', 'mood'], ['user', 'experience']);
    this.registerSystem('RespiratorySystem', ['energy', 'tokens'], []);
    this.registerSystem('UrinarySystem', ['memory', 'waste'], ['experience']);
    this.registerSystem('ReproductiveSystem', ['evolution', 'mutation'], ['pattern', 'skill']);
    this.registerSystem('ImmuneSystem', ['protection', 'error_recovery'], []);

    this.bus.on('signal:NervousSystem', (data: any) => {
      const signal = data?.payload as SystemSignal;
      if (signal?.type === 'knowledge:digested') {
        this.routeKnowledge(signal);
      }
    });

    this.bus.on('knowledge:event', (data: any) => {
      const event = data?.payload as KnowledgeEvent;
      if (event) {
        this.processKnowledgeEvent(event);
      }
    });

    this.focusTimer = setInterval(() => this.rebalanceAttention(), this.attention.rebalanceInterval);
    this.isInitialized = true;
  }

  private registerSystem(name: string, capabilities: string[], knowledgeInterests: string[]): void {
    this.registeredSystems.set(name, {
      name, capabilities, knowledgeInterests,
      lastActive: Date.now(), load: 0,
    });
  }

  private routeKnowledge(signal: SystemSignal): void {
    const knowledgeId = signal.source || 'unknown';
    const payload = signal.payload as any || {};
    const targets = this.determineTargets(payload);

    const route: KnowledgeRoute = {
      knowledgeId,
      from: 'DigestiveSystem',
      to: targets,
      routedAt: Date.now(),
    };
    this.routes.push(route);
    if (this.routes.length > 100) this.routes.shift();
    this.stats.totalKnowledgeRouted++;

    for (const target of targets) {
      this.bus.pulse(`signal:${target}`, {
        type: 'knowledge:routed',
        source: 'NervousSystem',
        payload: { ...payload, route },
      }, 'NervousSystem');
    }

    this.stats.totalCrossSystemOps += targets.length;
  }

  private determineTargets(payload: any): string[] {
    const tags: string[] = payload.tags || [];
    const category = payload.category || '';

    const targets = new Set<string>();

    const tagToSystem: Record<string, string> = {
      'programming': 'MusculoskeletalSystem',
      'tool': 'MusculoskeletalSystem',
      'digestion': 'DigestiveSystem',
      'concept': 'DigestiveSystem',
      'error': 'ImmuneSystem',
      'safety': 'ImmuneSystem',
      'memory': 'UrinarySystem',
      'cache': 'UrinarySystem',
      'evolution': 'ReproductiveSystem',
      'pattern': 'ReproductiveSystem',
      'skill': 'ReproductiveSystem',
    };

    for (const tag of tags) {
      const sys = tagToSystem[tag.toLowerCase()];
      if (sys) targets.add(sys);
    }

    const categoryToSystem: Record<string, string> = {
      'programming': 'MusculoskeletalSystem',
      'general': 'DigestiveSystem',
      'auto-discovered': 'DigestiveSystem',
    };
    const catSys = categoryToSystem[category];
    if (catSys) targets.add(catSys);

    return targets.size > 0 ? [...targets] : ['DigestiveSystem'];
  }

  private processKnowledgeEvent(event: KnowledgeEvent): void {
    this.stats.totalSignalsProcessed++;
    this.signalTimestamps.push(Date.now());
    if (this.signalTimestamps.length > 100) this.signalTimestamps.shift();

    if (event.relatedIds && event.relatedIds.length > 0) {
      this.bus.pulse('knowledge:association', {
        type: 'knowledge:associations',
        source: 'NervousSystem',
        payload: {
          entityId: event.id,
          linked: event.relatedIds,
        },
      }, 'NervousSystem');
    }
  }

  private rebalanceAttention(): void {
    const now = Date.now();
    const total = this.registeredSystems.size;
    if (total === 0) return;

    const allocations: AttentionAllocation[] = [];
    let maxActivity = 0;
    let primary = 'NervousSystem';

    for (const [name, ctx] of this.registeredSystems) {
      const recentActivity = this.signalTimestamps.filter(
        t => now - t < 60000
      ).length;
      const activityWeight = Math.min(1, recentActivity / 10);
      const loadPenalty = Math.max(0, 1 - ctx.load);
      const focus = activityWeight * 0.6 + loadPenalty * 0.4;

      const rawFocus = activityWeight * 0.6 + loadPenalty * 0.4;
      allocations.push({ system: name, focus: rawFocus, activeKnowledge: [], lastAction: 'system_monitor', timestamp: now });
      if (focus > maxActivity) {
        maxActivity = focus;
        primary = name;
      }
    }

    // Normalize so all allocations sum to 1
    const totalFocus = allocations.reduce((s, a) => s + a.focus, 0);
    if (totalFocus > 0) {
      for (const a of allocations) {
        a.focus = a.focus / totalFocus;
      }
      // Re-sort after normalize
      allocations.sort((a, b) => b.focus - a.focus);
    }

    this.attention.allocations = allocations.sort((a, b) => b.focus - a.focus);
    this.attention.primary = primary;
    this.attention.lastRebalance = now;
    this.stats.activeFoci = allocations.filter(a => a.focus > 0.3).map(a => a.system);
    this.stats.rebalances++;
  }

  // ═══════ KnowledgeCore API ═══════

  getById(id: string): { name: string; observations: string[]; tags: string[]; confidence: number } | null {
    const entity = (this.knowledgeCore as any).entities?.get?.(id);
    if (!entity) return null;
    return {
      name: entity.name,
      observations: entity.observations || [],
      tags: entity.tags || [],
      confidence: entity.confidence || 0,
    };
  }

  getAttentionState(): { primary: string; allocations: AttentionAllocation[] } {
    return {
      primary: this.attention.primary,
      allocations: this.attention.allocations,
    };
  }

  setSystemPrompt(_prompt: string): void {
    // Placeholder — CLI compat
  }

  getBiometrics(): Biometrics {
    return {
      system: 'NervousSystem',
      status: this.isInitialized ? 'healthy' : 'stressed',
      load: this.registeredSystems.size,
      metadata: {
        temperature: 0.5,
        lastActive: Date.now(),
        signalsProcessed: this.stats.totalSignalsProcessed,
        activeFoci: this.stats.activeFoci,
      },
    };
  }

  getStatus(): SystemStatus {
    return this.isInitialized ? 'healthy' : 'degraded';
  }

  getStats(): NervousStats {
    return { ...this.stats };
  }

  getSystemLinks(): SystemLink[] {
    const links: SystemLink[] = [];
    for (const [name] of this.registeredSystems) {
      if (name !== 'NervousSystem') {
        links.push({
          source: 'NervousSystem',
          target: name,
          type: 'control',
          flowRate: (this.attention.allocations.find(a => a.system === name)?.focus ?? 0.5),
          knowledgeTypes: [],
        });
      }
    }
    return links;
  }

  getAttentionSummary(): string[] {
    return this.attention.allocations
      .filter(a => a.focus > 0.1)
      .map(a => `${a.system}: ${(a.focus * 100).toFixed(0)}%`);
  }

  /** Emit agent:response so AgentLoop.execute() can resolve */
  emitResponse(response: string): void {
    this.bus.pulse('agent:response', { response }, 'NervousSystem');
  }

  destroy(): void {
    if (this.focusTimer) clearInterval(this.focusTimer);
    this.isInitialized = false;
  }
}
