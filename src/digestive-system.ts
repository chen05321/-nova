import { System } from './system';
import { Biometrics, KnowledgeFragment } from './types';

export class DigestiveSystem extends System {
  private knowledgeBase: Map<string, KnowledgeFragment> = new Map();
  private nutrientLevel = 0.5;
  private digestionQueue: string[] = [];

  async init(): Promise<void> {
    this.subscribe('input:raw', (data) => this.ingest(data));
    this.subscribe('learning:new', (data) => this.ingest(data));

    setInterval(() => this.digestCycle(), 10000);
    this.initialized = true;
    this.log('Digestive system initialized');
  }

  private async ingest(data: unknown): Promise<void> {
    // Extract actual content from event payload
    const payload = (data as any)?.payload || data;
    const content = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
    const id = `knowledge_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const fragment: KnowledgeFragment = {
      id,
      content,
      source: 'perception',
      confidence: 0.5,
      timestamp: Date.now()
    };

    this.knowledgeBase.set(id, fragment);
    this.digestionQueue.push(id);
    this.nutrientLevel = Math.min(1, this.nutrientLevel + 0.1);

    this.bus.pulse('digestion:ingested', { id, contentLength: content.length }, this.name);
    this.log(`Ingested knowledge fragment: ${id}`);
  }

  private async digestCycle(): Promise<void> {
    if (this.digestionQueue.length === 0) return;

    const batch = this.digestionQueue.splice(0, Math.min(5, this.digestionQueue.length));

    for (const id of batch) {
      const fragment = this.knowledgeBase.get(id);
      if (!fragment) continue;

      fragment.confidence = Math.min(1, fragment.confidence + 0.3);
      fragment.timestamp = Date.now();

      this.bus.pulse('knowledge:assimilated', {
        id,
        confidence: fragment.confidence
      }, this.name);
    }

    this.nutrientLevel = Math.max(0, this.nutrientLevel - 0.05);
    // Digestion produces energy — knowledge is the "food"
    this.produceEnergy(batch.length * 2);
    this.log(`Digested ${batch.length} knowledge fragments → +${batch.length * 2} energy`);
  }

  recall(query: string, limit = 5): KnowledgeFragment[] {
    const results: { fragment: KnowledgeFragment; score: number }[] = [];
    const keywords = query.toLowerCase().split(/\s+/);

    for (const fragment of this.knowledgeBase.values()) {
      let score = 0;
      for (const kw of keywords) {
        if (fragment.content.toLowerCase().includes(kw)) score += 1;
      }
      score += fragment.confidence * 2;
      score *= fragment.timestamp / Date.now();
      results.push({ fragment, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(r => r.fragment);
  }

  isHungry(): boolean {
    return this.nutrientLevel < 0.2;
  }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: this.nutrientLevel < 0.2 ? 'stressed' : 'healthy',
      load: 1 - this.nutrientLevel,
      metadata: {
        knowledgeFragments: this.knowledgeBase.size,
        digestionQueue: this.digestionQueue.length,
        nutrientLevel: this.nutrientLevel,
        isHungry: this.isHungry()
      }
    };
  }
}
