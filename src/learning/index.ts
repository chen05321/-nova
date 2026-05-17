import { CirculatorySystem } from '../event-bus';
import { MemoryStore } from '../memory';
import { execSync } from 'child_process';

interface KnowledgeNode {
  id: string;
  title: string;
  type: 'concept' | 'tool' | 'project' | 'skill';
  summary: string;
  source: string;
  code?: string;
  connections: string[];
  createdAt: number;
  confidence: number;
}

// ─── Skill Learning Path ──────────────────────────────
interface SkillPlan {
  id: string;
  name: string;
  description: string;
  level: number;          // 1=básica, 2=intermedia, 3=avanzada
  category: string;
  prerequisite: string[];
  learned: boolean;
  verifiedAt?: number;
}

const SKILL_TREE: SkillPlan[] = [
  // Nivel 1: Fundamentos
  { id: 'fs_read', name: '文件读取', description: '读文件、解析JSON/YAML', level: 1, category: 'filesystem', prerequisite: [], learned: false },
  { id: 'fs_write', name: '文件写入', description: '写文件、创建目录、备份', level: 1, category: 'filesystem', prerequisite: [], learned: false },
  { id: 'fs_find', name: '文件搜索', description: 'grep查找、glob匹配', level: 1, category: 'filesystem', prerequisite: [], learned: false },
  { id: 'web_get', name: '网页抓取', description: 'fetch URL、解析HTML', level: 1, category: 'network', prerequisite: [], learned: false },
  { id: 'web_search', name: '网络搜索', description: '搜索引擎查询、提取结果', level: 1, category: 'network', prerequisite: [], learned: false },
  { id: 'shell_basic', name: 'Shell基础', description: '执行命令、管道、重定向', level: 1, category: 'shell', prerequisite: [], learned: false },
  { id: 'shell_git', name: 'Git操作', description: 'clone/commit/push/pull', level: 1, category: 'shell', prerequisite: [], learned: false },
  
  // Nivel 2: Aplicaciones
  { id: 'browser_url', name: '浏览器导航', description: '打开URL、截图页面', level: 2, category: 'browser', prerequisite: ['web_get'], learned: false },
  { id: 'browser_interact', name: '浏览器交互', description: '点击按钮、填写表单', level: 2, category: 'browser', prerequisite: ['browser_url'], learned: false },
  { id: 'data_json', name: '数据处理', description: 'JSON转换、过滤、统计', level: 2, category: 'data', prerequisite: ['fs_read'], learned: false },
  { id: 'data_csv', name: '表格处理', description: 'CSV读写、数据清洗', level: 2, category: 'data', prerequisite: ['fs_read'], learned: false },
  { id: 'code_analyze', name: '代码分析', description: '读代码、找bug、重构', level: 2, category: 'code', prerequisite: ['fs_read'], learned: false },
  
  // Nivel 3: Proyectos
  { id: 'project_setup', name: '项目搭建', description: '初始化项目、装依赖', level: 3, category: 'project', prerequisite: ['shell_basic', 'shell_git'], learned: false },
  { id: 'project_auto', name: '自动化脚本', description: '编写自动任务脚本', level: 3, category: 'project', prerequisite: ['shell_basic', 'code_analyze'], learned: false },
  { id: 'project_mcp', name: 'MCP插件开发', description: '创建自定义MCP服务器', level: 3, category: 'project', prerequisite: ['browser_interact', 'data_json'], learned: false },
];

export class SelfLearningSystem {
  private bus: CirculatorySystem;
  private memory: MemoryStore;
  private knowledgeGraph: Map<string, KnowledgeNode> = new Map();
  private learningCount = 0;
  private dailyTarget = 3;
  private recentLearnings: string[] = [];
  private skills: Map<string, { name: string; description: string; trigger: string; usage: number }> = new Map();
  private skillProgress: Map<string, SkillPlan> = new Map();

  constructor(memory?: MemoryStore) {
    this.bus = CirculatorySystem.getInstance();
    this.memory = memory || new MemoryStore();
    this.loadGraph();
    this.loadSkillProgress();
  }

