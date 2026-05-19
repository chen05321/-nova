/**
 * KnowledgeCore — 统一知识层
 *
 * Nova 所有系统的知识共用底座。负责：
 * 1. 知识图谱存储（实体-关系-观察）
 * 2. 知识分类和标签索引
 * 3. 跨系统知识路由（哪个系统应该处理什么知识）
 * 4. 知识关联（新知识和已有知识的连接）
 * 5. 知识查询（按系统/标签/文本）
 *
 * 所有子系统（Nervous/Digestive/Learning/Urinary/Reproductive）都
 * 通过 KnowledgeCore 交互，不再各自维护独立数据孤岛。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/* ─── 类型定义 ─── */

export interface KnowledgeEntity {
  id: string;
  name: string;
  type: 'concept' | 'skill' | 'fact' | 'pattern' | 'error' | 'tool' | 'system';
  observations: string[];
  tags: string[];
  source: string;            // 来源系统名
  confidence: number;        // 0-1
  createdAt: number;
  accessedAt: number;
  accessCount: number;
}

export interface KnowledgeRelation {
  from: string;           // entity id
  to: string;             // entity id
  type: string;           // 'derived_from' | 'related_to' | 'causes' | 'improves' | 'conflicts_with'
  strength: number;       // 0-1
  createdAt: number;
}

export interface KnowledgeEvent {
  type: 'entity:created' | 'entity:updated' | 'relation:created' | 'knowledge:linked' | 'system:query';
  entityId?: string;
  sourceSystem: string;
  targetSystems: string[];   // 需要通知哪些系统
  payload: Record<string, unknown>;
  timestamp: number;
}

/* ─── 系统知识分类映射 ───
 * 每条知识学完后，KnowledgeCore 自动决定应该路由到哪个系统处理
 */
const SYSTEM_KNOWLEDGE_MAP: Record<string, { system: string; tags: string[] }> = {
  'file':       { system: 'MusculoskeletalSystem', tags: ['工具', '文件'] },
  '读写':       { system: 'MusculoskeletalSystem', tags: ['工具', '文件'] },
  'shell':      { system: 'MusculoskeletalSystem', tags: ['工具', 'shell'] },
  'git':        { system: 'MusculoskeletalSystem', tags: ['工具', 'git'] },
  'search':     { system: 'MusculoskeletalSystem', tags: ['工具', '搜索'] },
  '网络':       { system: 'NervousSystem', tags: ['网络', '思维'] },
  '代码':       { system: 'NervousSystem', tags: ['代码', '思维'] },
  '项目':       { system: 'NervousSystem', tags: ['项目', '思维'] },
  'prompt':     { system: 'NervousSystem', tags: ['提示词', '思维'] },
  '数据':       { system: 'DigestiveSystem', tags: ['数据', '消化'] },
  'json':       { system: 'DigestiveSystem', tags: ['数据', '解析'] },
  '记忆':       { system: 'UrinarySystem', tags: ['记忆', '过滤'] },
  '缓存':       { system: 'UrinarySystem', tags: ['记忆', '缓存'] },
  '进化':       { system: 'ReproductiveSystem', tags: ['进化', '迭代'] },
  '错误':       { system: 'ImmuneSystem', tags: ['错误', '安全'] },
  '安全':       { system: 'ImmuneSystem', tags: ['安全', '防护'] },
  'energy':     { system: 'CirculatorySystem', tags: ['能量', '心跳'] },
  'token':      { system: 'RespiratorySystem', tags: ['token', '呼吸'] },
  '激素':       { system: 'EndocrineSystem', tags: ['激素', '情绪'] },
};

/* ─── KnowledgeCore ─── */

type EventCallback = (event: KnowledgeEvent) => void;

export class KnowledgeCore {
  private static _instance: KnowledgeCore | null = null;

  static getInstance(persistenceDir?: string): KnowledgeCore {
    if (!KnowledgeCore._instance) {
      KnowledgeCore._instance = new KnowledgeCore(persistenceDir);
    }
    return KnowledgeCore._instance;
  }

