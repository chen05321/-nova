import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuid } from 'uuid';

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

function save(data: MemoryFile): void {
  ensureDir();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
}

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
    this.data.facts.push({
      id: uuid(),
      content,
      category,
      confidence,
      timestamp: Date.now()
    });
    // Keep max 200 facts, prune oldest low-confidence ones
    if (this.data.facts.length > 200) {
      this.data.facts.sort((a, b) => a.confidence - b.confidence);
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
}
