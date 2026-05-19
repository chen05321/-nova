/**
 * DigestiveSystem (Rewritten) — 知识消化系统
 *
 * 原版：只做 nutrientLevel/knowledgeFragments 计数
 * 新版：
 * 1. 接收原始知识 → 解析 → 结构化 → 注入 KnowledgeCore
 * 2. 将消化后的知识分发给目标系统
 * 3. 知识关联发现（新知识和已有知识的关系）
 * 4. 按照类别和置信度决定是否吸收
 */

import { CirculatorySystem } from './event-bus';
import { Biometrics, SystemStatus, KnowledgeNode, KnowledgeRelation, KnowledgeEvent, GrowthStage } from './types';
import { KnowledgeCore, KnowledgeEntity } from './knowledge-core/index';

interface Digestion {
  id: string;
  rawContent: string;
  structuredContent: string;
  category: string;
  confidence: number;
  targetSystems: string[];
  timestamp: number;
  status: 'pending' | 'digesting' | 'associated' | 'completed' | 'rejected';
}

interface DigestionStats {
  totalIngested: number;
  totalDigested: number;
  totalRejected: number;
  totalAssociations: number;
  categories: Record<string, number>;
  activeDigestions: number;
}

export class DigestiveSystem {
  private bus: CirculatorySystem;
  private knowledgeCore: KnowledgeCore;
  private digests: Map<string, Digestion> = new Map();
  private stats: DigestionStats = {
    totalIngested: 0, totalDigested: 0, totalRejected: 0,
    totalAssociations: 0, categories: {}, activeDigestions: 0
  };
  private isInitialized = false;
  private growStage: GrowthStage = GrowthStage.NEWBORN;

  // 分类关键词映射
  private categoryKeywords: Record<string, string[]> = {
    'programming': ['code', 'function', 'api', 'bug', 'typescript', 'python', 'debug', 'git', 'npm'],
    'system': ['server', 'config', 'deploy', 'memory', 'process', 'agent', 'tool'],
    'concept': ['theory', 'principle', 'pattern', 'architecture', 'design', 'strategy'],
    'experience': ['encountered', 'happened', 'tried', 'attempted', 'error', 'failed', 'succeeded'],
    'user': ['preference', 'name', 'personality', 'habit', 'likes', 'dislikes'],
  };

  private systemTargets: Record<string, string[]> = {
    'programming': ['NervousSystem', 'MusculoskeletalSystem'],
    'system': ['NervousSystem', 'ImmuneSystem'],
    'concept': ['NervousSystem', 'EndocrineSystem'],
    'experience': ['UrinarySystem', 'ReproductiveSystem'],
    'user': ['NervousSystem', 'EndocrineSystem'],
  };

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.knowledgeCore = KnowledgeCore.getInstance();
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    // Listen for incoming knowledge from LearningSystem
    this.bus.on('knowledge:raw-ingested', (data: any) => {
      const payload = data?.payload;
      if (payload?.content) {
        this.ingest(payload.content, payload.source || 'learning', payload.confidence || 0.5);
      }
    });

    // Listen for foraging results
    this.bus.on('foraging:result', (data: any) => {
      const payload = data?.payload;
      if (payload?.content) {
        this.ingest(payload.content, 'foraging', 0.6);
      }
    });