  private entities: Map<string, KnowledgeEntity> = new Map();
  private relations: KnowledgeRelation[] = [];
  private tagIndex: Map<string, string[]> = new Map();    // tag → entityIds
  private systemIndex: Map<string, string[]> = new Map();  // system → entityIds
  private listeners: Map<string, EventCallback[]> = new Map();
  private persistencePath: string;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(persistenceDir?: string) {
    const dir = persistenceDir || path.join(os.homedir(), '.nova', 'knowledge');
    fs.mkdirSync(dir, { recursive: true });
    this.persistencePath = path.join(dir, 'knowledge-graph.json');
    this.load();
    // 每 30 秒自动持久化
    this.autoSaveTimer = setInterval(() => this.save(), 30000);
  }

  /* ─── 实体操作 ─── */

  /** 添加一条知识实体，自动分类+索引+路由 */
  addEntity(
    name: string,
    type: KnowledgeEntity['type'],
    observations: string[],
    source: string,
    tags?: string[],
    confidence?: number
  ): KnowledgeEntity {
    const id = this.generateId(name);
    const now = Date.now();
    const classifiedTags = this.classifyKnowledge(name, tags);

    const entity: KnowledgeEntity = {
      id,
      name,
      type,
      observations,
      tags: classifiedTags,
      source,
      confidence: confidence ?? 0.5,
      createdAt: now,
      accessedAt: now,
      accessCount: 0,
    };

    this.entities.set(id, entity);
    this.indexEntity(entity);

    // 自动关联已有知识
    const linked = this.autoLink(entity);

    // 路由到目标系统
    const targetSystems = this.determineTargetSystems(entity);
    const event: KnowledgeEvent = {
      type: 'entity:created',
      entityId: id,
      sourceSystem: source,
      targetSystems,
      payload: {
        entity: { name, type, observations, tags: classifiedTags, confidence },
        linkedEntities: linked,
      },
      timestamp: now,
    };
    this.emit(event);

    return entity;
  }

  /** 更新已有实体 */
  updateEntity(id: string, updates: Partial<KnowledgeEntity>): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;

    if (updates.observations) {
      // 去重追加
      const existing = new Set(entity.observations);
      for (const obs of updates.observations) {
        if (!existing.has(obs)) {
          entity.observations.push(obs);
          existing.add(obs);
        }
      }
    }
    if (updates.confidence !== undefined) entity.confidence = updates.confidence;
    if (updates.tags) {
      entity.tags = [...new Set([...entity.tags, ...updates.tags])];
      this.indexEntity(entity); // re-index
    }
    entity.accessedAt = Date.now();
    entity.accessCount++;

