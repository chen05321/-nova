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
const ENTITY_PATTERN = /[A-Z]\w+(?:[-/]\w+)*(?:\s+\w+)*/g;

function ensureDir(): void {
  if (!fs.existsSync(MEM_DIR)) fs.mkdirSync(MEM_DIR, { recursive: true });
}

function load(): void {
  ensureDir();
  try { if (fs.existsSync(MEM_FILE)) store = JSON.parse(fs.readFileSync(MEM_FILE, 'utf-8')); }
  catch { store = []; }
}

function save(): void {
  ensureDir();
  try { fs.writeFileSync(MEM_FILE, JSON.stringify(store, null, 2), 'utf-8'); } catch {}
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
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; mA += a[i] * a[i]; mB += b[i] * b[i]; }
  return dot / (Math.sqrt(mA) * Math.sqrt(mB));
}

// BM25 关键词评分
function bm25Score(text: string, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const t of terms) {
    const count = lower.split(t).length - 1;
    if (count > 0) score += Math.log(1 + count) * (1 + Math.log(1 + text.length / 200));
  }
  return score;
}

// 实体提取 + 匹配
function extractEntities(text: string): string[] {
  const found = text.match(ENTITY_PATTERN) || [];
  return [...new Set(found.filter(e => e.length > 2))];
}

function entityScore(text: string, queryEntities: string[]): number {
  if (!queryEntities.length) return 0;
  let hits = 0;
  for (const e of queryEntities) {
    if (text.includes(e)) hits++;
  }
  return hits / queryEntities.length;
}

// RRF 融合
function rrfScore(rank: number, k = 60): number {
  return 1 / (k + rank);
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
    if (!store.length || !query.trim()) return [];

    // 1. 向量语义检索
    const qVec = await embed(query);
    const vecScores = qVec.length ? store.map(r => cosineSimilarity(qVec, r.vector)) : store.map(() => 0);

    // 2. BM25 关键词检索
    const bm25Scores = store.map(r => bm25Score(r.text, query));

    // 3. 实体匹配
    const queryEntities = extractEntities(query);
    const entScores = store.map(r => entityScore(r.text, queryEntities));

    // 4. RRF 融合
    const kConst = 60;
    const getRank = (arr: number[], idx: number) => {
      const sorted = [...arr].sort((a, b) => b - a);
      const pos = sorted.indexOf(arr[idx]);
      return pos >= 0 ? pos + 1 : arr.length;
    };

    interface Scored { idx: number; text: string; score: number; category: string; time: number }
    const scored: Scored[] = store.map((r, i) => ({
      idx: i,
      text: r.text,
      score: rrfScore(getRank(vecScores, i), kConst) * 0.4
           + rrfScore(getRank(bm25Scores, i), kConst) * 0.35
           + rrfScore(getRank(entScores, i), kConst) * 0.25,
      category: r.category,
      time: r.timestamp
    }));

    for (const r of store) r.accessCount++;
    return scored.sort((a, b) => b.score - a.score).slice(0, topK).filter(r => r.score > 0);
  }

  getStats(): { total: number; categories: Record<string, number> } {
    const cats: Record<string, number> = {};
    for (const r of store) cats[r.category] = (cats[r.category] || 0) + 1;
    return { total: store.length, categories: cats };
  }
}
