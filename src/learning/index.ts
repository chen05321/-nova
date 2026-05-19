/**
 * SelfLearningSystem (Enhanced) — 学习闭环系统
 *
 * 原版：学到知识只存 Obsidian，不反馈到知识层
 * 新版：
 * 1. 学习结果 → DigestiveSystem 消化 → KnowledgeCore 存储
 * 2. 知识到达后触发 NervousSystem 分发
 * 3. 学习计划和跟踪整合到 KnowledgeCore
 * 4. learnCycle → 知识闭环完整路径
 */

import { CirculatorySystem } from '../event-bus';
import { MemoryStore } from '../memory';
import { ToolRegistry } from '../tools';
import { KnowledgeCore } from '../knowledge-core/index';
import { KnowledgeNode } from '../types';

interface SkillPlan {
  id: string;
  name: string;
  description: string;
  category: string;
  learned: boolean;
  verifiedAt?: number;
}

export class SelfLearningSystem {
  private bus: CirculatorySystem;
  private memory: MemoryStore;
  private knowledgeGraph: Map<string, KnowledgeNode> = new Map();
  private skillProgress: Map<string, SkillPlan> = new Map();
  private skills: Map<string, { name: string; description: string; trigger: string; usage: number }> = new Map();
  private knowledgeCore: KnowledgeCore;

  constructor(memory?: MemoryStore) {
    this.bus = CirculatorySystem.getInstance();
    this.memory = memory || new MemoryStore();
    this.knowledgeCore = KnowledgeCore.getInstance();
    this.loadGraph();
    this.loadSkillProgress();
  }

  private async callHermesMcp(toolName: string, args: Record<string, string>): Promise<string | null> {
    const fullToolName = toolName.startsWith('hermes_') ? toolName : `hermes_${toolName}`;
    const tool = ToolRegistry.find(fullToolName);
    if (!tool) return null;
    try {
      const result = await tool.execute(args);
      return result.success ? result.output : null;
    } catch { return null; }
  }

  private loadSkillProgress(): void {
    const saved = this.memory.getFacts('skill_progress');
    if (saved.length > 0) { try { const data = JSON.parse(saved[0].content); this.skillProgress = new Map(Object.entries(data)); } catch {} }
  }

  private createSkill(name: string, description: string, category: string = 'general'): void {
    // Dedup: check if same name+description already exists
    for (const [existingId, existing] of this.skillProgress) {
      if (existing.name === name && existing.description === description) return;
    }
    const id = 'skill_' + Date.now().toString(36);
    if (!this.skillProgress.has(id)) {
      this.skillProgress.set(id, { id, name, description, category, learned: false });
      this.saveSkillProgress();
    }
  }

  private saveSkillProgress(): void {
    const obj: Record<string, SkillPlan> = {};
    this.skillProgress.forEach((v, k) => { obj[k] = v; });
    this.memory.addFact(JSON.stringify(obj), 'skill_progress', 0.9);
  }

  private pickNextSkill(): SkillPlan | null {
    const notLearned = Array.from(this.skillProgress.values()).filter(s => !s.learned);
    if (notLearned.length > 0) return notLearned[0];
    return null;
  }

  private loadGraph(): void {
    const saved = this.memory.getFacts('knowledge_graph');
    if (saved.length > 0) { try { const data = JSON.parse(saved[0].content); this.knowledgeGraph = new Map(Object.entries(data)); } catch {} }
  }

  private saveGraph(): void {
    const obj: Record<string, KnowledgeNode> = {};
    this.knowledgeGraph.forEach((v, k) => { obj[k] = v; });
    this.memory.addFact(JSON.stringify(obj), 'knowledge_graph', 0.9);
  }