    this.emit({
      type: 'entity:updated',
      entityId: id,
      sourceSystem: updates.source || 'unknown',
      targetSystems: this.determineTargetSystems(entity),
      payload: { updates },
      timestamp: Date.now(),
    });
    return true;
  }

  /** 根据关键词/描述搜索知识 */
  search(query: string, options?: { system?: string; tag?: string; limit?: number }): KnowledgeEntity[] {
    const q = query.toLowerCase();
    let results: KnowledgeEntity[] = [];

    // 先从 tag 索引缩小范围
    let candidateIds: Set<string> | null = null;
    if (options?.tag && this.tagIndex.has(options.tag)) {
      candidateIds = new Set(this.tagIndex.get(options.tag)!);
    }
    if (options?.system && this.systemIndex.has(options.system)) {
      const sysIds = new Set(this.systemIndex.get(options.system)!);
      candidateIds = candidateIds
        ? new Set([...candidateIds].filter(x => sysIds.has(x)))
        : sysIds;
    }

    const limit = options?.limit || 20;
    const source = candidateIds
      ? [...candidateIds].map(id => this.entities.get(id)).filter(Boolean) as KnowledgeEntity[]
      : [...this.entities.values()];

    for (const entity of source) {
      if (
        entity.name.toLowerCase().includes(q) ||
        entity.observations.some(o => o.toLowerCase().includes(q)) ||
        entity.tags.some(t => t.toLowerCase().includes(q))
      ) {
        results.push(entity);
      }
    }

    // 按访问频率排序
    results.sort((a, b) => b.accessCount - a.accessCount);
    return results.slice(0, limit);
  }

  /** 获取某个系统相关的所有知识 */
  getSystemKnowledge(system: string): KnowledgeEntity[] {
    const ids = this.systemIndex.get(system);
    if (!ids) return [];
    return ids.map(id => this.entities.get(id)).filter(Boolean) as KnowledgeEntity[];
  }

  /** 获取实体之间的关系 */
  getRelations(entityId: string): KnowledgeRelation[] {
    return this.relations.filter(r => r.from === entityId || r.to === entityId);
  }

  /** 获取知识图谱摘要（用于dashboard） */
  getGraphSummary(): {
    totalEntities: number;
    totalRelations: number;
    byType: Record<string, number>;
    bySystem: Record<string, number>;
    recentActivity: KnowledgeEntity[];
    topLinked: { name: string; relationCount: number }[];
  } {
    const byType: Record<string, number> = {};
    const bySystem: Record<string, number> = {};
    for (const e of this.entities.values()) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      bySystem[e.source] = (bySystem[e.source] || 0) + 1;
    }

    const recentActivity = [...this.entities.values()]
      .sort((a, b) => b.accessedAt - a.accessedAt)
      .slice(0, 10);

    const relationCount = new Map<string, number>();
    for (const r of this.relations) {
      relationCount.set(r.from, (relationCount.get(r.from) || 0) + 1);
      relationCount.set(r.to, (relationCount.get(r.to) || 0) + 1);
    }
    const topLinked = [...relationCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ name: this.entities.get(id)?.name || id, relationCount: count }));

    return {
      totalEntities: this.entities.size,
      totalRelations: this.relations.length,
      byType,
      bySystem,
      recentActivity,
      topLinked,
    };
  }

  /** 获取系统间知识流动统计 */
  getCrossSystemFlow(): { from: string; to: string; count: number }[] {
    const flow: Map<string, number> = new Map();
    for (const e of this.entities.values()) {
      const targets = this.determineTargetSystems(e);
      for (const t of targets) {
        const key = `${e.source}→${t}`;
        flow.set(key, (flow.get(key) || 0) + 1);
      }
    }
    return [...flow.entries()]
      .map(([key, count]) => {
        const [from, to] = key.split('→');
        return { from, to, count };
      })
      .sort((a, b) => b.count - a.count);
  }

  /* ─── 事件订阅 ─── */

  onKnowledgeEvent(callback: EventCallback): () => void {
    const key = 'knowledge:*';
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key)!.push(callback);
    return () => {
      const arr = this.listeners.get(key);
      if (arr) {
        const idx = arr.indexOf(callback);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  onEvent(type: KnowledgeEvent['type'], callback: EventCallback): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(callback);
    return () => {
      const arr = this.listeners.get(type);
      if (arr) {
        const idx = arr.indexOf(callback);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  /* ─── 内部方法 ─── */

  private generateId(name: string): string {
    const safe = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_').substring(0, 40);
    const suffix = Date.now().toString(36).substring(4);
    return `${safe}_${suffix}`;
  }

  /** 自动分类知识：从名称/内容中提取系统归属和标签 */
  private classifyKnowledge(name: string, userTags?: string[]): string[] {
    const tags = new Set<string>();
    if (userTags) userTags.forEach(t => tags.add(t));

    const lower = name.toLowerCase();
    for (const [keyword, mapping] of Object.entries(SYSTEM_KNOWLEDGE_MAP)) {
      if (lower.includes(keyword)) {
        mapping.tags.forEach(t => tags.add(t));
      }
    }

    return [...tags];
  }

  /** 确定一条知识应该通知哪些系统 */
  private determineTargetSystems(entity: KnowledgeEntity): string[] {
    const systems = new Set<string>();
    const lower = entity.name.toLowerCase();
    for (const obs of entity.observations) {
      const obsLower = obs.toLowerCase();
      for (const [keyword, mapping] of Object.entries(SYSTEM_KNOWLEDGE_MAP)) {
        if (obsLower.includes(keyword) || lower.includes(keyword)) {
          systems.add(mapping.system);
        }
      }
    }
    // 至少通知来源系统自身
    if (systems.size === 0 && entity.source) {
      systems.add(entity.source);
    }
    return [...systems];
  }

  /** 新知识和已有知识的自动关联 */
  private autoLink(entity: KnowledgeEntity): string[] {
    const linked: string[] = [];
    const nameWords = entity.name.toLowerCase().split(/[_\s]+/);

    for (const [id, existing] of this.entities) {
      if (id === entity.id) continue;
      const existingWords = existing.name.toLowerCase().split(/[_\s]+/);

      // 共享标签 → 弱关联
      const sharedTags = entity.tags.filter(t => existing.tags.includes(t));
      if (sharedTags.length > 0) {
        this.addRelation(entity.id, id, 'related_to', 0.3 + sharedTags.length * 0.1);
        linked.push(existing.name);
        continue;
      }

      // 名称关键词重叠 → 弱关联
      const overlap = nameWords.filter(w => w.length > 1 && existingWords.includes(w));
      if (overlap.length > 0) {
        this.addRelation(entity.id, id, 'related_to', 0.2 + overlap.length * 0.1);
        linked.push(existing.name);
      }
    }

    return linked;
  }

  private addRelation(from: string, to: string, type: string, strength: number): void {
    // 避免重复
    const exists = this.relations.some(
      r => r.from === from && r.to === to && r.type === type
    );
    if (exists) {
      // 增强已有关系的强度
      for (const r of this.relations) {
        if (r.from === from && r.to === to && r.type === type) {
          r.strength = Math.min(1, r.strength + 0.05);
          break;
        }
      }
      return;
    }

    this.relations.push({
      from,
      to,
      type,
      strength: Math.min(1, strength),
      createdAt: Date.now(),
    });

    this.emit({
      type: 'relation:created',
      sourceSystem: 'KnowledgeCore',
      targetSystems: [],
      payload: { from, to, type, strength },
      timestamp: Date.now(),
    });
  }

  /** 构建标签索引和系统索引 */
  private indexEntity(entity: KnowledgeEntity): void {
    // 标签索引
    for (const tag of entity.tags) {
      if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, []);
      const ids = this.tagIndex.get(tag)!;
      if (!ids.includes(entity.id)) ids.push(entity.id);
    }
    // 系统索引
    if (!this.systemIndex.has(entity.source)) this.systemIndex.set(entity.source, []);
    const sysIds = this.systemIndex.get(entity.source)!;
    if (!sysIds.includes(entity.id)) sysIds.push(entity.id);

    // 也索引到目标系统
    for (const target of this.determineTargetSystems(entity)) {
      if (target === entity.source) continue;
      if (!this.systemIndex.has(target)) this.systemIndex.set(target, []);
      const tids = this.systemIndex.get(target)!;
      if (!tids.includes(entity.id)) tids.push(entity.id);
    }
  }

  private emit(event: KnowledgeEvent): void {
    // 广播给所有知识事件监听器
    const allKey = 'knowledge:*';
    const allListeners = this.listeners.get(allKey) || [];
    for (const cb of allListeners) {
      try { cb(event); } catch { /* 防止一个系统的错误影响其他系统 */ }
    }

    // 精确类型监听器
    const typeListeners = this.listeners.get(event.type) || [];
    for (const cb of typeListeners) {
      try { cb(event); } catch { /* 同上 */ }
    }
  }

  /* ─── 持久化 ─── */

  private load(): void {
    try {
      if (!fs.existsSync(this.persistencePath)) return;
      const raw = fs.readFileSync(this.persistencePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.entities) {
        for (const e of data.entities) {
          this.entities.set(e.id, e);
          this.indexEntity(e);
        }
      }
      if (data.relations) this.relations = data.relations;
    } catch {
      // 持久化文件损坏时静默重建
    }
  }

  save(): void {
    try {
      const data = {
        entities: [...this.entities.values()],
        relations: this.relations,
        savedAt: Date.now(),
      };
      const dir = path.dirname(this.persistencePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.persistencePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // 静默失败
    }
  }

  /** 关闭时清理 */
  destroy(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    this.save();
    this.listeners.clear();
  }

  /** 统计数据 */
  getStats() {
    return {
      totalNodes: this.entities.size,
      totalRelations: this.relations.length,
      totalTags: this.tagIndex.size,
      totalSystems: this.systemIndex.size,
      entities: this.entities.size,
      relations: this.relations.length,
      tags: this.tagIndex.size,
      systems: this.systemIndex.size,
    };
  }
}