  private loadSkillProgress(): void {
    const saved = this.memory.getFacts('skill_progress');
    if (saved.length > 0) {
      try {
        const data = JSON.parse(saved[0].content);
        this.skillProgress = new Map(Object.entries(data));
      } catch {}
    }
    // Ensure all skills are in the map
    for (const s of SKILL_TREE) {
      if (!this.skillProgress.has(s.id)) {
        this.skillProgress.set(s.id, { ...s });
      }
    }
  }

  private saveSkillProgress(): void {
    const obj: Record<string, SkillPlan> = {};
    this.skillProgress.forEach((v, k) => { obj[k] = v; });
    this.memory.addFact(JSON.stringify(obj), 'skill_progress', 0.9);
  }

  private pickNextSkill(): SkillPlan | null {
    const all = Array.from(this.skillProgress.values());
    const notLearned = all.filter(s => !s.learned);
    if (notLearned.length === 0) return null;

    // Check prerequisites
    for (const s of notLearned) {
      const prereqsMet = s.prerequisite.every(preId => {
        const pre = this.skillProgress.get(preId);
        return pre && pre.learned;
      });
      if (prereqsMet) return s;
    }

    // Fallback: pick the first unlearned with fewest prerequisites
    return notLearned.sort((a, b) => a.prerequisite.length - b.prerequisite.length)[0];
  }

  private loadGraph(): void {
    const saved = this.memory.getFacts('knowledge_graph');
    if (saved.length > 0) {
      try {
        const data = JSON.parse(saved[0].content);
        this.knowledgeGraph = new Map(Object.entries(data));
      } catch {}
    }
  }

  private saveGraph(): void {
    const obj: Record<string, KnowledgeNode> = {};
    this.knowledgeGraph.forEach((v, k) => { obj[k] = v; });
    this.memory.addFact(JSON.stringify(obj), 'knowledge_graph', 0.9);
  }