    this.isInitialized = true;
    console.log('[DigestiveSystem] ✅ Initialized — ready to digest knowledge');
  }

  /** 注入原始知识到消化管道 */
  async ingest(rawContent: string, source: string, confidence: number): Promise<string | null> {
    const id = `digest_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const category = this.classifyContent(rawContent);
    const targetSystems = this.mapTargetSystems(category);

    const digestion: Digestion = {
      id,
      rawContent,
      structuredContent: '',
      category,
      confidence,
      targetSystems,
      timestamp: Date.now(),
      status: 'pending',
    };

    this.digests.set(id, digestion);
    this.stats.totalIngested++;
    this.stats.categories[category] = (this.stats.categories[category] || 0) + 1;
    this.stats.activeDigestions++;

    // Fire event that digestion started
    this.bus.logKnowledgeEvent({
      id,
      type: 'digested',
      content: rawContent.substring(0, 100),
      sourceSystem: 'DigestiveSystem',
      targetSystems,
      categories: [category],
      confidence,
      timestamp: Date.now(),
    });

    // Start digestion (async)
    this.processDigestion(id).catch(err => {
      console.error(`[DigestiveSystem] ❌ Digestion failed for ${id}:`, err);
    });

    return id;
  }

  /** 处理单个消化任务 */
  private async processDigestion(id: string): Promise<void> {
    const digestion = this.digests.get(id);
    if (!digestion) return;

    digestion.status = 'digesting';

    // Step 1: Extract key information
    const summary = this.extractKnowledge(digestion.rawContent, digestion.category);

    // Step 2: Check if worth digesting (confidence threshold / novelty)
    if (summary.confidence < 0.3) {
      digestion.status = 'rejected';
      this.stats.totalRejected++;
      this.stats.activeDigestions--;
      this.bus.pulse('digestive:rejected', { id, reason: 'low_confidence', confidence: summary.confidence }, 'DigestiveSystem');
      return;
    }

    // Step 3: De-duplicate against existing knowledge
    const existing = this.knowledgeCore.search(summary.content);
    if (existing.length > 0 && existing[0].confidence > summary.confidence) {
      digestion.status = 'rejected';
      this.stats.totalRejected++;
      this.stats.activeDigestions--;
      this.bus.pulse('digestive:rejected', { id, reason: 'duplicate', existingId: existing[0].id }, 'DigestiveSystem');
      return;
    }

    // Step 4: Store to KnowledgeCore
    const entity = this.knowledgeCore.addEntity(
      summary.label,
      summary.type as KnowledgeEntity['type'],
      [summary.content],
      `DigestiveSystem:${digestion.category}`,
      undefined,
      summary.confidence,
    );
    const relations = this.knowledgeCore.getRelations(entity.id);

    digestion.structuredContent = summary.content;
    digestion.confidence = summary.confidence;

    // Step 5: Find associations with existing knowledge
    digestion.status = 'associated';

    if (relations.length > 0) {
      this.stats.totalAssociations += relations.length;
      this.bus.pulse('digestive:associations', {
        id,
        associations: relations.map(r => `${r.from} → ${r.to} (${r.type})`)
      }, 'DigestiveSystem');
    }

    // Step 6: Distribute knowledge to target systems
    digestion.status = 'completed';
    this.stats.totalDigested++;
    this.stats.activeDigestions--;

    const knowledgeEvent: KnowledgeEvent = {
      id,
      type: 'digested',
      content: summary.content,
      sourceSystem: 'DigestiveSystem',
      targetSystems: digestion.targetSystems,
      categories: [digestion.category],
      confidence: summary.confidence,
      timestamp: Date.now(),
      relatedIds: relations.map(r => r.to),
    };

    this.bus.logKnowledgeEvent(knowledgeEvent);

    // Send structured signal to each target system
    for (const target of digestion.targetSystems) {
      this.bus.sendSignal({
        source: 'DigestiveSystem',
        target: [target],
        type: 'knowledge:digested',
        payload: {
          knowledgeId: entity.id,
          label: summary.label,
          content: summary.content,
          category: digestion.category,
          confidence: summary.confidence,
          relations: relations.length,
        },
        chain: ['DigestiveSystem'],
        priority: summary.confidence > 0.8 ? 'high' : 'normal',
        ttl: 60000,
      });
    }

    this.bus.pulse('digestive:completed', {
      id, label: summary.label, category: digestion.category,
      targetSystems: digestion.targetSystems,
      associations: relations.length,
      confidence: summary.confidence,
    }, 'DigestiveSystem');
  }

  /** 给未处理知识打标签（无LLM时用关键词匹配） */
  private classifyContent(content: string): string {
    const lower = content.toLowerCase();
    const scores: Record<string, number> = {};

    for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
      scores[category] = keywords.filter(k => lower.includes(k)).length;
    }

    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] > 0 ? best[0] : 'general';
  }

  private mapTargetSystems(category: string): string[] {
    return this.systemTargets[category] || ['NervousSystem'];
  }

  /** 从原始内容提取结构化知识（无LLM） */
  private extractKnowledge(content: string, category: string): {
    label: string;
    type: KnowledgeNode['type'];
    content: string;
    confidence: number;
  } {
    const clean = content.trim();
    const firstLine = clean.split('\n')[0].substring(0, 60);

    if (clean.length < 20) {
      return { label: firstLine, type: 'fact', content: clean, confidence: 0.4 };
    }

    if (category === 'programming' || category === 'system') {
      return { label: firstLine, type: 'skill', content: clean, confidence: 0.7 };
    }

    if (category === 'experience') {
      return { label: firstLine, type: 'experience', content: clean, confidence: 0.6 };
    }

    if (category === 'concept') {
      return { label: firstLine, type: 'concept', content: clean, confidence: 0.5 };
    }

    return { label: firstLine, type: 'fact', content: clean, confidence: 0.5 };
  }

  /** 获取消化统计 */
  getStats(): DigestionStats {
    return { ...this.stats };
  }

  /** 获取当前正在消化的任务 */
  getActiveDigestions(): Digestion[] {
    return Array.from(this.digests.values()).filter(d => d.status !== 'completed' && d.status !== 'rejected');
  }

  /** 获取最近完成的消化 */
  getRecentDigestions(limit = 10): Digestion[] {
    return Array.from(this.digests.values())
      .filter(d => d.status === 'completed' || d.status === 'associated')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  getBiometrics(): Biometrics {
    const now = Date.now();
    return {
      system: 'DigestiveSystem',
      status: this.stats.activeDigestions > 3 ? 'stressed' : 'healthy',
      load: this.stats.activeDigestions / 10,
      metadata: {
        totalIngested: this.stats.totalIngested,
        totalDigested: this.stats.totalDigested,
        totalRejected: this.stats.totalRejected,
        totalAssociations: this.stats.totalAssociations,
        activeDigestions: this.stats.activeDigestions,
        categories: this.stats.categories,
        knowledgeNodes: this.knowledgeCore.getStats().totalNodes,
      }
    };
  }

  async destroy(): Promise<void> {
    this.bus.removeAllListeners('knowledge:raw-ingested');
    this.bus.removeAllListeners('foraging:result');
  }
}