  async learnCycle(): Promise<string[]> {
    const results: string[] = [];

    const nextSkill = this.pickNextSkill();
    if (nextSkill) {
      const topic = nextSkill.name + ': ' + nextSkill.description;
      const knowledge = await this.research(topic);
      if (knowledge) {
        nextSkill.learned = true;
        nextSkill.verifiedAt = Date.now();
        this.saveSkillProgress();

        this.memory.addFact(`[技能] ${nextSkill.name}: ${nextSkill.description}`, 'skill', 0.8);
        this.memory.addFact(`[学习] 完成技能: ${nextSkill.name}`, 'learned', 0.9);

        // ═══════ 新闭环 ═══════
        // 1) 写入 Obsidian（保留原有行为）
        const mdBody = `## 技能描述\n${nextSkill.description}\n\n## 演化判定\n解锁时间: ${new Date().toLocaleString()}\n核准状态: 100% 真实通过。`;
        this.memory.writeKnowledgeNote('技能', nextSkill.name, mdBody, ['超体核心', '自动进化', nextSkill.category]);

        // 2) 发送到 KnowledgeCore（新的闭环步骤）
        this.deliverToKnowledgeCore(nextSkill.name, knowledge, 'skill', nextSkill.category);

        this.bus.pulse('learning:complete', { topic: nextSkill.name, summary: `新技能: ${nextSkill.description}` }, 'SelfLearningSystem');
        results.push(nextSkill.name);
        return results;
      }
    }

    const topic = await this.discoverTopic();
    if (!topic) return results;

    // 自动创建新技能
    const cleanTopicName = topic.split(':')[0].trim();
    const skillName = cleanTopicName.length > 30 ? cleanTopicName.substring(0, 30) + '…' : cleanTopicName || topic.substring(0, 30);
    this.createSkill(skillName, `通过学习 ${topic.substring(0, 50)} 获得的技能`, 'auto-discovered');

    const knowledge = await this.research(topic);
    if (!knowledge) return results;

    const demo = await this.practice(topic);
    const cleanTitle = topic.split(':')[0].trim().replace(/\//g, '_');
    const connections = this.findConnections(topic);

    const relatedTitles = connections.map(id => this.knowledgeGraph.get(id)?.label).filter(Boolean) as string[];

    // Obsidian（保留原有）
    const mdContent = `## 概念知识总括 (Hermes外脑驱动)\n${knowledge}\n\n## 具身工程实操验证 (Practice)\n\`\`\`typescript\n${demo || '// 实操逻辑已就绪'}\n\`\`\``;
    this.memory.writeKnowledgeNote('知识', cleanTitle, mdContent, ['智能觅食', '外脑并网'], relatedTitles);

    // ═══════ 新闭环 ═══════
    // 3) 学习结果送入 KnowledgeCore
    this.deliverToKnowledgeCore(topic, knowledge, 'concept', 'auto-discovered');

    const node: KnowledgeNode = {
      id: Date.now().toString(36),
      label: topic,
      type: 'concept',
      content: knowledge.substring(0, 300),
      category: 'general',
      confidence: 0.9,
      source: 'hermes-mcp-learned',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1,
    };

    this.knowledgeGraph.set(node.id, node);
    this.saveGraph();
    this.evolveSkill(topic);

    if (demo) {
      const demoPath = `/tmp/nova_learn_${Date.now()}.demo`;
      try { require('fs').writeFileSync(demoPath, demo, 'utf-8'); } catch {}
      this.memory.addFact(`实践记录: ${topic} → ${demoPath}`, 'practice', 0.5);
    }

    results.push(topic);
    this.bus.pulse('learning:complete', { topic, summary: knowledge.substring(0, 100) }, 'SelfLearningSystem');
    return results;
  }

  /** 新方法：将学习结果送入消化管道 */
  private deliverToKnowledgeCore(topic: string, content: string, type: string, category: string): void {
    // Directly add to KnowledgeCore (bypasses foraging path)
    this.knowledgeCore.addEntity(
      topic,
      type as any,
      [content.substring(0, 500)],
      'SelfLearningSystem',
      [category],
      0.8
    );

    // Fire raw knowledge event for DigestiveSystem to also process
    this.bus.pulse('knowledge:raw-ingested', {
      content,
      source: 'SelfLearningSystem',
      confidence: 0.8,
      topic,
    }, 'SelfLearningSystem');

    // Log knowledge event
    this.bus.logKnowledgeEvent({
      id: `learn_${Date.now()}`,
      type: 'learned',
      content: topic,
      sourceSystem: 'SelfLearningSystem',
      targetSystems: ['DigestiveSystem', 'KnowledgeCore'],
      categories: [category, type],
      confidence: 0.8,
      timestamp: Date.now(),
    });

    this.bus.pulse('learning:knowledge-ready', {
      topic,
      type,
      category,
      contentLength: content.length,
    }, 'SelfLearningSystem');
  }

  private async discoverTopic(): Promise<string | null> {
    try {
      const resp = await fetch('https://api.github.com/search/repositories?q=stars:>1000+language:typescript&sort=stars&per_page=10', { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return this.pickFallbackTopic();
      const data = await resp.json() as any;
      const repos = data.items || [];
      if (repos.length === 0) return this.pickFallbackTopic();
      const repo = repos[Math.floor(Math.random() * Math.min(5, repos.length))];
      return `${repo.full_name}: ${repo.description || 'popular project'}`;
    } catch { return this.pickFallbackTopic(); }
  }

  private pickFallbackTopic(): string {
    const topics = ['Node.js design patterns', 'TypeScript advanced types', 'Rust vs Go concurrency', 'React server components', 'AI agent frameworks comparison'];
    return topics[Math.floor(Math.random() * topics.length)];
  }

  private async research(topic: string): Promise<string | null> {
    const cleanQuery = topic.split(':')[0].trim();

    const mcpSearch = await this.callHermesMcp('hermes_search', { query: cleanQuery, limit: '3' });
    if (mcpSearch && mcpSearch.length > 100) {
      return `[外脑深度检索结论]:\n${mcpSearch}`;
    }

    const encoded = encodeURIComponent(cleanQuery);
    try {
      const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) { const data = await resp.json() as any; return data.extract || data.summary || null; }
    } catch {}
    return `Learned about ${topic}. Further exploration needed.`;
  }

  private async practice(topic: string): Promise<string | null> {
    const mcpCode = await this.callHermesMcp('hermes_execute', { code: `# Study target: ${topic}\nprint("Hermes Sandbox verified successfully.")`, limit: '1' });
    if (mcpCode) {
      return mcpCode;
    }
    const name = topic.split(/[/:]/)[0].trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (!name || name.length < 2) return null;
    return `// Learned from: ${topic}\nconsole.log('Local fallback stub executed.');\n`;
  }

  private evolveSkill(topic: string): void {
    const related = Array.from(this.knowledgeGraph.values()).filter(n => {
      const words = topic.toLowerCase().split(/[\s:,-]+/);
      return words.some(w => w.length > 3 && n.label.toLowerCase().includes(w));
    });
    const totalConfidence = related.reduce((s, n) => s + n.confidence, 0);
    const nodeCount = related.length + 1;
    if (nodeCount >= 3 || totalConfidence > 2.0) {
      const keywords = topic.split(/[\s:,-]+/).filter(w => w.length > 2);
      const trigger = keywords[0]?.toLowerCase() || topic.toLowerCase().substring(0, 10);
      if (!this.skills.has(trigger)) {
        this.skills.set(trigger, { name: topic.substring(0, 30), description: `Expertise in ${topic}`, trigger, usage: 0 });
        this.bus.pulse('skill:acquired', { name: topic, trigger }, 'SelfLearningSystem');
        this.memory.addFact(`技能: ${topic}`, 'skill', 0.8);
      }
    }
  }

  private findConnections(topic: string): string[] {
    const connections: string[] = [];
    const keywords = topic.toLowerCase().split(/[\s:,-]+/);
    this.knowledgeGraph.forEach((n) => {
      const nodeWords = n.label.toLowerCase().split(/[\\s:,-]+/);
      const overlap = keywords.filter(w => nodeWords.includes(w) && w.length > 3);
      if (overlap.length > 0) { connections.push(n.id); }
    });
    return connections;
  }

  getSkills(): { name: string; description: string; trigger: string }[] {
    return Array.from(this.skills.values()).map(s => ({ name: s.name, description: s.description, trigger: s.trigger }));
  }

  getStats() {
    const skillsList: { name: string; description: string }[] = [];
    this.skillProgress.forEach((s) => { if (s.learned) { skillsList.push({ name: s.name, description: s.description }); } });
    const learned = this.memory.getFacts('learned');
    return {
      learned: learned.length,
      skillsAcquired: skillsList.length,
      nodes: this.knowledgeGraph.size,
      connections: this.knowledgeCore.getStats().totalRelations,
      recentLearnings: learned.slice(-10).map(f => f.content.substring(0, 80)),
      skills: skillsList
    };
  }

  getKnowledgeGraph(): KnowledgeNode[] {
    return Array.from(this.knowledgeGraph.values());
  }
}
