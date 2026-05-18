import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const VAULT_DIR = path.join(os.homedir(), '.nova-vault');
const VECTOR_CACHE = path.join(VAULT_DIR, '.vector_cache.json');

interface VectorEntry {
  file: string;
  title: string;
  text: string;
  vector: number[];
}

let pipeline: any = null;
let cache: VectorEntry[] = [];

async function getEncoder(): Promise<any> {
  if (!pipeline) {
    try {
      const { pipeline: p } = await import('@xenova/transformers');
      pipeline = await p('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    } catch {
      return null;
    }
  }
  return pipeline;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export async function embed(text: string): Promise<number[] | null> {
  const encoder = await getEncoder();
  if (!encoder) return null;
  try {
    const result = await encoder(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data) as number[];
  } catch {
    return null;
  }
}

export async function rebuildCache(): Promise<void> {
  const entries: VectorEntry[] = [];
  const encoder = await getEncoder();
  if (!encoder) return;

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        const content = fs.readFileSync(full, 'utf-8');
        const title = content.split('\n').find(l => l.startsWith('# '))?.replace('# ', '').trim() || entry.name.replace('.md', '');
        const text = content.replace(/[#*\[\]`>|]/g, ' ').substring(0, 2000);
        entries.push({ file: path.relative(VAULT_DIR, full), title, text, vector: [] });
      }
    }
  }

  walk(VAULT_DIR);

  for (const e of entries) {
    const vec = await embed(e.text);
    if (vec) e.vector = vec;
  }

  cache = entries;
  try {
    const saveData = entries.map(e => ({ file: e.file, title: e.title, text: e.text, vector: Array.from(e.vector) }));
    fs.writeFileSync(VECTOR_CACHE, JSON.stringify(saveData));
  } catch {}
}

export async function semanticSearch(query: string, topK = 3): Promise<{ file: string; title: string; score: number }[]> {
  const qVec = await embed(query);
  if (!qVec) return [];

  if (cache.length === 0) {
    try {
      const raw = fs.readFileSync(VECTOR_CACHE, 'utf-8');
      cache = JSON.parse(raw);
    } catch {
      await rebuildCache();
    }
    if (cache.length === 0) return [];
  }

  const scored = cache
    .filter(e => e.vector.length > 0)
    .map(e => ({ file: e.file, title: e.title, score: cosineSimilarity(qVec, e.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

export async function noteChanged(filename: string): Promise<void> {
  const encoder = await getEncoder();
  if (!encoder) return;

  const full = path.join(VAULT_DIR, filename);
  if (!fs.existsSync(full)) return;

  const content = fs.readFileSync(full, 'utf-8');
  const title = content.split('\n').find(l => l.startsWith('# '))?.replace('# ', '').trim() || path.basename(filename, '.md');
  const text = content.replace(/[#*\[\]`>|]/g, ' ').substring(0, 2000);
  const vec = await embed(text);

  const idx = cache.findIndex(e => e.file === filename);
  const entry = { file: filename, title, text, vector: vec || [] };
  if (idx >= 0) cache[idx] = entry;
  else cache.push(entry);

  try {
    const saveData = cache.map(e => ({ file: e.file, title: e.title, text: e.text, vector: Array.from(e.vector) }));
    fs.writeFileSync(VECTOR_CACHE, JSON.stringify(saveData));
  } catch {}
}
