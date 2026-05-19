import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuid } from 'uuid';
import { writeNote, searchNotes, ensureVault, getAllNoteTitles, vaultPath, hybridSearch, rebuildVectorCache } from './obsidian';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokens?: number;
}

interface MemoryFile {
  conversations: {
    id: string;
    name: string;
    created: number;
    updated: number;
    messages: Message[];
  }[];
  facts: {
    id: string;
    content: string;
    category: string;
    confidence: number;
    timestamp: number;
  }[];
}

const MEMORY_DIR = path.join(os.homedir(), '.nova-memory');
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.json');

function ensureDir(): void {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function load(): MemoryFile {
  ensureDir();
  try {
    const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { conversations: [], facts: [] };
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave: MemoryFile | null = null;

function save(data: MemoryFile): void {
  pendingSave = data;
  if (saveTimer) return; // debounce: wait for pending write
  saveTimer = setTimeout(async () => {
    if (pendingSave) {
      ensureDir();
      try {
        await fs.promises.writeFile(MEMORY_FILE, JSON.stringify(pendingSave, null, 2), 'utf-8');
        pendingSave = null;
      } catch (err) {
        console.error('[内存] 异步写盘失败:', err);
      }
    }
    saveTimer = null;
  }, 3000);
}

// Force save on exit
process.on('exit', () => {
  if (pendingSave) {
    ensureDir();
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(pendingSave, null, 2));
  }
});

export class MemoryStore {
  private data: MemoryFile;
  private currentConvId: string;

  constructor() {
    this.data = load();
    this.currentConvId = this.data.conversations[0]?.id || this.createConversation('default');
  }

  createConversation(name: string): string {
    const id = uuid();
    this.data.conversations.unshift({
      id,
      name,
      created: Date.now(),
      updated: Date.now(),
      messages: []
    });
    save(this.data);
    return id;
  }

  switchConversation(id: string): void {
    if (this.data.conversations.find(c => c.id === id)) {
      this.currentConvId = id;
    }
  }

  deleteConversation(id: string): void {
    this.data.conversations = this.data.conversations.filter(c => c.id !== id);
    if (this.data.conversations.length === 0) {
      this.createConversation('default');
    }
    if (this.currentConvId === id) {
      this.currentConvId = this.data.conversations[0]?.id || '';
    }
    save(this.data);
  }

  addMessage(role: 'user' | 'assistant' | 'system', content: string, tokens?: number): void {
    const conv = this.data.conversations.find(c => c.id === this.currentConvId);
    if (!conv) return;

    conv.messages.push({
      id: uuid(),
      role,
      content,
      timestamp: Date.now(),
      tokens
    });
    conv.updated = Date.now();
    save(this.data);
  }

  getRecentMessages(count = 20): { role: 'user' | 'assistant' | 'system'; content: string }[] {
    const conv = this.data.conversations.find(c => c.id === this.currentConvId);
    if (!conv) return [];
    return conv.messages.slice(-count).map(m => ({
      role: m.role,
      content: m.content
    }));
  }

  addFact(content: string, category: string, confidence = 0.5): void {
    // Snapshot categories: only keep the latest (update in place)
    const snapshotCats = ['personality', 'wisdom', 'skill_progress', 'knowledge_graph'];
    if (snapshotCats.includes(category)) {
      const existing = this.data.facts.find(f => f.category === category);
      if (existing) {
        existing.content = content;
        existing.confidence = confidence;
        existing.timestamp = Date.now();
        save(this.data);
        return;
      }
    }

    this.data.facts.push({
      id: uuid(),
      content,
      category,
      confidence,
      timestamp: Date.now()
    });

    // Prune: keep max 200, remove oldest + lowest confidence first
    if (this.data.facts.length > 200) {
      this.data.facts.sort((a, b) => {
        const ageA = Date.now() - a.timestamp;
        const ageB = Date.now() - b.timestamp;
        const scoreA = a.confidence * (1 - ageA / (30 * 24 * 60 * 60 * 1000));
        const scoreB = b.confidence * (1 - ageB / (30 * 24 * 60 * 60 * 1000));
        return scoreA - scoreB;
      });
      this.data.facts = this.data.facts.slice(-200);
    }
    save(this.data);
  }

  getFacts(category?: string): { content: string; confidence: number }[] {
    let facts = this.data.facts;
    if (category) {
      facts = facts.filter(f => f.category === category);
    }
    return facts
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20)
      .map(f => ({ content: f.content, confidence: f.confidence }));
  }

  getConversations(): { id: string; name: string; created: number; updated: number; messageCount: number }[] {
    return this.data.conversations.map(c => ({
      id: c.id,
      name: c.name,
      created: c.created,
      updated: c.updated,
      messageCount: c.messages.length
    }));
  }

  getCurrentConversationId(): string {
    return this.currentConvId;
  }

  // ——— Obsidian 记忆库集成 ———

  /** 把知识/技能/用户信息写入 Obsidian 笔记 */
  writeKnowledgeNote(category: '技能' | '知识' | '用户' | '项目', title: string, content: string, tags: string[], links: string[] = []): void {
    writeNote(category, title, tags, content, links);
  }

  /** 从 Obsidian 仓库搜索相关知识（关键词） */
  searchVault(query: string, maxResults = 5): { title: string; snippet: string }[] {
    return searchNotes(query, maxResults).map(r => ({ title: r.title, snippet: r.snippet }));
  }

  /** 从 Obsidian 仓库语义搜索（向量） */
  async semanticSearchVault(query: string, maxResults = 3): Promise<{ title: string; snippet: string }[]> {
    const r = await hybridSearch(query, maxResults);
    return r.map(r => ({ title: r.title, snippet: r.snippet }));
  }

  /** 重建向量索引 */
  async rebuildVectors(): Promise<void> {
    await rebuildVectorCache();
  }

  /** 获取所有笔记标题（图谱关联用） */
  getAllNoteTitles(): string[] {
    return getAllNoteTitles();
  }

  /** 确保仓库存在 */
  ensureVault(): void {
    ensureVault();
  }

  /** 获取 vault 根路径 */
  getVaultPath(): string {
    return vaultPath();
  }
}
