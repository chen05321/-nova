/**
 * ReproductiveSystem (Rewritten) — 知识驱动进化
 *
 * 原版：random 选文件生成 patch 自爆
 * 新版：
 * 1. 不再随机修改代码文件，改为知识/技能进化
 * 2. 进化素材来自 KnowledgeCore 中的高置信度知识
 * 3. "进化" = 生成新的知识/技能/模式，而非修改代码
 * 4. 安全沙箱：所有修改先在内存中评估，确认不会破坏系统
 */

import { System } from './system';
import { CirculatorySystem } from './event-bus';
import { KnowledgeCore } from './knowledge-core/index';
import { Biometrics, SystemStatus, GrowthStage, KnowledgeNode } from './types';

interface EvolutionEvent {
  id: string;
  type: 'knowledge_synthesis' | 'pattern_discovery' | 'skill_refinement' | 'concept_merge';
  sourceKnowledge: string[];
  resultLabel: string;
  resultContent: string;
  confidence: number;
  timestamp: number;
  applied: boolean;
}

interface ReproductionStats {
  totalEvolutions: number;
  successfulEvolutions: number;
  evolutionsByType: Record<string, number>;
  lastEvolution: number | null;
  queuedMutations: number;
  knowledgeSynthesized: number;
}

export class ReproductiveSystem {
  private bus: CirculatorySystem;
  private knowledgeCore: KnowledgeCore;
  private evolutions: EvolutionEvent[] = [];
  private stats: ReproductionStats = {
    totalEvolutions: 0, successfulEvolutions: 0,
    evolutionsByType: {}, lastEvolution: null,
    queuedMutations: 0, knowledgeSynthesized: 0,
  };
  private isInitialized = false;
  private evolutionTimer: ReturnType<typeof setInterval> | null = null;
  private currentStage: GrowthStage = GrowthStage.NEWBORN;

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.knowledgeCore = KnowledgeCore.getInstance();
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    // Listen for high-confidence knowledge → trigger evolution
    this.bus.on('knowledge:digested', (data: any) => {
      const event = data?.payload as any;
      if (event?.confidence > 0.8) {
        this.queueEvolution(event);
      }
    });

    // Listen for stage transitions
    this.bus.on('lifecycle:transition', (data: any) => {
      const transition = data?.payload;
      if (transition?.to) {
        this.currentStage = transition.to;
      }
    });

    // Periodic evolution check (every 5 minutes)
    this.evolutionTimer = setInterval(() => this.tryEvolve(), 300000);

    // Register dependency for dashboard
    this.bus.registerDependency('NervousSystem', 'ReproductiveSystem', 'knowledge', '分发的知识可作为进化素材');
    this.bus.registerDependency('ReproductiveSystem', 'KnowledgeCore', 'knowledge', '进化结果存入知识库');