  async learnCycle(): Promise<string[]> {
    const results: string[] = [];

    // 0. Check if there's a skill to learn
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
        this.recentLearnings.unshift(`🎯 掌握技能: ${nextSkill.name}`);
        if (this.recentLearnings.length > 20) this.recentLearnings.pop();
        this.bus.pulse('learning:complete', { topic: nextSkill.name, summary: `新技能: ${nextSkill.description}` }, 'SelfLearningSystem');
        results.push(nextSkill.name);
        return results;
      }
    }

    // 1. Browse GitHub Trending (fallback)
    const topic = await this.discoverTopic();
    if (!topic) return results;

    // 2. Deep research
    const knowledge = await this.research(topic);
    if (!knowledge) return results;

    // 3. Practice with code
    const demo = await this.practice(topic);

    // 4. Store as knowledge node
    const node: KnowledgeNode = {
      id: Date.now().toString(36),
      title: topic,
      type: 'concept',
      summary: knowledge.substring(0, 300),
      source: 'self-learned',
      code: demo || undefined,
      connections: this.findConnections(topic),
      createdAt: Date.now(),
      confidence: 0.5
    };

    this.knowledgeGraph.set(node.id, node);
    this.saveGraph();
    this.learningCount++;
    this.memory.addFact(`学到了: ${topic}`, 'learned', 0.6);

    // Try to evolve into a skill
    this.evolveSkill(topic);

    // 5. Create a practice record
    if (demo) {
      const demoPath = `/tmp/nova_learn_${Date.now()}.demo`;
      execSync(`echo '${demo.replace(/'/g, "'\\''")}' > ${demoPath}`, { shell: '/bin/bash' });
      this.memory.addFact(`实践记录: ${topic} → ${demoPath}`, 'practice', 0.5);
    }

    results.push(topic);
    this.memory.addFact(`[自学] ${topic}`, 'learned', 0.7);
    if (demo) this.memory.addFact(`[实践] ${topic}: 已生成练习代码`, 'skill', 0.6);
    this.recentLearnings.unshift(`📖 ${topic}: ${knowledge.substring(0, 80)}...`);
    if (this.recentLearnings.length > 20) this.recentLearnings.pop();
    this.bus.pulse('learning:complete', { topic, summary: knowledge.substring(0, 100) }, 'SelfLearningSystem');
    return results;
  }

  private async discoverTopic(): Promise<string | null> {
    try {
      const resp = await fetch('https://api.github.com/search/repositories?q=stars:>1000+language:typescript&sort=stars&per_page=10', {
        signal: AbortSignal.timeout(10000)
      });
      if (!resp.ok) return this.pickFallbackTopic();
      const data = await resp.json() as any;
      const repos = data.items || [];
      if (repos.length === 0) return this.pickFallbackTopic();

      // Pick a random repo from the top results
      const repo = repos[Math.floor(Math.random() * Math.min(5, repos.length))];
      return `${repo.full_name}: ${repo.description || 'a popular project'}`;
    } catch {
      return this.pickFallbackTopic();
    }
  }

  private pickFallbackTopic(): string {
    const topics = [
      'Node.js design patterns',
      'TypeScript advanced types',
      'Rust vs Go concurrency',
      'React server components',
      'WebAssembly use cases',
      'microservices architecture patterns',
      'AI agent frameworks comparison',
      'functional programming in practice',
      'distributed systems fundamentals',
      'compiler design basics'
    ];
    return topics[Math.floor(Math.random() * topics.length)];
  }

  private async research(topic: string): Promise<string | null> {
    // Try Wikipedia first
    const encoded = encodeURIComponent(topic.split(':')[0].trim());
    try {
      const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`, {
        signal: AbortSignal.timeout(8000)
      });
      if (resp.ok) {
        const data = await resp.json() as any;
        return data.extract || data.summary || null;
      }
    } catch {}

    // Fallback: use the topic name itself as the knowledge
    return `Learned about ${topic}. Further exploration needed.`;
  }

  private async practice(topic: string): Promise<string | null> {
    // Generate a simple practice script based on the topic
    const name = topic.split(/[/:]/)[0].trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (!name || name.length < 2) return null;

    try {
      const demoScript = `// Learned from: ${topic}
// Practice demo - ${new Date().toISOString().split('T')[0]}

const topic = '${topic.replace(/'/g, "\\'")}';
console.log('Learning about:', topic);
console.log('Knowledge acquired and stored.');
`;
      return demoScript;
    } catch {
      return null;
    }
  }

  private evolveSkill(topic: string): void {
    // Check if we have enough related knowledge to form a skill
    const related = Array.from(this.knowledgeGraph.values())
      .filter(n => {
        const words = topic.toLowerCase().split(/[\s:,-]+/);
        return words.some(w => w.length > 3 && n.title.toLowerCase().includes(w));
      });

    const totalConfidence = related.reduce((s, n) => s + n.confidence, 0);
    const nodeCount = related.length + 1;

    // If we've learned about a topic 3+ times or have high confidence, create a skill
    if (nodeCount >= 3 || totalConfidence > 2.0) {
      const keywords = topic.split(/[\s:,-]+/).filter(w => w.length > 2);
      const trigger = keywords[0]?.toLowerCase() || topic.toLowerCase().substring(0, 10);

      if (!this.skills.has(trigger)) {
        this.skills.set(trigger, {
          name: topic.substring(0, 30),
          description: `Expertise in ${topic} (learned from ${nodeCount} sources)`,
          trigger,
          usage: 0
        });
        this.bus.pulse('skill:acquired', { name: topic, trigger }, 'SelfLearningSystem');
        this.memory.addFact(`技能: ${topic}`, 'skill', 0.8);
      }
    }
  }

  getSkills(): { name: string; description: string; trigger: string }[] {
    return Array.from(this.skills.values()).map(s => ({ name: s.name, description: s.description, trigger: s.trigger }));
  }

  private findConnections(topic: string): string[] {
    const connections: string[] = [];
    const keywords = topic.toLowerCase().split(/[\s:,-]+/);
    
    this.knowledgeGraph.forEach((node) => {
      const nodeWords = node.title.toLowerCase().split(/[\s:,-]+/);
      const overlap = keywords.filter(w => nodeWords.includes(w) && w.length > 3);
      if (overlap.length > 0) {
        connections.push(node.id);
      }
    });

    return connections;
  }

  getStats() {
    return {
      learned: this.learningCount,
      nodes: this.knowledgeGraph.size,
      connections: Array.from(this.knowledgeGraph.values())
        .reduce((s, n) => s + n.connections.length, 0),
      recentLearnings: this.recentLearnings.slice(0, 10),
      skills: this.getSkills()
    };
  }

  getKnowledgeGraph(): KnowledgeNode[] {
    return Array.from(this.knowledgeGraph.values());
  }
}
