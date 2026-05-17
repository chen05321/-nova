import { CirculatorySystem } from '../event-bus';
import { MemoryStore } from '../memory';
import { PersonalityVector } from '../types';

interface ForageResult {
  topic: string;
  learned: string[];
  energyCost: number;
  curiositySatisfied: boolean;
}

export class ForagingSystem {
  private bus: CirculatorySystem;
  private memory: MemoryStore;
  private personality: PersonalityVector;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastForageTime = 0;
  private forageCount = 0;
  private running = false;

  // Built-in knowledge sources
  private readonly knowledgeSources = [
    { name: 'Wikipedia', url: (topic: string) => `https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}` },
    { name: 'Wikipedia EN', url: (topic: string) => `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}` },
  ];

  private readonly curiosityTopics = [
    '人工智能', '机器学习', '深度学习', '自然语言处理', '计算机视觉',
    'TypeScript', 'Node.js', '系统架构', '设计模式', '软件工程',
    '心理学', '认知科学', '神经科学', '生物学', '进化论',
    '哲学', '逻辑学', '数学', '物理学', '天文学'
  ];

  constructor(personality: PersonalityVector, memory?: MemoryStore) {
    this.bus = CirculatorySystem.getInstance();
    this.memory = memory || new MemoryStore();
    this.personality = personality;
  }

  start(intervalMs = 300000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.forage(), intervalMs);
    this.bus.pulse('foraging:start', { interval: intervalMs }, 'ForagingSystem');
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.bus.pulse('foraging:stop', {}, 'ForagingSystem');
  }

  private async forage(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const energy = this.bus.energyLevel;
    const curiosity = this.personality.curiosity;
    const energyCost = Math.round(5 + (1 - curiosity) * 10);

    // Check if we have enough energy
    if (energy < energyCost + 10) {
      this.running = false;
      return;
    }

    // Select a topic
    const topic = this.selectTopic();
    if (!topic) { this.running = false; return; }

    this.bus.consumeEnergy('ForagingSystem', energyCost);
    this.bus.pulse('foraging:started', { topic, energyCost }, 'ForagingSystem');

    const result = await this.learn(topic);

    if (result.learned.length > 0) {
      for (const fact of result.learned) {
        this.memory.addFact(fact, 'learned', 0.5);
      }
      this.forageCount++;
      this.bus.produceEnergy('ForagingSystem', Math.round(energyCost * 0.6));
      this.bus.pulse('foraging:complete', {
        topic: result.topic,
        factsLearned: result.learned.length,
        totalForaged: this.forageCount
      }, 'ForagingSystem');
      this.memory.addFact(`[学习] ${result.topic}`, 'learned', 0.7);
    }

    this.lastForageTime = Date.now();
    this.running = false;
  }

  private selectTopic(): string {
    // Get topics from user profile
    const userFacts = this.memory.getFacts('user_profile');
    const topics = this.memory.getFacts('topic');
    const foraged = this.memory.getFacts('foraged');

    const knownTopics = new Set(foraged.map(f => f.content.substring(0, 30)));

    // Prioritize topics the user has discussed but hasn't foraged yet
    const unvisited = topics.filter(t => !knownTopics.has(t.content.substring(0, 30)));
    if (unvisited.length > 0) {
      return unvisited[Math.floor(Math.random() * unvisited.length)].content.replace('讨论过: ', '');
    }

    // Fall back to user interests
    if (userFacts.length > 0 && Math.random() > 0.5) {
      const interest = userFacts[Math.floor(Math.random() * userFacts.length)];
      return interest.content.replace(/^(我是|我叫|我喜欢|我在做|我的项目|我用)\s*/, '');
    }

    // Random topic
    return this.curiosityTopics[Math.floor(Math.random() * this.curiosityTopics.length)];
  }

  private async learn(topic: string): Promise<ForageResult> {
    const learned: string[] = [];
    const encodedTopic = encodeURIComponent(topic);

    for (const source of this.knowledgeSources) {
      try {
        const url = source.url(encodedTopic);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) continue;

        const text = await response.text();

        // Try to parse as JSON (Wikipedia API returns JSON)
        try {
          const data = JSON.parse(text);
          const summary = data.extract || data.summary || '';
          if (summary && summary.length > 50) {
            // Extract key sentences
            const sentences = summary
              .replace(/<[^>]+>/g, '')
              .split(/[。！？\n]/)
              .filter((s: string) => s.trim().length > 10)
              .slice(0, 3);

            for (const s of sentences) {
              learned.push(`[${source.name}] ${topic}: ${s.trim().substring(0, 100)}`);
            }
          }
        } catch {
          // Not JSON, extract text content
          const clean = text.replace(/<[^>]+>/g, '').substring(0, 500);
          if (clean.length > 100) {
            learned.push(`[${source.name}] ${clean.substring(0, 100)}`);
          }
        }
      } catch {}
    }

    // If nothing learned from external sources, store a note
    if (learned.length === 0) {
      learned.push(`[探索] 对"${topic}"产生了兴趣，待深入`);
    }

    return { topic, learned, energyCost: 10, curiositySatisfied: learned.length > 0 };
  }

  getStats(): { forageCount: number; lastForage: number; running: boolean } {
    return {
      forageCount: this.forageCount,
      lastForage: this.lastForageTime,
      running: this.running
    };
  }
}