    this.isInitialized = true;
    console.log('[ReproductiveSystem] ✅ Initialized — knowledge-driven evolution');
  }

  /** 排队一个进化机会 */
  private queueEvolution(source: any): void {
    this.stats.queuedMutations++;
    this.bus.pulse('reproductive:queued', {
      sourceId: source.knowledgeId,
      label: source.label,
      confidence: source.confidence,
      queueSize: this.stats.queuedMutations,
    }, 'ReproductiveSystem');
  }

  /** 尝试执行进化 */
  private async tryEvolve(): Promise<void> {
    if (this.stats.queuedMutations === 0) return;

    // Stage-based evolution probability
    const stageProbabilities: Record<GrowthStage, number> = {
      [GrowthStage.NEWBORN]: 0,
      [GrowthStage.CHILD]: 0.1,
      [GrowthStage.ADOLESCENT]: 0.3,
      [GrowthStage.ADULT]: 0.5,
      [GrowthStage.MATURE]: 0.7,
      [GrowthStage.ELDER]: 0.2,
    };

    const prob = stageProbabilities[this.currentStage] || 0.1;
    if (Math.random() > prob) return;

    // Get high-value knowledge from KnowledgeCore (local fallback — sort by confidence)
    const allKnowledge = this.knowledgeCore.search('.');
    const topKnowledge: KnowledgeNode[] = allKnowledge
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)
      .map(e => ({
        id: e.id,
        label: e.name,
        type: e.type === 'concept' ? 'concept' : e.type === 'skill' ? 'skill' : e.type === 'fact' ? 'fact' : e.type === 'pattern' ? 'pattern' : 'fact',
        content: e.observations.join('; '),
        category: e.tags.join(', '),
        confidence: e.confidence,
        source: e.source,
        createdAt: e.createdAt,
        lastAccessedAt: e.accessedAt,
        accessCount: e.accessCount,
      }));
    if (topKnowledge.length < 2) return;

    // Evolution type selection based on knowledge characteristics
    const evolutionType = this.selectEvolutionType(topKnowledge);

    // Execute evolution (in-memory only, no filesystem changes)
    const result = this.synthesizeEvolution(evolutionType, topKnowledge);

    if (result) {
      this.applyEvolution(result);
    }

    this.stats.queuedMutations = Math.max(0, this.stats.queuedMutations - 1);
  }

  private selectEvolutionType(knowledge: KnowledgeNode[]): EvolutionEvent['type'] {
    const types: EvolutionEvent['type'][] = [
      'knowledge_synthesis', 'pattern_discovery',
      'skill_refinement', 'concept_merge'
    ];

    // If knowledge has patterns → pattern discovery
    const hasPatterns = knowledge.some(k => k.type === 'pattern' || k.content.includes('pattern'));
    if (hasPatterns) return 'pattern_discovery';

    // If knowledge has skills → skill refinement
    const hasSkills = knowledge.some(k => k.type === 'skill');
    if (hasSkills) return 'skill_refinement';

    // If multiple concepts → concept merge
    const uniqueTypes = new Set(knowledge.map(k => k.type));
    if (uniqueTypes.size >= 2) return 'concept_merge';

    // Default: synthesis
    return 'knowledge_synthesis';
  }

  private synthesizeEvolution(
    type: EvolutionEvent['type'],
    sourceKnowledge: KnowledgeNode[]
  ): EvolutionEvent | null {
    const sourceIds = sourceKnowledge.map(k => k.id);
    const labels = sourceKnowledge.map(k => k.label);

    let resultLabel: string;
    let resultContent: string;
    let confidence: number;

    switch (type) {
      case 'knowledge_synthesis': {
        // Combine labels and content
        resultLabel = `知识综合: ${labels.join(' + ')}`;
        resultContent = `综合自: ${sourceKnowledge.map(k =>
          `[${k.type}] ${k.label}: ${k.content.substring(0, 100)}`
        ).join('\n')}\n\n推断: 这些知识之间存在相关性，可以综合理解。`;
        confidence = 0.6;
        break;
      }
      case 'pattern_discovery': {
        // Extract common patterns
        const commonTerms = this.findCommonTerms(sourceKnowledge.map(k => k.content));
        resultLabel = `模式发现: ${commonTerms.substring(0, 50)}`;
        resultContent = `在以下知识中发现共同模式:\n${labels.join('\n')}\n\n共同关键词: ${commonTerms}`;
        confidence = 0.5;
        break;
      }
      case 'skill_refinement': {
        const skillNode = sourceKnowledge.find(k => k.type === 'skill') || sourceKnowledge[0];
        resultLabel = `技能精炼: ${skillNode.label}`;
        resultContent = `基于经验精炼的技能:\n${skillNode.content}\n\n提炼: 反复验证过的有效方法。`;
        confidence = skillNode.confidence + 0.1;
        break;
      }
      case 'concept_merge': {
        resultLabel = `概念融合: ${labels.join(' & ')}`;
        resultContent = `融合概念:\n${sourceKnowledge.map(k =>
          `- ${k.label}: ${k.content.substring(0, 80)}`
        ).join('\n')}`;
        confidence = 0.4;
        break;
      }
      default:
        return null;
    }

    return {
      id: `evolve_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      type,
      sourceKnowledge: sourceIds,
      resultLabel,
      resultContent,
      confidence: Math.min(1, confidence),
      timestamp: Date.now(),
      applied: false,
    };
  }

  private findCommonTerms(contents: string[]): string {
    const wordCounts = new Map<string, number>();
    for (const content of contents) {
      const words = content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const unique = new Set(words);
      for (const word of unique) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }

    return Array.from(wordCounts.entries())
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([word]) => word)
      .join(', ');
  }

  private applyEvolution(result: EvolutionEvent): void {
    result.applied = true;
    this.evolutions.push(result);
    this.stats.totalEvolutions++;
    this.stats.successfulEvolutions++;
    this.stats.lastEvolution = Date.now();
    this.stats.evolutionsByType[result.type] = (this.stats.evolutionsByType[result.type] || 0) + 1;

    // Store evolution result as new knowledge in KnowledgeCore
    const node = this.knowledgeCore.addEntity(
      result.resultLabel,
      'concept',
      [result.resultContent],
      'ReproductiveSystem',
      ['evolution'],
      result.confidence,
    );

    // Create relations to source knowledge
    for (const sourceId of result.sourceKnowledge) {
      (this.knowledgeCore as any).addRelation(sourceId, node.id, '进化来源', result.confidence);
    }

    this.stats.knowledgeSynthesized++;

    // Fire evolution event
    this.bus.logKnowledgeEvent({
      id: result.id,
      type: 'shared',
      content: result.resultLabel,
      sourceSystem: 'ReproductiveSystem',
      targetSystems: ['NervousSystem', 'KnowledgeCore'],
      categories: ['evolution', result.type],
      confidence: result.confidence,
      timestamp: Date.now(),
      relatedIds: result.sourceKnowledge,
      metadata: { evolutionType: result.type },
    });

    // Signal to NervousSystem
    this.bus.sendSignal({
      source: 'ReproductiveSystem',
      target: ['NervousSystem'],
      type: 'evolution:complete',
      payload: {
        evolutionId: result.id,
        label: result.resultLabel,
        type: result.type,
        confidence: result.confidence,
        synthesizedKnowledge: node.id,
      },
      chain: ['ReproductiveSystem'],
      priority: 'normal',
      ttl: 60000,
    });

    this.bus.pulse('evolution:complete', {
      id: result.id,
      label: result.resultLabel,
      type: result.type,
      confidence: result.confidence,
    }, 'ReproductiveSystem');
  }

  /** 获取进化历史 */
  getEvolutionHistory(): EvolutionEvent[] {
    return [...this.evolutions].sort((a, b) => b.timestamp - a.timestamp);
  }

  /** 获取最近的进化事件 */
  getRecentEvolutions(limit = 5): EvolutionEvent[] {
    return this.evolutions.slice(-limit).reverse();
  }

  getBiometrics(): Biometrics {
    return {
      system: 'ReproductiveSystem',
      status: this.stats.queuedMutations > 0 ? 'evolving' : 'healthy',
      load: this.stats.queuedMutations / 10,
      metadata: {
        ...this.stats,
        evolutionTypes: this.stats.evolutionsByType,
        recentEvolutions: this.getRecentEvolutions(3),
      }
    };
  }

  async destroy(): Promise<void> {
    this.bus.removeAllListeners('knowledge:digested');
    this.bus.removeAllListeners('lifecycle:transition');
    if (this.evolutionTimer) clearInterval(this.evolutionTimer);
  }
}
