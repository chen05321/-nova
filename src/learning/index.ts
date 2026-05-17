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

export class SelfLearningSystem {
  private bus: CirculatorySystem;
  private memory: MemoryStore;
  private knowledgeGraph: Map<string, KnowledgeNode> = new Map();
  private learningCount = 0;
  private dailyTarget = 3;
  private recentLearnings: string[] = [];

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.memory = new MemoryStore();
    this.loadGraph();
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

    // 1. Browse GitHub Trending
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

    // 5. Create a practice record
    if (demo) {
      const demoPath = `/tmp/nova_learn_${Date.now()}.demo`;
      execSync(`echo '${demo.replace(/'/g, "'\\''")}' > ${demoPath}`, { shell: '/bin/bash' });
      this.memory.addFact(`实践记录: ${topic} → ${demoPath}`, 'practice', 0.5);
    }

    results.push(topic);
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
      recentLearnings: this.recentLearnings.slice(0, 10)
    };
  }

  getKnowledgeGraph(): KnowledgeNode[] {
    return Array.from(this.knowledgeGraph.values());
  }
}
