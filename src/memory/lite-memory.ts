import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const MEM_DIR = path.join(os.homedir(), '.nova', 'memory_store');
const MEM_FILE = path.join(MEM_DIR, 'vectors.json');

interface MemoryRecord {
  id: string;
  text: string;
  category: 'fact' | 'preference' | 'experience' | 'concept';
  source: 'user' | 'assistant' | 'learned';
  timestamp: number;
  accessCount: number;
  vector: number[];
}

let pipeline: any = null;
let store: MemoryRecord[] = [];

function ensureDir(): void {
  if (!fs.existsSync(MEM_DIR)) fs.mkdirSync(MEM_DIR, { recursive: true });
}

function load(): void {
  ensureDir();
  try {
    if (fs.existsSync(MEM_FILE)) store = JSON.parse(fs.readFileSync(MEM_FILE, 'utf-8'));
  } catch { store = []; }
}

function save(): void {
  ensureDir();
  try {
    fs.writeFileSync(MEM_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch {}
}

async function getEncoder(): Promise<any> {
  if (!pipeline) {
    try {
      const { pipeline: p } = await import('@xenova/transformers');
      pipeline = await p('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    } catch { return null; }
  }
  return pipeline;
}

async function embed(text: string): Promise<number[]> {
  const encoder = await getEncoder();
  if (!encoder) return [];
  try {
    const result = await encoder(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data) as number[];
  } catch { return []; }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  let dot = 0, mA = 0, mB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; mA += a[i] * a[i]; mB += b[i] * b[i];
  }
  return dot / (Math.sqrt(mA) * Math.sqrt(mB));
}

export class LiteMemory {
  constructor() { load(); }

  async add(text: string, category: MemoryRecord['category'] = 'fact', source: MemoryRecord['source'] = 'assistant'): Promise<void> {
    if (text.length < 5) return;
    const vec = await embed(text.substring(0, 1000));
    const record: MemoryRecord = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      text, category, source, timestamp: Date.now(), accessCount: 0, vector: vec
    };
    store.push(record);
    if (store.length > 500) store = store.slice(-500);
    save();
  }

  async search(query: string, topK = 3): Promise<{ text: string; score: number; category: string; time: number }[]> {
    if (!store.length) return [];
    const qVec = await embed(query);
    if (!qVec.length) return [];

    const scored = store
      .map(r => ({ text: r.text, score: cosineSimilarity(qVec, r.vector), category: r.category, time: r.timestamp }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // 访问计数 + 懒保存
    for (const r of store) r.accessCount++;
    return scored.filter(r => r.score > 0.3);
  }

  getStats(): { total: number; categories: Record<string, number> } {
    const cats: Record<string, number> = {};
    for (const r of store) cats[r.category] = (cats[r.category] || 0) + 1;
    return { total: store.length, categories: cats };
  }
}
