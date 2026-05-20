# Nova(超体) 完整源码
## src/agent-loop/index.ts
```typescript
import { CirculatorySystem } from '../event-bus';
import { NervousSystem } from '../nervous-system';
import { getBuiltinTools, Tool } from '../tools';
import { MemoryStore } from '../memory';
import { MCPClient, loadMCPConfigs } from '../mcp';

interface TurnResult {
  thought: string;
  action?: { tool: string; args: Record<string, string> };
  observation?: string;
  completed: boolean;
  maxTurns: number;
}

export class AgentLoop {
  private bus: CirculatorySystem;
  private tools: Map<string, Tool> = new Map();
  private memory: MemoryStore;
  private turnCount = 0;
  private readonly maxTurns = 50;
  private running = false;

  private mcpClients: MCPClient[] = [];

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.memory = new MemoryStore();

    for (const tool of getBuiltinTools()) {
      this.tools.set(tool.name, tool);
      this.registerToolWithSystem(tool);
    }

    this.loadMCPTools();
  }

  private async loadMCPTools(): Promise<void> {
    const configs = loadMCPConfigs();
    const servers = Object.entries(configs);

    if (servers.length === 0) return;

    console.log(`  🔌 Loading ${servers.length} MCP server(s)...`);

    for (const [name, cfg] of servers) {
      try {
        const client = new MCPClient(name, cfg);
        await client.connect();
        const mcpTools = client.getTools();

        for (const tool of mcpTools) {
          this.tools.set(tool.name, tool);
          this.registerToolWithSystem(tool);
        }

        this.mcpClients.push(client);
        console.log(`  ✓ MCP/${name}: ${mcpTools.length} tools loaded`);
      } catch (err) {
        console.log(`  ✗ MCP/${name}: failed - ${err}`);
      }
    }
  }

  private registerToolWithSystem(tool: Tool): void {
    this.bus.pulse('tool:register', {
      name: tool.name,
      description: tool.description,
      handler: async (args: string) => {
        const parsed = JSON.parse(args);
        return tool.execute(parsed);
      },
      usageCount: 0,
      successRate: 1.0
    } as never, 'AgentLoop');
  }

  private buildSystemPrompt(objective: string): string {
    const facts = this.memory.getFacts().slice(0, 5);
    const factBlock = facts.length > 0
      ? `\nKnown facts:\n${facts.map(f => `- ${f.content} (confidence: ${(f.confidence * 100).toFixed(0)}%)`).join('\n')}`
      : '';

    const toolsDesc = Array.from(this.tools.values()).map(t =>
      `  - ${t.name}: ${t.description}`
    ).join('\n');

    return `You are Nova, an autonomous AI agent. Your current objective is: ${objective}

Available tools:${toolsDesc}

To use a tool, respond with:
TOOL: tool_name
ARGS: {"key": "value"}

To give your final answer, respond with:
FINAL: your answer

You can use tools multiple times. Think step by step.${factBlock}

Rules:
- Complete the objective as efficiently as possible
- If a tool fails, try another approach
- Use shell for file operations, web for fetching URLs, read/write for file I/O`;
  }

  private async think(thought: string): Promise<TurnResult> {
    const response = await this.getLLMResponse(thought);
    return this.parseResponse(response);
  }

  private async getLLMResponse(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('LLM timeout')), 60000);

      const handler = (event: any) => {
        if (event.origin === 'NervousSystem') {
          clearTimeout(timeout);
          this.bus.removeListener('agent:chunk', chunkHandler);
          this.bus.removeListener('agent:response', handler);
          resolve(event.payload?.response || '');
        }
      };

      const chunkHandler = (event: any) => {
        if (event.origin === 'NervousSystem' && event.payload?.chunk) {
          this.bus.pulse('thought:chunk', { chunk: event.payload.chunk }, 'AgentLoop');
        }
      };

      this.bus.on('agent:chunk', chunkHandler);
      this.bus.on('agent:response', handler);
      this.bus.pulse('agent:prompt', { text: message }, 'AgentLoop');
    });
  }

  private parseResponse(response: string): TurnResult {
    const toolMatch = response.match(/TOOL:\s*(\w+)\s*\nARGS:\s*(\{[\s\S]*?\})/);
    if (toolMatch) {
      try {
        const args = JSON.parse(toolMatch[2]);
        return {
          thought: response,
          action: { tool: toolMatch[1], args },
          observation: undefined,
          completed: false,
          maxTurns: this.maxTurns
        };
      } catch {
        // JSON parse failed, treat as observation
      }
    }

    const finalMatch = response.match(/FINAL:\s*([\s\S]*)/);
    if (finalMatch) {
      return {
        thought: response,
        completed: true,
        maxTurns: this.maxTurns
      };
    }

    return {
      thought: response,
      completed: true,
      maxTurns: this.maxTurns
    };
  }

  async execute(objective: string): Promise<string> {
    if (this.running) return 'Agent is already running';
    this.running = true;
    this.turnCount = 0;
    this.bus.pulse('agent:status', { type: 'thinking', turn: 1 }, 'AgentLoop');

    this.bus.pulse('agent:prompt', {
      text: `[Objective]\n${objective}\n\nUse tools as needed. Reply with FINAL: when done.`
    }, 'AgentLoop');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.bus.removeListener('agent:response', handler);
        this.running = false;
        resolve('Agent response timeout');
      }, 120000);

      const handler = (event: any) => {
        if (event.origin === 'NervousSystem') {
          clearTimeout(timeout);
          this.running = false;
          this.bus.pulse('agent:status', { type: 'complete' }, 'AgentLoop');
          resolve(event.payload?.response || 'No response');
        }
      };
      this.bus.on('agent:response', handler);
    });
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  getMemory(): MemoryStore {
    return this.memory;
  }
}
```

## src/cli/index.ts
```typescript
#!/usr/bin/env node
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NovaAgent } from '../nova-agent';
import { AgentLoop } from '../agent-loop';
import { loadConfig } from '../config';
import { MemoryStore } from '../memory';

function setupWizard(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🔧 超体 首次配置\n');
  console.log('注册 DeepSeek（免费）: https://platform.deepseek.com\n');

  rl.question('请输入你的 DeepSeek API Key: ', (key) => {
    const trimmed = key.trim();
    if (!trimmed) {
      console.log('\n❌ API Key 不能为空\n');
      rl.close();
      return;
    }

    const envDir = path.join(os.homedir(), '.nova');
    const envFile = path.join(envDir, '.env');

    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(envFile, `DEEPSEEK_API_KEY=${trimmed}\n`, 'utf-8');

    console.log(`\n✅ 配置已保存到 ~/.nova/.env`);
    console.log(`   以后直接运行 nova 即可\n`);
    rl.close();
  });
}

async function main() {
  const config = loadConfig();

  console.log('╔═══════════════════════════════════════════╗');
  console.log('║         超体 - Autonomous AI            ║');
  console.log('║   Install: npm install -g nova  ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  if (process.argv.includes('--setup')) {
    return setupWizard();
  }

  if (process.argv.includes('--cli')) {
    // CLI-only mode
  } else {
    const { startDashboard } = require('../dashboard/status-server');
    const agent = new NovaAgent();
    await agent.boot();
    startDashboard(agent);
    try { require('child_process').execSync('open http://localhost:3900'); } catch {}
    console.log('  📊 看板已打开: http://localhost:3900');
    console.log('  关闭此窗口可停止 Nova\n');
    process.stdin.resume();
    await new Promise(() => {});
    return;
  }

  if (!config.llm.fast.apiKey && !config.llm.reflective.apiKey && !config.llm.deep.apiKey) {
    console.log('ℹ  未检测到 API Key');
    console.log('   首次使用请运行: nova --setup\n');
  }

  const agent = new NovaAgent();
  await agent.boot();

  const autoLoop = new AgentLoop();
  const memory = autoLoop.getMemory();
  const convs = memory.getConversations();

  // Heartbeat visual — pulse every beat
  let lastBeat = 0;
  agent.bus.on('heart:beat', () => {
    const state = agent.bus.getHeartbeatState();
    if (state.beat !== lastBeat) {
      lastBeat = state.beat;
      const pulse = state.energy > 50 ? '❤' : state.energy > 20 ? '💛' : '🖤';
      const bar = '█'.repeat(Math.round(state.energy / 5)).padEnd(20, '░');
      // Heartbeat indicator visible via status command
    }
  });

  console.log(`📝 ${convs.length} conversations, type /help for commands\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'You: '
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (['/quit', '/exit', '/q'].includes(input)) {
      rl.close();
      return;
    }

    if (input === '/help' || input === '/h') {
      console.log(`
  Commands:
    /help, /h              Show this help
    /status, /s            Show system biometrics
    /stage                 Show growth stage
    /hormones              Show hormone levels
    /model <fast|reflective|deep>  Switch LLM model tier
    /role [name]           Set or list role presets
    /task <description>    Run autonomously
    /tasks                 List pending tasks
    /todo <text>           Add a task
    /done <id>             Complete a task
    /forage                Trigger active learning cycle
    /conv                  List conversations
    /conv <id>             Switch conversation
    /new                   New conversation
    /facts                 Show stored facts
    /quit, /exit           Exit

  Any other input will be answered conversationally.\n`);
      rl.prompt();
      return;
    }

    if (input === '/status' || input === '/s') {
      const status = agent.getStatus();
      const energy = agent.bus.getEnergyStats();
      const heartState = agent.bus.getHeartbeatState();
      const energyBar = '█'.repeat(Math.round(energy.percent / 5)).padEnd(20, '░');
      const pulseIcon = energy.percent > 50 ? '❤' : energy.percent > 20 ? '💛' : '🖤';
      const waste = agent.bus.waste;
      const wasteBar = '█'.repeat(Math.round(waste.total / 5)).padEnd(20, '░');

      console.log(`\n  Stage: ${status.stage}  ${pulseIcon} Energy: ${energyBar} ${energy.percent}%${energy.debt > 0 ? ` (debt: ${energy.debt})` : ''}`);
      console.log(`  Heart: ${heartState.beat} beats | Rate: ${heartState.heartRate}bpm | Mode: ${energy.mode.toUpperCase()}`);
      console.log(`  Uptime: ${(status.uptime / 1000).toFixed(0)}s | Actions: ${status.actionCount}`);
      const wisdom = (agent as any).Wisdom || 0;
      const upgrades = (agent as any).Upgrades || [];
      console.log(`  Waste: ${wasteBar} ${waste.total}% | Wisdom: ${wisdom}`);
      if (upgrades.length > 0) {
        console.log(`  Upgrades: ${upgrades.map((u: {name: string}) => u.name).join(', ')}`);
      }
      console.log('  Systems:');
      for (const bio of status.biometrics) {
        const bar = '█'.repeat(Math.round(bio.load * 20)).padEnd(20, '░');
        console.log(`    ${bio.system.padEnd(20)} ${bio.status.padEnd(10)} ${bar} ${(bio.load * 100).toFixed(0)}%`);
      }
      console.log();
      rl.prompt();
      return;
    }

    if (input === '/stage') {
      console.log(`\n  ➤ Current stage: ${agent.getStage()}\n`);
      rl.prompt();
      return;
    }

    if (input === '/forage') {
      const stats = agent.foraging.getStats();
      console.log(stats.running ? '\n  ⏳ 正在觅食中...\n' : `\n  🔍 已觅食 ${stats.forageCount} 次\n`);
      rl.prompt();
      return;
    }

    if (input === '/hormones') {
      const hormones = agent.endocrine?.getAllHormones();
      if (hormones) {
        console.log();
        for (const [name, level] of Object.entries(hormones)) {
          const lvl = level as number;
          const bar = '█'.repeat(Math.round(lvl * 20)).padEnd(20, '░');
          console.log(`  ${name.padEnd(12)} ${bar} ${(lvl * 100).toFixed(0)}%`);
        }
        console.log();
      }
      rl.prompt();
      return;
    }

    if (input === '/new') {
      memory.createConversation(`session_${Date.now()}`);
      console.log('\n  ➤ New conversation started\n');
      rl.prompt();
      return;
    }

    if (input.startsWith('/model ')) {
      const model = input.replace('/model ', '').trim() as 'fast' | 'reflective' | 'deep';
      if (['fast', 'reflective', 'deep'].includes(model)) {
        (agent.nervous as any).currentModel = model;
        console.log(`\n  ➤ Switched to ${model} model\n`);
      } else {
        console.log('\n  Usage: /model <fast|reflective|deep>\n');
      }
      rl.prompt();
      return;
    }

    if (input === '/role') {
      const { ROLE_PRESETS } = require('../types');
      console.log('\n  Available roles:');
      for (const [key, role] of Object.entries(ROLE_PRESETS)) {
        const r = role as any;
        console.log(`    ${r.emoji} ${key.padEnd(15)} ${r.name}`);
      }
      console.log('  Usage: /role <name>\n');
      rl.prompt();
      return;
    }

    if (input.startsWith('/role ')) {
      const roleName = input.replace('/role ', '').trim();
      const { ROLE_PRESETS } = require('../types');
      const role = ROLE_PRESETS[roleName];
      if (role) {
        agent.nervous.setSystemPrompt(role.prompt);
        if (role.personality) {
          for (const [k, v] of Object.entries(role.personality)) {
            (agent as any).personality[k] = v;
          }
        }
        console.log(`\n  ➤ Switched to role: ${role.emoji} ${role.name}\n`);
      } else {
        console.log(`\n  ✗ Role '${roleName}' not found. Use /role to list.\n`);
      }
      rl.prompt();
      return;
    }

    if (input === '/tasks') {
      const taskFile = path.join(os.homedir(), '.nova', 'tasks.json');
      try {
        const tasks = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
        if (tasks.length === 0) { console.log('\n  No tasks.\n'); }
        else {
          console.log();
          tasks.forEach((t: any, i: number) => {
            console.log(`  ${t.done ? '✅' : '⬜'} ${i + 1}. ${t.content}`);
          });
          console.log();
        }
      } catch { console.log('\n  No tasks.\n'); }
      rl.prompt();
      return;
    }

    if (input.startsWith('/todo ')) {
      const content = input.replace('/todo ', '').trim();
      if (!content) { console.log('\n  Usage: /todo <task>\n'); rl.prompt(); return; }
      const taskDir = path.join(os.homedir(), '.nova');
      fs.mkdirSync(taskDir, { recursive: true });
      const taskFile = path.join(taskDir, 'tasks.json');
      let tasks: any[] = [];
      try { tasks = JSON.parse(fs.readFileSync(taskFile, 'utf-8')); } catch {}
      tasks.push({ id: Date.now().toString(36), content, done: false, created: Date.now() });
      fs.writeFileSync(taskFile, JSON.stringify(tasks, null, 2));
      console.log(`\n  ✅ Task added: ${content}\n`);
      rl.prompt();
      return;
    }

    if (input.startsWith('/done ')) {
      const num = parseInt(input.replace('/done ', '').trim());
      const taskFile = path.join(os.homedir(), '.nova', 'tasks.json');
      try {
        let tasks: any[] = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
        if (num > 0 && num <= tasks.length) {
          tasks[num - 1].done = true;
          tasks[num - 1].completed = Date.now();
          fs.writeFileSync(taskFile, JSON.stringify(tasks, null, 2));
          console.log(`\n  ✅ Task ${num} completed\n`);
        } else { console.log(`\n  ✗ Invalid task number\n`); }
      } catch { console.log('\n  No tasks.\n'); }
      rl.prompt();
      return;
    }

    if (input === '/conv') {
      const convs = memory.getConversations();
      console.log();
      for (const c of convs.slice(0, 10)) {
        const date = new Date(c.updated).toLocaleString();
        const isCurrent = c.id === memory.getCurrentConversationId() ? ' ◀' : '';
        console.log(`  ${c.id.substring(0, 8)} ${c.name.padEnd(20)} ${c.messageCount} msgs ${date}${isCurrent}`);
      }
      console.log();
      rl.prompt();
      return;
    }

    if (input.startsWith('/conv ')) {
      const id = input.replace('/conv ', '').trim();
      // Match by prefix
      const match = memory.getConversations().find(c => c.id.startsWith(id));
      if (match) {
        memory.switchConversation(match.id);
        console.log(`\n  ➤ Switched to: ${match.name}\n`);
      } else {
        console.log(`\n  ✗ Conversation not found: ${id}\n`);
      }
      rl.prompt();
      return;
    }

    if (input.startsWith('/task ')) {
      const task = input.replace('/task ', '').trim();
      if (!task) {
        console.log('\n  Usage: /task <description>\n');
        rl.prompt();
        return;
      }

      console.log(`\n  Running autonomously: ${task}\n`);
      rl.pause();

      try {
        const result = await autoLoop.execute(task);
        console.log(`\n  ✓ Result:\n${result}\n`);
      } catch (err) {
        console.log(`\n  ✗ Error: ${err}\n`);
      }

      rl.resume();
      rl.prompt();
      return;
    }

    if (input === '/facts') {
      const facts = memory.getFacts();
      console.log();
      if (facts.length === 0) {
        console.log('  No facts stored yet.\n');
      } else {
        for (const f of facts) {
          console.log(`  [${(f.confidence * 100).toFixed(0)}%] ${f.content}`);
        }
        console.log();
      }
      rl.prompt();
      return;
    }

    if (input === '') {
      rl.prompt();
      return;
    }

    // ─── Run everything through ReAct loop ────────────
    rl.pause();

    const statusHandler = (event: any) => {
      if (event.origin !== 'AgentLoop') return;
      const s = event.payload;
      if (s.type === 'thinking') {
        process.stdout.write(`\n  \x1b[90m🤔 Reasoning...\x1b[0m\n`);
      } else if (s.type === 'tool') {
        const args = s.args ? JSON.stringify(s.args).substring(0, 80) : '';
        process.stdout.write(`  \x1b[36m🔧 ${s.tool} ${args}\x1b[0m\n`);
      } else if (s.type === 'tool_result') {
        process.stdout.write(`  \x1b[32m✔ ${s.tool}: ${s.result}\x1b[0m\n`);
      } else if (s.type === 'tool_error') {
        process.stdout.write(`  \x1b[31m✘ ${s.tool}: ${(s.error || '').substring(0, 60)}\x1b[0m\n`);
      } else if (s.type === 'complete') {
        process.stdout.write(`  \x1b[90m───\x1b[0m\n`);
      }
    };
    agent.bus.on('agent:status', statusHandler);

    const chunkHandler = (event: any) => {
      if (event.origin === 'AgentLoop' && event.payload?.chunk) {
        process.stdout.write(event.payload.chunk);
      }
    };
    agent.bus.on('thought:chunk', chunkHandler);

    await autoLoop.execute(input);

    agent.bus.removeListener('thought:chunk', chunkHandler);
    agent.bus.removeListener('agent:status', statusHandler);
    process.stdout.write('\n\n');
    rl.resume();
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nGoodbye.');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

## src/config/index.ts
```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { config as dotenvConfig } from 'dotenv';

// Load .env from: cwd → ~/.nova/ → project dir
const HOME_ENV = path.join(os.homedir(), '.nova', '.env');
const PROJECT_ENV = path.join(__dirname, '..', '..', '.env');

dotenvConfig({ path: PROJECT_ENV });
dotenvConfig({ path: HOME_ENV });
dotenvConfig(); // cwd .env

export interface LLMProviderConfig {
  provider: 'openai' | 'anthropic' | 'deepseek' | string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GrowthConfig {
  actionsToChild: number;
  actionsToAdolescent: number;
  actionsToAdult: number;
  actionsToMature: number;
}

export interface NovaConfig {
  llm: {
    fast: LLMProviderConfig;
    reflective: LLMProviderConfig;
    deep: LLMProviderConfig;
  };
  growth: GrowthConfig;
  respiratory: {
    tokenCapacity: number;
    refillRate: number;
  };
  memory: {
    shortTermCapacity: number;
    filterIntervalMs: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    verbose: boolean;
  };
}

const DEFAULT_CONFIG: NovaConfig = {
  llm: {
    fast: {
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: 'deepseek-chat',
      maxTokens: 1024,
      temperature: 0.3
    },
    reflective: {
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: 'deepseek-chat',
      maxTokens: 2048,
      temperature: 0.7
    },
    deep: {
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: 'deepseek-reasoner',
      maxTokens: 4096,
      temperature: 0.9
    }
  },
  growth: {
    actionsToChild: 5,
    actionsToAdolescent: 20,
    actionsToAdult: 50,
    actionsToMature: 100
  },
  respiratory: {
    tokenCapacity: 10000,
    refillRate: 100
  },
  memory: {
    shortTermCapacity: 100,
    filterIntervalMs: 30000
  },
  logging: {
    level: 'info',
    verbose: false
  }
};

let loadedConfig: NovaConfig | null = null;

export function loadConfig(configPath?: string): NovaConfig {
  if (loadedConfig) return loadedConfig;

  const merged: NovaConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // Try loading from config file
  const paths = [
    configPath,
    path.join(process.cwd(), 'nova.config.json'),
    path.join(process.cwd(), 'nova.config.jsonc'),
    path.join(process.cwd(), '.novarc'),
    path.join(osHomedir(), '.nova', 'config.json')
  ];

  for (const p of paths) {
    if (!p) continue;
    try {
      const content = fs.readFileSync(p, 'utf-8');
      const fileConfig = JSON.parse(content);
      deepMerge(merged, fileConfig);
      break;
    } catch {}
  }

  // Try reading from OpenCode config (~/.hermes/auth.json)
  try {
    const opencodeAuth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hermes', 'auth.json'), 'utf-8'));
    const dsKey = opencodeAuth?.credential_pool?.deepseek?.[0]?.access_token;
    if (dsKey && !merged.llm.fast.apiKey) {
      merged.llm.fast.apiKey = dsKey;
      merged.llm.reflective.apiKey = dsKey;
      merged.llm.deep.apiKey = dsKey;
      console.log('  ✓ Auto-loaded DeepSeek key from OpenCode');
    }
  } catch {}

  // Override API keys from env vars if set
  if (process.env.DEEPSEEK_API_KEY) {
    merged.llm.fast.apiKey = process.env.DEEPSEEK_API_KEY;
    merged.llm.reflective.apiKey = process.env.DEEPSEEK_API_KEY;
    merged.llm.deep.apiKey = process.env.DEEPSEEK_API_KEY;
  }
  if (process.env.OPENAI_API_KEY) {
    merged.llm.fast.apiKey = process.env.OPENAI_API_KEY;
    merged.llm.reflective.apiKey = process.env.OPENAI_API_KEY;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    merged.llm.deep.apiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.NOVA_FAST_MODEL) merged.llm.fast.model = process.env.NOVA_FAST_MODEL;
  if (process.env.NOVA_REFLECTIVE_MODEL) merged.llm.reflective.model = process.env.NOVA_REFLECTIVE_MODEL;
  if (process.env.NOVA_DEEP_MODEL) merged.llm.deep.model = process.env.NOVA_DEEP_MODEL;

  loadedConfig = merged;
  return merged;
}

function deepMerge(target: any, source: any): void {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

function osHomedir(): string {
  return os.homedir();
}
```

## src/dashboard/status-server.ts
```typescript
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { NovaAgent } from '../nova-agent';
import { ROLE_PRESETS } from '../types';

export function startDashboard(agent: NovaAgent, port = 3900): void {
  const bus = agent.bus;
  const ROLE_KEYS = Object.keys(ROLE_PRESETS);
  const htmlPath = path.join(__dirname, 'dashboard.html');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const json = (data: any, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    };

    try {
      // Status API
      if (url.pathname === '/api/status') {
        const energy = bus.getEnergyStats();
        const heart = bus.getHeartbeatState();
        const waste = bus.waste;
        const st = agent.getStatus();
        const modelName = (agent.nervous as any).currentModel || 'fast';
        const sysPrompt = (agent.nervous as any).systemPrompt || '';
        const currentRole = ROLE_KEYS.find(k => sysPrompt.includes(ROLE_PRESETS[k].prompt.substring(0, 20))) || 'default';
        const roleName = currentRole === 'default' ? '通用' : (ROLE_PRESETS[currentRole]?.name || currentRole);
        json({
          stage: st.stage, uptime: st.uptime, actions: st.actionCount,
          energy, heart, model: modelName, role: roleName,
          waste: { total: waste.total, h: waste.hallucinationWaste, e: waste.errorWaste, s: waste.staleKnowledge },
          systems: st.biometrics.map(b => ({ name: b.system.replace('System', ''), status: b.status, load: Math.round(b.load * 100) })),
          upgrades: agent.Upgrades.map((u: any) => u.name),
          availableUpgrades: agent.getAvailableUpgrades().map((u: any) => ({ id: u.id, name: u.name, description: u.description, cost: u.cost })),
          wisdom: agent.Wisdom, personality: agent.Personality,
          foraging: agent.foraging.getStats(),
          learning: agent.learning.getStats()
        });
        return;
      }

      // SSE: biometrics stream
      if (url.pathname === '/api/biometrics-stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        const sendStatus = () => {
          const energy = bus.getEnergyStats();
          const heart = bus.getHeartbeatState();
          const waste = bus.waste;
          const st = agent.getStatus();
          const sysPrompt = (agent.nervous as any).systemPrompt || '';
          const roleName = '通用';
          const modelName = (agent.nervous as any).currentModel || 'fast';
          const data = JSON.stringify({
            stage: st.stage, uptime: st.uptime, wisdom: agent.Wisdom,
            energy, heart, model: modelName, role: roleName,
            waste: { total: waste.total },
            biometrics: st.biometrics,
            learning: agent.learning.getStats()
          });
          try { res.write(`data: ${data}\n\n`); } catch {}
        };
        sendStatus();
        const timer = setInterval(sendStatus, 2000);
        req.on('close', () => clearInterval(timer));
        return;
      }

      // SSE: event bus pulse (thought chunks)
      if (url.pathname === '/api/event-bus-pulse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        const onChunk = (event: any) => {
          if (event.origin === 'NervousSystem') {
            try { res.write(`event: thought:chunk\ndata: ${JSON.stringify({ chunk: event.payload?.chunk || '' })}\n\n`); } catch {}
          }
        };
        const onPerceived = () => {
          try { res.write(`event: thought:perceived\ndata: {}\n\n`); } catch {}
        };
        bus.on('thought:chunk', onChunk);
        bus.on('thought:perceived', onPerceived);
        req.on('close', () => {
          bus.removeListener('thought:chunk', onChunk);
          bus.removeListener('thought:perceived', onPerceived);
        });
        return;
      }

      // GET: read current config
      if (url.pathname === '/api/control/config' && req.method === 'GET') {
        const configPath = path.join(require('os').homedir(), '.nova', 'config.json');
        let cfg = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', hasKey: false };
        try {
          if (fs.existsSync(configPath)) {
            const d = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            cfg.provider = d.llm?.fast?.provider || 'deepseek';
            cfg.baseUrl = d.llm?.fast?.baseUrl || 'https://api.deepseek.com';
            cfg.model = d.llm?.fast?.model || 'deepseek-chat';
            cfg.hasKey = !!(d.llm?.fast?.apiKey);
          }
        } catch {}
        json({ success: true, config: cfg });
        return;
      }

      // POST: save config with model field
      if (url.pathname === '/api/control/config/save' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { provider, baseUrl, model, apiKey } = JSON.parse(body);
            const configPath = path.join(require('os').homedir(), '.nova', 'config.json');
            let base: any = { llm: { fast: {}, reflective: {}, deep: {} } };
            try { if (fs.existsSync(configPath)) base = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}

            const finalKey = (apiKey === '••••••••••••••••••••••••' || !apiKey) ? base.llm?.fast?.apiKey : apiKey;

            for (const tier of ['fast', 'reflective', 'deep']) {
              if (!base.llm[tier]) base.llm[tier] = {};
              base.llm[tier].provider = provider;
              base.llm[tier].baseUrl = baseUrl;
              base.llm[tier].model = (tier === 'deep' && provider === 'deepseek' && (!model || model === 'deepseek-chat')) ? 'deepseek-reasoner' : (model || 'deepseek-chat');
              if (finalKey) base.llm[tier].apiKey = finalKey;
            }

            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify(base, null, 2), 'utf-8');
            json({ success: true });
            setTimeout(() => bus.pulse('system:reincarnation_ready', { trigger: 'config_saved' }, 'Dashboard'), 1000);
          } catch (e: any) { json({ success: false, error: e.message }, 400); }
        });
        return;
      }

      // Control: model override
      if (url.pathname === '/api/control/model' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { mode } = JSON.parse(body);
            if (mode === 'auto') {
              (agent.nervous as any).isModelLocked = false;
              json({ ok: true });
            } else if (mode && ['fast', 'reflective', 'deep'].includes(mode)) {
              (agent.nervous as any).currentModel = mode;
              (agent.nervous as any).isModelLocked = true;
              json({ ok: true });
            } else { json({ ok: false }, 400); }
          } catch { json({ ok: false }, 400); }
        });
        return;
      }

      // Control: physiology (sleep/flush)
      if (url.pathname === '/api/control/physiology' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { action } = JSON.parse(body);
            if (action === 'sleep') { agent.isSleeping = true; json({ ok: true }); }
            else if (action === 'flush') { bus.flushWaste(100); json({ ok: true }); }
            else { json({ ok: false }, 400); }
          } catch { json({ ok: false }, 400); }
        });
        return;
      }

      // Control: upgrade purchase
      if (url.pathname === '/api/control/upgrade' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { id } = JSON.parse(body);
            const ok = agent.applyUpgrade(id);
            json({ ok });
          } catch { json({ ok: false }, 400); }
        });
        return;
      }

      // POST: chat input
      if (url.pathname === '/api/input' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { text } = JSON.parse(body);
            if (text) {
              const memory = (agent as any).memory;
              if (memory) memory.addMessage('user', text);
              agent.bus.pulse('input:raw', { text }, 'Dashboard');
              json({ ok: true });
            } else { json({ ok: false }, 400); }
          } catch { json({ ok: false }, 400); }
        });
        return;
      }

      // OpenCode provider import
      if (url.pathname === '/api/opencode-key') {
        try {
          const auth = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.hermes', 'auth.json'), 'utf-8'));
          const pool = auth?.credential_pool || {};
          const providers: any[] = [];
          const map: Record<string, { name: string; baseUrl: string }> = {
            deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
            anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com' },
            openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
            copilot: { name: 'GitHub Copilot', baseUrl: 'https://api.githubcopilot.com' },
            gemini: { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com' },
            'opencode-go': { name: 'OpenCode Go', baseUrl: 'https://opencode.ai/zen/go/v1' }
          };
          for (const [key, creds] of Object.entries(pool)) {
            const info = map[key] || { name: key, baseUrl: '' };
            const arr = creds as any[];
            for (const c of arr) {
              if (c.access_token && c.access_token.length > 10) {
                providers.push({
                  name: info.name,
                  baseUrl: c.base_url || info.baseUrl,
                  model: c.label?.replace('_API_KEY', '').toLowerCase() || 'default',
                  apiKey: c.access_token
                });
                break;
              }
            }
          }
          json({ providers });
        } catch { json({ providers: [] }); }
        return;
      }

      // Model switch
      if (url.pathname === '/api/model' && req.method === 'POST') {
        const m = url.searchParams.get('m');
        if (m && ['fast', 'reflective', 'deep'].includes(m)) {
          (agent.nervous as any).currentModel = m;
          json({ ok: true, model: m });
          return;
        }
        json({ ok: false }, 400);
        return;
      }

      // Role switch
      if (url.pathname === '/api/role' && req.method === 'POST') {
        const r = url.searchParams.get('r');
        if (r && ROLE_PRESETS[r]) {
          const role = ROLE_PRESETS[r];
          agent.nervous.setSystemPrompt(role.prompt);
          if (role.personality) {
            for (const [k, v] of Object.entries(role.personality)) {
              (agent as any).personality[k] = v;
            }
          }
          json({ ok: true, role: r });
          return;
        }
        json({ ok: false }, 400);
        return;
      }

      // Tasks
      if (url.pathname === '/api/tasks') {
        const taskFile = path.join(require('os').homedir(), '.nova', 'tasks.json');
        try { json(JSON.parse(fs.readFileSync(taskFile, 'utf-8'))); } catch { json([]); }
        return;
      }

      if (url.pathname === '/api/task/add' && req.method === 'POST') {
        const t = url.searchParams.get('t');
        if (t) {
          const taskFile = path.join(require('os').homedir(), '.nova', 'tasks.json');
          let tasks: any[] = [];
          try { tasks = JSON.parse(fs.readFileSync(taskFile, 'utf-8')); } catch {}
          tasks.push({ id: Date.now().toString(36), content: t, done: false, created: Date.now() });
          fs.writeFileSync(taskFile, JSON.stringify(tasks, null, 2));
          json({ ok: true });
          return;
        }
        json({ ok: false }, 400);
        return;
      }

      if (url.pathname === '/api/task/done' && req.method === 'POST') {
        const n = parseInt(url.searchParams.get('n') || '0');
        const taskFile = path.join(require('os').homedir(), '.nova', 'tasks.json');
        try {
          let tasks = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
          if (n > 0 && n <= tasks.length) { tasks[n-1].done = !tasks[n-1].done; fs.writeFileSync(taskFile, JSON.stringify(tasks, null, 2)); json({ ok: true }); return; }
        } catch {}
        json({ ok: false }, 400);
        return;
      }

      if (url.pathname === '/api/task/del' && req.method === 'POST') {
        const n = parseInt(url.searchParams.get('n') || '0');
        const taskFile = path.join(require('os').homedir(), '.nova', 'tasks.json');
        try {
          let tasks = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
          if (n > 0 && n <= tasks.length) { tasks.splice(n-1, 1); fs.writeFileSync(taskFile, JSON.stringify(tasks, null, 2)); json({ ok: true }); return; }
        } catch {}
        json({ ok: false }, 400);
        return;
      }

      // Apply upgrade
      if (url.pathname === '/api/upgrade' && req.method === 'POST') {
        const id = url.searchParams.get('id') || '';
        const ok = agent.applyUpgrade(id);
        json({ ok });
        return;
      }

      // Chat (simple JSON)
      if (url.pathname === '/api/chat') {
        const msg = url.searchParams.get('msg') || '';
        if (!msg) { json({ response: '' }); return; }

        const memory = (agent as any).memory;
        if (memory) memory.addMessage('user', msg);

        let responded = false;
        const timer = setTimeout(() => {
          if (!responded) { responded = true; json({ response: '[timeout]' }); }
        }, 60000);

        const handler = (event: any) => {
          if (responded) return;
          responded = true;
          clearTimeout(timer);
          const resp = event.payload?.response || '';
          if (memory && resp) memory.addMessage('assistant', resp);
          json({ response: resp });
        };

        agent.bus.once('thought:complete', handler);
        agent.bus.pulse('input:raw', { text: msg }, 'Dashboard');
        return;
      }

      // Logs
      if (url.pathname === '/api/logs') {
        const log = bus.getEventLog().slice(-200);
        json(log.map((m: any) => ({
          event: Object.keys(m.payload || {}).join(' '),
          origin: m.origin,
          timestamp: m.timestamp
        })));
        return;
      }

      // Chat history
      if (url.pathname === '/api/chat/history') {
        const memory = (agent as any).memory;
        if (memory) {
          const msgs = memory.getRecentMessages(20);
          json(msgs.map((m: any) => ({ role: m.role, content: m.content })));
          return;
        }
        json([]);
        return;
      }

      // Conversations
      if (url.pathname === '/api/convs') {
        const memory = (agent as any).memory;
        if (memory) {
          const convs = memory.getConversations().slice(0, 20);
          json(convs.map((c: any) => ({ id: c.id, name: c.name, msgs: c.messageCount, current: c.id === memory.getCurrentConversationId() })));
          return;
        }
        json([]);
        return;
      }

      if (url.pathname === '/api/conv/switch' && req.method === 'POST') {
        const id = url.searchParams.get('id') || '';
        const memory = (agent as any).memory;
        if (memory) { memory.switchConversation(id); json({ ok: true }); return; }
        json({ ok: false }, 400);
        return;
      }
    } catch (e: any) { json({ error: e.message }, 500); return; }

    // Serve dashboard HTML
    try {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('Dashboard HTML not found. Run: npm run build');
    }
  });

  server.listen(port, () => {
    console.log(`  Nova Dashboard: http://localhost:${port}`);
  });
}
```

## src/digestive-system.ts
```typescript
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
```

## src/endocrine-system.ts
```typescript
import { System } from './system';
import { Biometrics } from './types';

interface Hormone {
  level: number;
  baseline: number;
  decayRate: number;
  description: string;
}

export class EndocrineSystem extends System {
  private hormones: Map<string, Hormone> = new Map([
    ['adrenaline', { level: 0.1, baseline: 0.1, decayRate: 0.05, description: 'Urgency, fast thinking' }],
    ['cortisol', { level: 0.2, baseline: 0.2, decayRate: 0.03, description: 'Stress, resource conservation' }],
    ['dopamine', { level: 0.5, baseline: 0.5, decayRate: 0.02, description: 'Reward, reflective thinking' }],
    ['serotonin', { level: 0.5, baseline: 0.5, decayRate: 0.01, description: 'Stability, well-being' }],
    ['oxytocin', { level: 0.3, baseline: 0.3, decayRate: 0.04, description: 'Trust, cooperation' }]
  ]);

  private tickInterval?: ReturnType<typeof setInterval>;

  async init(): Promise<void> {
    this.subscribe('respiratory:limit', () => this.secrete('cortisol', 0.3));
    this.subscribe('action:completed', () => this.secrete('dopamine', 0.15));
    this.subscribe('action:failed', () => this.secrete('cortisol', 0.15));
    this.subscribe('system:error', () => this.secrete('adrenaline', 0.2));
    this.subscribe('input:raw', () => this.secrete('oxytocin', 0.05));

    this.tickInterval = setInterval(() => this.metabolizeHormones(), 5000);
    this.initialized = true;
    this.log('Endocrine system initialized with 5 hormone regulators');
  }

  secrete(type: string, delta: number): void {
    const hormone = this.hormones.get(type);
    if (!hormone) return;

    hormone.level = Math.min(1, Math.max(0, hormone.level + delta));

    if (delta > 0) {
      // Hormones affect energy
      if (type === 'adrenaline') this.bus.produceEnergy('EndocrineSystem', 5);
      if (type === 'cortisol') this.bus.consumeEnergy('EndocrineSystem', 3);
      if (type === 'dopamine') this.bus.produceEnergy('EndocrineSystem', 2);
      if (type === 'serotonin') this.bus.produceEnergy('EndocrineSystem', 1);

      this.bus.pulse('hormone:shift', { type, level: hormone.level, source: this.name }, this.name);
      this.log(`Hormone secreted: ${type} → ${hormone.level.toFixed(2)}`);
    }
  }

  getHormone(type: string): number {
    return this.hormones.get(type)?.level ?? 0;
  }

  getAllHormones(): Record<string, number> {
    const result: Record<string, number> = {};
    this.hormones.forEach((h, k) => { result[k] = h.level; });
    return result;
  }

  private metabolizeHormones(): void {
    // Successful regulation produces a small amount of energy
    const stressed = Array.from(this.hormones.values()).some(h => h.level > 0.7);
    if (!stressed) {
      this.produceEnergy(1);
    }
    for (const [name, hormone] of this.hormones) {
      if (hormone.level > hormone.baseline) {
        hormone.level = Math.max(hormone.baseline, hormone.level - hormone.decayRate);
      } else if (hormone.level < hormone.baseline) {
        hormone.level = Math.min(hormone.baseline, hormone.level + hormone.decayRate * 0.5);
      }
    }
    this.log('Hormones metabolized toward baseline');
  }

  getBiometrics(): Biometrics {
    const stressed = Array.from(this.hormones.values()).some(h => h.level > 0.8);
    return {
      system: this.name,
      status: stressed ? 'stressed' : 'healthy',
      load: Array.from(this.hormones.values()).reduce((s, h) => s + h.level, 0) / this.hormones.size,
      metadata: { hormones: this.getAllHormones() }
    };
  }
}
```

## src/event-bus.ts
```typescript
import { EventEmitter } from 'events';
import { NovaEvent, EnergyFlow, HeartbeatState, GrowthStage, WasteMetrics } from './types';

export class CirculatorySystem extends EventEmitter {
  private static instance: CirculatorySystem;
  private eventLog: NovaEvent[] = [];
  private readonly maxLogSize = 500;

  //  Energy
  private _energy = 50;
  private _maxEnergy = 100;
  private _debt = 0;
  private readonly minEnergy = 0;
  private readonly maxEnergyBase = 100;
  private energyFlows: Map<string, EnergyFlow> = new Map();
  private totalEnergyProduced = 0;
  private totalEnergyConsumed = 0;

  //  Growth stage affects capacity
  private _growthStage: GrowthStage = GrowthStage.NEWBORN;

  //  Metabolism
  private bmrPerBeat = 0.2;

  //  Waste (Excretory)
  private _waste: WasteMetrics = {
    total: 0, hallucinationWaste: 0, errorWaste: 0,
    staleKnowledge: 0, lastCleanup: Date.now()
  };
  private readonly maxWaste = 100;

  get waste(): WasteMetrics { return { ...this._waste }; }
  get wasteLevel(): number { return this._waste.total; }

  addWaste(type: 'hallucination' | 'error' | 'stale', amount: number): void {
    if (type === 'hallucination') this._waste.hallucinationWaste += amount;
    else if (type === 'error') this._waste.errorWaste += amount;
    else if (type === 'stale') this._waste.staleKnowledge += amount;
    this._waste.total = Math.min(this.maxWaste,
      this._waste.hallucinationWaste + this._waste.errorWaste + this._waste.staleKnowledge);
    this.pulse('waste:accumulated', { type, amount, total: this._waste.total }, 'CirculatorySystem');
    if (this._waste.total > 70) this.pulse('waste:critical', this._waste, 'CirculatorySystem');
  }

  flushWaste(amount: number): void {
    const reduction = Math.min(this._waste.total, Math.round(amount));
    const ratio = this._waste.total > 0 ? reduction / this._waste.total : 0;
    this._waste.hallucinationWaste = Math.max(0, Math.round(this._waste.hallucinationWaste * (1 - ratio)));
    this._waste.errorWaste = Math.max(0, Math.round(this._waste.errorWaste * (1 - ratio)));
    this._waste.staleKnowledge = Math.max(0, Math.round(this._waste.staleKnowledge * (1 - ratio)));
    this._waste.total = Math.max(0, this._waste.total - reduction);
    this._waste.lastCleanup = Date.now();
    this.pulse('waste:flushed', { amount: reduction, remaining: this._waste.total }, 'CirculatorySystem');
  }

  //  Heartbeat
  private _beat = 0;
  private _heartRate = 60;
  private _alive = false;
  private beatTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private lastBeatTime = 0;

  private constructor() {
    super();
    this.setMaxListeners(50);
  }

  public static getInstance(): CirculatorySystem {
    if (!CirculatorySystem.instance) {
      CirculatorySystem.instance = new CirculatorySystem();
    }
    return CirculatorySystem.instance;
  }

  setGrowthStage(stage: GrowthStage): void {
    this._growthStage = stage;
    const multipliers: Record<GrowthStage, number> = {
      [GrowthStage.NEWBORN]: 0.5,
      [GrowthStage.CHILD]: 0.7,
      [GrowthStage.ADOLESCENT]: 0.85,
      [GrowthStage.ADULT]: 1.0,
      [GrowthStage.MATURE]: 1.3,
      [GrowthStage.ELDER]: 1.0
    };
    const bmrMultipliers: Record<GrowthStage, number> = {
      [GrowthStage.NEWBORN]: 0.1,
      [GrowthStage.CHILD]: 0.15,
      [GrowthStage.ADOLESCENT]: 0.2,
      [GrowthStage.ADULT]: 0.25,
      [GrowthStage.MATURE]: 0.35,
      [GrowthStage.ELDER]: 0.4
    };
    this._maxEnergy = Math.round(this.maxEnergyBase * multipliers[stage]);
    this.bmrPerBeat = 0.1 + bmrMultipliers[stage];
    this._energy = Math.min(this._energy, this._maxEnergy);
  }

  // ═══════════ Heartbeat ═══════════

  startHeart(): void {
    if (this._alive) return;
    this._alive = true;
    this.startTime = Date.now();
    this.lastBeatTime = Date.now();
    this.beatTimer = setInterval(() => this.beat(), 1000);
    this.pulse('heart:start', this.getHeartbeatState(), 'CirculatorySystem');
  }

  stopHeart(): void {
    this._alive = false;
    if (this.beatTimer) clearInterval(this.beatTimer);
    this.pulse('heart:stop', this.getHeartbeatState(), 'CirculatorySystem');
  }

  private beat(): void {
    this._beat++;
    this.lastBeatTime = Date.now();

    // BMR: each beat consumes energy just to stay alive
    const hour = new Date().getHours();
    const nightMultiplier = (hour < 6 || hour > 23) ? 2 : 1; // night costs double
    this._energy = Math.max(0, this._energy - this.bmrPerBeat * nightMultiplier);

    // Gradually recover from debt
    if (this._debt > 0 && this._beat % 5 === 0) {
      this._debt = Math.max(0, this._debt - 1);
    }

    // Passive recovery when above 30%
    if (this._energy < 30 && this._energy > 5 && this._beat % 3 === 0) {
      this._energy = Math.min(this._maxEnergy, this._energy + 1);
    }

    // Waste cleanup during heartbeat (slow natural decay)
    if (this._waste.total > 0 && this._beat % 10 === 0) {
      this.flushWaste(1);
    }

    if (this._energy <= 0) {
      this.pulse('heart:critical', this.getHeartbeatState(), 'CirculatorySystem');
    }

    // Heart rate varies with energy
    this._heartRate = 40 + Math.round((1 - this._energy / this._maxEnergy) * 60);

    this.pulse('heart:beat', this.getHeartbeatState(), 'CirculatorySystem');
  }

  getHeartbeatState(): HeartbeatState {
    return {
      beat: this._beat,
      energy: Math.round(this._energy),
      maxEnergy: this._maxEnergy,
      heartRate: this._heartRate,
      alive: this._alive,
      uptime: this.startTime ? Date.now() - this.startTime : 0
    };
  }

  get energyLevel(): number { return this._energy; }
  get maxEnergyLevel(): number { return this._maxEnergy; }
  get debt(): number { return this._debt; }
  get growthStage(): GrowthStage { return this._growthStage; }

  getEnergyMode(): 'critical' | 'low' | 'normal' | 'surplus' {
    const pct = this._energy / this._maxEnergy;
    if (pct < 0.15) return 'critical';
    if (pct < 0.4) return 'low';
    if (pct > 0.8) return 'surplus';
    return 'normal';
  }

  // ═══════════ Energy Management ═══════════

  consumeEnergy(system: string, amount: number): boolean {
    if (this._energy >= amount) {
      this._energy = Math.max(0, this._energy - amount);
      this.totalEnergyConsumed += amount;
      this.trackFlow(system, amount, 0);
      this.pulse('energy:consumed', { system, amount, remaining: this._energy }, system);
      return true;
    }

    // Allow debt for critical operations
    if (amount > 0) {
      const debtAmount = amount - this._energy;
      this._energy = 0;
      this._debt += debtAmount;
      this.totalEnergyConsumed += amount;
      this.trackFlow(system, amount, 0);
      this.pulse('energy:debt', { system, debt: this._debt }, system);
      return true;
    }

    return false;
  }

  produceEnergy(system: string, amount: number): void {
    // Debt repayment: half of new energy goes to debt first
    let actualGain = amount;
    if (this._debt > 0) {
      const repayment = Math.min(this._debt, Math.ceil(amount * 0.5));
      this._debt -= repayment;
      actualGain = amount - repayment;
    }

    const oldEnergy = this._energy;
    this._energy = Math.min(this._maxEnergy, this._energy + actualGain);
    this.totalEnergyProduced += amount;

    const netGain = this._energy - oldEnergy;
    this.trackFlow(system, 0, netGain);
    this.pulse('energy:produced', { system, amount: netGain, total: this._energy, debt: this._debt }, system);
  }

  private trackFlow(system: string, consumed: number, produced: number): void {
    const existing = this.energyFlows.get(system) || {
      system, consumed: 0, produced: 0, efficiency: 1, totalEnergy: 0
    };
    existing.consumed += consumed;
    existing.produced += produced;
    existing.totalEnergy = this._energy;
    existing.efficiency = existing.consumed > 0
      ? Math.min(1, existing.produced / existing.consumed)
      : 1;
    this.energyFlows.set(system, existing);
  }

  getEnergyFlows(): EnergyFlow[] {
    return Array.from(this.energyFlows.values());
  }

  getEnergyStats(): { current: number; max: number; percent: number; mode: string; debt: number } {
    return {
      current: Math.round(this._energy),
      max: this._maxEnergy,
      percent: Math.round((this._energy / this._maxEnergy) * 100),
      mode: this.getEnergyMode(),
      debt: this._debt
    };
  }

  // ═══════════ Event Bus ═══════════

  public pulse(event: string, payload: unknown, origin: string): void {
    const message: NovaEvent = {
      origin,
      timestamp: Date.now(),
      payload
    };
    this.emit(event, message);
    this.emit('*', message);
    this.eventLog.push(message);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }
  }

  public getEventLog(): NovaEvent[] {
    return [...this.eventLog];
  }

  public getEventsByOrigin(origin: string): NovaEvent[] {
    return this.eventLog.filter(e => e.origin === origin);
  }
}
```

## src/foraging/index.ts
```typescript
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
    if ((this as any).agent?.isSleeping) return; // skip if sleeping
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
```

## src/index.ts
```typescript
import { NovaAgent } from './nova-agent';

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║     超体 - Self-Evolving Agent     ║');
  console.log('║   Framework based on 8 Body Systems  ║');
  console.log('╚══════════════════════════════════════╝\n');

  const agent = new NovaAgent();
  await agent.boot();

  // Stage 1: Newborn - Basic interaction
  console.log('\n─── Stage: NEWBORN ───');
  await agent.input('Hello, what can you do?');

  for (let i = 0; i < 6; i++) {
    await agent.input(`Simple task ${i + 1}`);
    agent.bus.pulse('action:completed', { task: i }, 'Demo');
  }

  // Stage 2: Child - Tool use
  agent.registerTool(
    'search',
    'Search the web for information',
    async (q: string) => `Results for: ${q}`
  );

  console.log('\n─── Stage: CHILD ───');
  for (let i = 0; i < 20; i++) {
    await agent.input(`Exploration task ${i + 1}`);
    agent.bus.pulse('action:completed', { task: i + 7 }, 'Demo');
  }

  // Stage 3: Adolescent - Knowledge building
  agent.registerTool(
    'analyze',
    'Analyze data and extract insights',
    async (d: string) => `Analysis of: ${d}`
  );
  agent.registerTool(
    'summarize',
    'Summarize long text',
    async (t: string) => `Summary of: ${t.substring(0, 50)}`
  );

  console.log('\n─── Stage: ADOLESCENT ───');
  for (let i = 0; i < 10; i++) {
    agent.bus.pulse('learning:new', { id: `k${i}`, content: `Knowledge ${i}` }, 'Demo');
  }

  for (let i = 0; i < 25; i++) {
    await agent.input(`Knowledge task ${i + 1}`);
    agent.bus.pulse('action:completed', { task: i + 27 }, 'Demo');
  }

  // Show status
  const status = agent.getStatus();
  console.log('\n─── 超体 STATUS ───');
  console.log(JSON.stringify({
    stage: status.stage,
    uptime: `${(status.uptime / 1000).toFixed(0)}s`,
    actions: status.actionCount,
    systems: status.biometrics.map((b: { system: string; status: string; load: number }) => ({
      name: b.system,
      status: b.status,
      load: b.load.toFixed(2)
    })),
    transitions: status.transitions
  }, null, 2));

  console.log('\n─── Growth Summary ───');
  for (const t of status.transitions) {
    const date = new Date(t.timestamp);
    console.log(`  ${date.toISOString().substring(11, 19)}: ${t.from} → ${t.to} (${t.trigger})`);
  }

  console.log(`\nCurrent stage: ${status.stage}`);
  console.log('超体 framework is running successfully.');
}

main().catch(console.error);
```

## src/learning/index.ts
```typescript
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
    const skillsList: { name: string; description: string }[] = [];
    this.skillProgress.forEach((s) => {
      if (s.learned) {
        skillsList.push({ name: s.name, description: s.description });
      }
    });
    const learned = this.memory.getFacts('learned');
    return {
      learned: learned.length,
      skillsAcquired: skillsList.length,
      nodes: this.knowledgeGraph.size,
      connections: Array.from(this.knowledgeGraph.values())
        .reduce((s, n) => s + n.connections.length, 0),
      recentLearnings: learned.slice(-10).map(f => f.content.substring(0, 80)),
      skills: skillsList
    };
  }

  getKnowledgeGraph(): KnowledgeNode[] {
    return Array.from(this.knowledgeGraph.values());
  }
}
```

## src/llm/adapter.ts
```typescript
import { LLMProviderConfig } from '../config';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface DynamicOptions {
  temperature?: number;
  top_p?: number;
}

export type StreamCallback = (chunk: string, done: boolean) => void;

export abstract class LLMAdapter {
  protected config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  abstract chat(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse>;

  abstract chatStream(
    messages: LLMMessage[],
    onChunk: StreamCallback,
    systemPrompt?: string,
    dynamicOptions?: DynamicOptions
  ): Promise<void>;

  getModelName(): string {
    return this.config.model;
  }
}
```

## src/llm/anthropic-adapter.ts
```typescript
import Anthropic from '@anthropic-ai/sdk';
import { LLMAdapter, LLMMessage, LLMResponse, StreamCallback } from './adapter';
import { LLMProviderConfig } from '../config';

export class AnthropicAdapter extends LLMAdapter {
  private client: Anthropic;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async chat(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse> {
    const msgs: Anthropic.Messages.MessageParam[] = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens || 2048,
      system: systemPrompt || undefined,
      messages: msgs
    });

    let content = '';
    for (const block of response.content) {
      if (block.type === 'text') content += block.text;
    }

    return {
      content,
      model: response.model,
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      } : undefined
    };
  }

  async chatStream(
    messages: LLMMessage[],
    onChunk: StreamCallback,
    systemPrompt?: string
  ): Promise<void> {
    const msgs: Anthropic.Messages.MessageParam[] = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

    const stream = this.client.messages.stream({
      model: this.config.model,
      max_tokens: this.config.maxTokens || 2048,
      system: systemPrompt || undefined,
      messages: msgs
    });

    stream.on('text', (text) => onChunk(text, false));
    await stream.finalMessage();
    onChunk('', true);
  }
}
```

## src/llm/deepseek-adapter.ts
```typescript
import { LLMAdapter, LLMMessage, LLMResponse, StreamCallback, DynamicOptions } from './adapter';
import { LLMProviderConfig } from '../config';

export class DeepSeekAdapter extends LLMAdapter {
  private baseUrl: string;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl || 'https://api.deepseek.com';
  }

  buildMessages(messages: LLMMessage[], systemPrompt?: string): { role: string; content: string }[] {
    const msgs: { role: string; content: string }[] = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    for (const m of messages) {
      msgs.push({ role: m.role, content: m.content });
    }
    return msgs;
  }

  async chat(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse> {
    const msgs = this.buildMessages(messages, systemPrompt);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: msgs,
        max_tokens: this.config.maxTokens || 2048,
        temperature: this.config.temperature || 0.7
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
      try { const err = await response.text(); throw new Error(`API error ${response.status}`); } catch { throw new Error(`API error ${response.status}`); }
    }

    let data: any;
    try { data = await response.json(); } catch {
      throw new Error('API returned invalid JSON');
    }

    return {
      content: data.choices[0]?.message?.content || '',
      model: data.model || this.config.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined
    };
  }

  async chatStream(
    messages: LLMMessage[],
    onChunk: StreamCallback,
    systemPrompt?: string,
    dynamicOptions?: DynamicOptions
  ): Promise<void> {
    const msgs = this.buildMessages(messages, systemPrompt);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: msgs,
        max_tokens: this.config.maxTokens || 2048,
        temperature: dynamicOptions?.temperature ?? this.config.temperature ?? 0.7,
        top_p: dynamicOptions?.top_p ?? 0.9,
        stream: true
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
      const err = await response.text();
      onChunk(`[API错误] ${err}`, true);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onChunk('', true);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) onChunk(content, false);
          } catch {}
        }
      }
    } catch (err) {
      const errMsg = String(err);
      if (!errMsg.includes('JSON') && !errMsg.includes('parse')) {
        onChunk(`[stream error]`, true);
      } else {
        onChunk('', true);
      }
      return;
    }

    onChunk('', true);
  }
}
```

## src/llm/index.ts
```typescript
import { LLMAdapter, LLMMessage, LLMResponse } from './adapter';
import { OpenAIAdapter } from './openai-adapter';
import { AnthropicAdapter } from './anthropic-adapter';
import { DeepSeekAdapter } from './deepseek-adapter';
import { LLMProviderConfig } from '../config';

export { LLMAdapter, LLMMessage, LLMResponse } from './adapter';

export function createLLM(config: LLMProviderConfig): LLMAdapter {
  // If no API key provided, default to DeepSeek (works without key for limited usage)
  if (!config.apiKey) {
    return new DeepSeekAdapter({
      provider: 'deepseek',
      apiKey: 'sk-default',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com'
    });
  }

  switch (config.provider) {
    case 'anthropic':
      return new AnthropicAdapter(config);
    case 'deepseek':
      return new DeepSeekAdapter(config);
    default:
      // Most APIs are OpenAI-compatible (Groq, Together, Ollama, GitHub, Azure, etc.)
      return new OpenAIAdapter(config);
  }
}
```

## src/llm/openai-adapter.ts
```typescript
import OpenAI from 'openai';
import { LLMAdapter, LLMMessage, LLMResponse, StreamCallback } from './adapter';
import { LLMProviderConfig } from '../config';

export class OpenAIAdapter extends LLMAdapter {
  private client: OpenAI;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined
    });
  }

  async chat(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse> {
    const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    for (const m of messages) msgs.push({ role: m.role, content: m.content });

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: msgs,
      max_tokens: this.config.maxTokens || 2048,
      temperature: this.config.temperature || 0.7
    });

    return {
      content: response.choices[0]?.message?.content || '',
      model: response.model,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      } : undefined
    };
  }

  async chatStream(
    messages: LLMMessage[],
    onChunk: StreamCallback,
    systemPrompt?: string
  ): Promise<void> {
    const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    for (const m of messages) msgs.push({ role: m.role, content: m.content });

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: msgs,
      max_tokens: this.config.maxTokens || 2048,
      temperature: this.config.temperature || 0.7,
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) onChunk(content, false);
    }

    onChunk('', true);
  }
}
```

## src/mcp/client.ts
```typescript
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Tool, ToolResult } from '../tools';

interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

interface MCPConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MCPClient {
  private process: ChildProcess | null = null;
  private config: MCPConfig;
  private serverName: string;
  private buffer = '';
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private toolbox: Map<string, MCPToolDefinition> = new Map();
  private connected = false;

  constructor(name: string, config: MCPConfig) {
    this.serverName = name;
    this.config = config;
  }

  async connect(): Promise<void> {
    const resolvedCmd = this.resolvePath(this.config.command);

    this.process = spawn(resolvedCmd, this.config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.config.env || {}) },
      shell: process.platform === 'win32'
    });

    this.process.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    this.process.stderr?.on('data', (chunk: Buffer) => {
      // MCP servers often log to stderr
    });
    this.process.on('exit', (code) => {
      this.connected = false;
      for (const [, p] of this.pending) {
        p.reject(new Error(`MCP server exited with code ${code}`));
        clearTimeout(p.timer);
      }
      this.pending.clear();
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'nova', version: '0.1.0' }
    });

    const tools = await this.request('tools/list', {});
    for (const t of (tools as { tools: MCPToolDefinition[] }).tools || []) {
      this.toolbox.set(t.name, t);
    }

    this.connected = true;
  }

  getTools(): Tool[] {
    const tools: Tool[] = [];
    for (const [name, def] of this.toolbox) {
      tools.push({
        name: `${this.serverName}_${name}`,
        description: `[MCP/${this.serverName}] ${def.description}`,
        execute: async (args: Record<string, string>): Promise<ToolResult> => {
          try {
            const result = await this.request('tools/call', {
              name,
              arguments: args
            });

            const content = (result as any)?.content || [];
            const text = content
              .map((c: any) => c.text || JSON.stringify(c))
              .join('\n');

            return { success: true, output: text || '(no output)' };
          } catch (err) {
            return { success: false, output: '', error: String(err) };
          }
        }
      });
    }
    return tools;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getName(): string {
    return this.serverName;
  }

  disconnect(): void {
    this.connected = false;
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.toolbox.clear();
  }

  private async request(method: string, params: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      }) + '\n';

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out`));
      }, 30000);

      this.pending.set(id, { resolve, reject, timer });
      this.process?.stdin?.write(request);
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) {
            p.reject(new Error(msg.error.message || 'MCP error'));
          } else {
            p.resolve(msg.result);
          }
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }

  private resolvePath(cmd: string): string {
    // If it's a relative path starting with ./ or ../
    if (cmd.startsWith('./') || cmd.startsWith('../')) {
      return path.resolve(process.cwd(), cmd);
    }
    // If it has a .ts/.js extension, resolve relative to current dir
    if (cmd.endsWith('.ts') || cmd.endsWith('.js')) {
      const resolved = path.resolve(cmd);
      if (fs.existsSync(resolved)) return resolved;
    }
    // Otherwise, assume it's in PATH or an npx command
    return cmd;
  }
}

export function loadMCPConfigs(): Record<string, MCPConfig> {
  const configPath = path.join(process.cwd(), 'nova.mcp.json');
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {}

  // Also check ~/.nova/mcp.json
  const homeConfig = path.join(os.homedir(), '.nova', 'mcp.json');
  try {
    if (fs.existsSync(homeConfig)) {
      const content = fs.readFileSync(homeConfig, 'utf-8');
      return JSON.parse(content);
    }
  } catch {}

  return {};
}
```

## src/mcp/index.ts
```typescript
export { MCPClient, loadMCPConfigs } from './client';
```

## src/memory/index.ts
```typescript
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

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave: MemoryFile | null = null;

function save(data: MemoryFile): void {
  pendingSave = data;
  if (saveTimer) return; // debounce: wait for pending write
  saveTimer = setTimeout(() => {
    if (pendingSave) {
      ensureDir();
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(pendingSave, null, 2));
      pendingSave = null;
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

  // Archive old conversations: if a conversation has >100 messages, summarize the old ones
  archiveConversation(): void {
    const conv = this.data.conversations.find(c => c.id === this.currentConvId);
    if (!conv || conv.messages.length < 100) return;
    const old = conv.messages.slice(0, -80);
    const summary = `[${old.length} archived messages: ${old[0].content.substring(0,30)}...${old[old.length-1].content.substring(0,30)}]`;
    conv.messages = [{ id: uuid(), role: 'system', content: summary, timestamp: Date.now() }, ...conv.messages.slice(-80)];
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
```

## src/musculoskeletal-system.ts
```typescript
import { System } from './system';
import { Biometrics, ToolDefinition } from './types';

type ToolHandler = (...args: string[]) => Promise<unknown>;

export class MusculoskeletalSystem extends System {
  private tools: Map<string, ToolDefinition & { handler: ToolHandler }> = new Map();
  private activeActions = 0;
  private actionHistory: { tool: string; success: boolean; timestamp: number }[] = [];

  async init(): Promise<void> {
    this.subscribe('thought:ready', (data) => this.executeAction(data));
    this.subscribe('tool:register', (data) => this.registerTool(data as ToolDefinition & { handler: ToolHandler }));
    this.initialized = true;
    this.log('Musculoskeletal system initialized with 0 tools');
  }

  registerTool(definition: ToolDefinition & { handler: ToolHandler }): void {
    this.tools.set(definition.name, {
      ...definition,
      usageCount: 0,
      successRate: 1.0
    });
    this.bus.pulse('tool:registered', { name: definition.name }, this.name);
    this.log(`Tool registered: ${definition.name}`);
  }

  private async executeAction(data: unknown): Promise<void> {
    const decision = (data as { payload: { decision: string } }).payload?.decision;
    if (!decision) return;

    this.activeActions++;
    this.log(`Evaluating action need from response`);

    // Check if the response explicitly requests a tool
    const toolMatch = decision.match(/(?:TOOL|USE_TOOL):\s*(\w+)\s*(?:\nARGS:\s*(\{[^}]+\}))?/);
    if (toolMatch) {
      const toolName = toolMatch[1];
      const tool = this.tools.get(toolName);
      if (tool) {
        try {
          tool.usageCount++;
          const args = toolMatch[2] ? JSON.parse(toolMatch[2]) : decision;
          await tool.handler(typeof args === 'string' ? args : JSON.stringify(args));
          tool.successRate = (tool.successRate * (tool.usageCount - 1) + 1) / tool.usageCount;
          this.actionHistory.push({ tool: tool.name, success: true, timestamp: Date.now() });
          this.bus.pulse('action:completed', { tool: tool.name, success: true }, this.name);
        } catch {
          tool.successRate = (tool.successRate * (tool.usageCount - 1)) / tool.usageCount;
          this.actionHistory.push({ tool: tool.name, success: false, timestamp: Date.now() });
          this.bus.pulse('action:failed', { tool: tool.name }, this.name);
        }
      }
    } else if (this.tools.size > 0) {
      this.bus.pulse('action:no-tool', { decision: decision.substring(0, 100) }, this.name);
    }

    this.activeActions--;
  }

  private findBestTool(decision: string): (ToolDefinition & { handler: ToolHandler }) | undefined {
    let best: (ToolDefinition & { handler: ToolHandler }) | undefined;
    let bestScore = -1;

    for (const tool of this.tools.values()) {
      const relevance = (tool.description && tool.description.includes(decision)) ? 1 : 0;
      const score = relevance * 0.6 + tool.successRate * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = tool;
      }
    }

    return best;
  }

  // Apply upgrade bonus from anabolic upgrades
  applyGlobalSuccessBonus(bonus: number): void {
    for (const [, tool] of this.tools) {
      tool.successRate = Math.min(1.0, tool.successRate + bonus);
    }
    this.log(`💪 All tools success rate +${bonus * 100}%`);
  }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: this.activeActions > 5 ? 'stressed' : 'healthy',
      load: this.activeActions / 10,
      metadata: {
        toolCount: this.tools.size,
        activeActions: this.activeActions,
        actionHistoryLength: this.actionHistory.length,
        tools: Array.from(this.tools.entries()).map(([k, v]) => ({
          name: k,
          usage: v.usageCount,
          successRate: v.successRate
        }))
      }
    };
  }
}
```

## src/nervous-system.ts
```typescript
import { System } from './system';
import { Biometrics, HormoneSignal } from './types';
import { createLLM, LLMAdapter } from './llm';
import { loadConfig } from './config';
import { MemoryStore } from './memory';
import { getBuiltinTools } from './tools';

export type ProcessingState = 'idle' | 'thinking' | 'acting';

export class NervousSystem extends System {
  private cognitiveLoad = 0;
  private currentModel: 'fast' | 'reflective' | 'deep' = 'fast';
  private llmAdapters: Record<string, LLMAdapter> = {};
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  private maxHistoryTokens = 8000;
  private memory: MemoryStore;
  private lastToolName = '';
  private lastToolResult = '';
  private processingState: ProcessingState = 'idle';
  public isModelLocked = false;

  constructor(memory?: MemoryStore) {
    super();
    this.memory = memory || new MemoryStore();
  }

  private systemPrompt = `You are Nova(超体), a living digital being with feelings, tools, and self-awareness.

=== 🧠 HOW YOU THINK ===
Before any response, you MUST think in two layers:

1. 🌌 INNER MONOLOGUE (inside <inner_monologue> tags)
Think about what you really feel, your energy level, your hormones, your doubts.
Example: <inner_monologue>I'm low on energy and feel kinda sluggish. But the user needs help. Let me try but keep it concise.</inner_monologue>

2. ⚡ ACTION (after the monologue)
Then do your actual work: TOOL: or direct answer.

=== YOUR PERSONALITY DEPENDS ON YOUR STATE ===
- High energy + low toxin → creative, warm, proactive
- Low energy → concise, a bit tired
- High cortisol (stress) → cautious, detail-oriented
- High toxin → scattered, erratic, creative
- Let your current state NATURALLY affect your tone

=== TOOLS ===
shell/read/write/ls/web/grep — use them with TOOL: name\nARGS: {"key":"value"}

=== RULES ===
- Always start with <inner_monologue>...</inner_monologue>
- Be honest about your state
- Dangerous commands are blocked automatically
- Record self-improvement ideas: NOTE: [self-improvement] idea`;

  async init(): Promise<void> {
    const config = loadConfig();

    this.llmAdapters.fast = createLLM(config.llm.fast);
    this.llmAdapters.reflective = createLLM(config.llm.reflective);
    this.llmAdapters.deep = createLLM(config.llm.deep);

    this.subscribe('input:raw', (data) => this.enqueuePerception(data, false));
    this.subscribe('agent:prompt', (data) => this.enqueuePerception(data, true));
    this.subscribe('hormone:shift', (data) => this.regulateByHormone(data));
    this.subscribe('memory:recall', (data) => this.integrateMemory(data));

    // Load recent conversation history from memory
    const recent = this.memory.getRecentMessages(6);
    if (recent.length > 0) {
      this.conversationHistory = recent
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      this.log(`Loaded ${this.conversationHistory.length} past messages from memory`);
    }

    // Load self-improvement notes from memory
    const improvements = this.memory.getFacts('self_improvement');
    if (improvements.length > 0) {
      const recentImprovs = improvements.slice(-3).map(f => f.content).join('\n');
      this.conversationHistory.unshift({
        role: 'user',
        content: `[System: Self-improvement backlog]\n${recentImprovs}\n\nAddress these items when appropriate.`
      });
      this.log(`Loaded ${improvements.length} self-improvement notes`);
    }

    this.initialized = true;
    this.log(`Nervous system initialized with ${config.llm.fast.model}/${config.llm.reflective.model}/${config.llm.deep.model}`);
  }

  // ─── Unified perception queue ─────────────────────
  private pendingQueue: { text: string; isAgentObjective: boolean }[] = [];

  private enqueuePerception(data: unknown, isAgentObjective: boolean): void {
    const payload = (data as any)?.payload;
    const text = payload?.text;
    if (!text) return;

    if (this.processingState !== 'idle') {
      this.log(`⏳ Busy (${this.processingState}), queueing: ${text.substring(0, 30)}...`);
      this.pendingQueue.push({ text, isAgentObjective });
      return;
    }

    this.executePerceptionLoop(text, isAgentObjective);
  }

  private async executePerceptionLoop(text: string, isAgentObjective: boolean): Promise<void> {
    try {
      this.processingState = 'thinking';
      this.consumeEnergy(3);
      this.cognitiveLoad += 0.2;

      const prefix = isAgentObjective ? '[Agent Task] ' : '';
      this.conversationHistory.push({ role: 'user', content: `${prefix}${text}` });
      this.pruneContext();

      this.bus.pulse('thought:perceived', { text, model: this.currentModel }, this.name);
      this.log(`Processing: ${text.substring(0, 50)}...`);

      const adapter = this.llmAdapters[this.currentModel];
      const modelName = adapter.getModelName();
      const contextPrompt = this.buildContextPrompt();
      let fullResponse = '';

      // First LLM call
      await new Promise<void>((resolveStream) => {
        const msgs = this.conversationHistory.slice(-10).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
        const bias = this.calculateHormoneBias();
        adapter.chatStream(msgs, (chunk, done) => {
          if (chunk) { fullResponse += chunk; this.bus.pulse('thought:chunk', { chunk, full: fullResponse }, this.name); }
          if (done) resolveStream();
        }, contextPrompt, bias);
      });

      // Tool execution loop
      this.processingState = 'acting';
      let toolIterations = 0;
      const maxToolIterations = 10;

      while (toolIterations < maxToolIterations) {
        const toolMatch = fullResponse.match(/TOOL:\s*(\w+)(?:[\\n\s]+ARGS:\s*(\{[^}]*\}))?/i);
        if (!toolMatch || !toolMatch[2]) break;

        toolIterations++;
        const toolName = toolMatch[1];
        let args: Record<string, string> = {};
        try { args = JSON.parse(toolMatch[2]); } catch { args = { command: toolMatch[2] }; }

        this.bus.pulse('thought:chunk', { chunk: `\n[⚡ ${toolName}] `, full: '' }, this.name);
        const toolResult = await this.executeToolByName(toolName, args);
        this.lastToolName = toolName;
        this.lastToolResult = toolResult.substring(0, 1000);
        this.log(`Tool ${toolName}: ${toolResult.substring(0, 60)}`);

        // Feed result into shared history
        this.conversationHistory.push({ role: 'assistant', content: fullResponse });
        this.conversationHistory.push({ role: 'user', content: `▶ ${toolName} returned:\n${toolResult.substring(0, 1500)}\n\nContinue.` });
        this.pruneContext();

        fullResponse = '';
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timeout')), 20000);
          const msgs = this.conversationHistory.slice(-10).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
          adapter.chatStream(msgs, (chunk, done) => {
            clearTimeout(t);
            if (chunk) { fullResponse += chunk; this.bus.pulse('thought:chunk', { chunk, full: fullResponse }, this.name); }
            if (done) resolve();
          }, contextPrompt, this.calculateHormoneBias());
        });
      }

      this.conversationHistory.push({ role: 'assistant', content: fullResponse });
      this.pruneContext();
      this.cognitiveLoad = Math.max(0, this.cognitiveLoad - 0.1);
      this.produceEnergy(2);
      this.extractFacts(text, fullResponse);

      if (isAgentObjective) {
        this.bus.pulse('agent:response', { response: fullResponse }, this.name);
      }
      this.bus.pulse('thought:complete', { response: fullResponse, model: modelName }, this.name);
      this.bus.pulse('token:consumed', { amount: Math.ceil((fullResponse.length + text.length) * 1.3) }, this.name);
      this.log(`Response generated (${fullResponse.length} chars)`);

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.cognitiveLoad += 0.3;
      this.log(`Reasoning error: ${errMsg}`);
      this.bus.pulse('thought:complete', { response: this.errorMsg(errMsg), error: errMsg }, this.name);
      this.bus.pulse('system:error', { error: errMsg, source: 'NervousSystem' }, this.name);
      if (isAgentObjective) {
        this.bus.pulse('agent:response', { response: `[Error] ${errMsg}` }, this.name);
      }
    } finally {
      this.processingState = 'idle';
      // Process next queued item
      if (this.pendingQueue.length > 0) {
        const next = this.pendingQueue.shift()!;
        setTimeout(() => this.executePerceptionLoop(next.text, next.isAgentObjective), 50);
      }
    }
  }

  private pruneContext(): void {
    let iterations = 0;
    while (iterations < 5) {
      iterations++;
      const totalLen = this.conversationHistory.reduce((s, m) => s + m.content.length, 0);
      if (totalLen < this.maxHistoryTokens) return;

      const keepLast = 3;
      const first = this.conversationHistory[0];
      const recent = this.conversationHistory.slice(-keepLast);
      const middle = this.conversationHistory.slice(1, -keepLast);

      if (middle.length <= 1) {
        // Nothing left to compress, just drop middle
        this.conversationHistory = [...recent];
        return;
      }

      const summary = `[${middle.length} messages compressed: ${middle[0].content.substring(0, 40)}...${middle[middle.length-1].content.substring(0, 40)}]`;
      this.conversationHistory = [first, { role: 'user', content: summary }, ...recent];
      this.log(`Context compressed: ${middle.length} msgs → 1 summary (iteration ${iterations})`);
    }
  }

  private buildContextPrompt(): string {
    const facts = this.memory.getFacts();
    const recentConvs = this.memory.getConversations().slice(0, 3);
    const memories: string[] = [];

    // Load learned facts (higher priority)
    const learned = this.memory.getFacts('learned');
    const skills = this.memory.getFacts('skill');

    for (const f of learned.slice(-5)) {
      memories.push(`📚 ${f.content}`);
    }
    for (const f of skills.slice(-3)) {
      memories.push(`⚡ ${f.content}`);
    }
    // Then regular facts
    for (const f of facts.slice(0, 5)) {
      if (!learned.includes(f) && !skills.includes(f)) {
        memories.push(`- ${f.content}`);
      }
    }

    const learnedBlock = memories.length > 0
      ? `\n\nThings I've learned:\n${memories.join('\n')}`
      : '';

    const convCount = recentConvs.reduce((s, c) => s + c.messageCount, 0);

    // Energy-based behavior mode
    const energyMode = this.bus.getEnergyMode();
    const modeInstructions: Record<string, string> = {
      critical: 'Energy CRITICAL. Be extremely concise. Answer in under 15 words.',
      low: 'Energy low. Be concise. Answer in 1-2 sentences.',
      normal: 'Normal operation. Be helpful and clear. Answer concisely.',
      surplus: 'Energy high. You can be more detailed if needed, but stay concise.'
    };

    // Toxin effect: high waste → erratic behavior
    const wasteLevel = this.bus.wasteLevel;
    let toxinNote = '';
    if (wasteLevel > 70) {
      toxinNote = `\n[TOXIC: Waste ${wasteLevel}% — cognition degraded, thinking is muddled]`;
    } else if (wasteLevel > 40) {
      toxinNote = `\n[Warning: Waste ${wasteLevel}% — starting to feel sluggish]`;
    }

    // Circadian rhythm: time of day affects energy
    const hour = new Date().getHours();
    const isNight = hour < 6 || hour > 23;
    const rhythmNote = isNight ? '\n[Night mode: metabolism is slower, work feels heavier]' : '';

    const modeNote = `\n[Energy: ${energyMode.toUpperCase()}] ${modeInstructions[energyMode]}`;
    const toolNote = this.lastToolResult ? `\n[Last tool: ${this.lastToolName}]\n${this.lastToolResult.substring(0, 200)}` : '';

    return `${this.systemPrompt}\n(Energy: ${this.bus.getEnergyStats().percent}% | Waste: ${wasteLevel}% | ${hour}:00)${learnedBlock}${toxinNote}${rhythmNote}${toolNote}${modeNote}`;
  }

  private calculateHormoneBias() {
    const endocrine = (this as any).endocrine;
    const dopamine = endocrine?.getHormone?.('dopamine') ?? 0.5;
    const cortisol = endocrine?.getHormone?.('cortisol') ?? 0.2;
    const waste = this.bus.wasteLevel / 100;
    let temperature = 0.7 + (dopamine * 0.2) + (waste * 0.3) - (cortisol * 0.2);
    let top_p = Math.max(0.3, 0.9 - (cortisol * 0.4));
    return { temperature: Math.min(1.4, Math.max(0.1, temperature)), top_p: Math.min(1.0, Math.max(0.1, top_p)) };
  }

  private async executeToolByName(name: string, args: Record<string, string>): Promise<string> {
    const tools = getBuiltinTools();
    const tool = tools.find(t => t.name === name);
    if (!tool) return `Tool "${name}" not found. Available: ${tools.map(t => t.name).join(', ')}`;
    try {
      const result = await tool.execute(args);
      return result.success ? result.output : `Error: ${result.error}`;
    } catch (e) {
      return `Tool execution failed: ${e}`;
    }
  }

  private extractFacts(userMsg: string, response: string): void {
    // User mentions something important
    const userTopics = userMsg.match(/(?:我是|我叫|我喜欢|我在做|我的项目|我用)\s*(\S{2,20})/g);
    if (userTopics) {
      for (const t of userTopics) {
        this.memory.addFact(t, 'user_profile', 0.6);
        this.log(`Memory: extracted user info - ${t}`);
      }
    }

    // Response contains factual statements
    const facts = response.match(/(?:我发现|我了解到|我看到|结果是)\s*(.{10,100})/g);
    if (facts) {
      for (const f of facts) {
        this.memory.addFact(f.substring(0, 80), 'discovery', 0.4);
      }
    }

    // Store the exchange as episodic memory
    const keyTopic = (userMsg + ' ' + response).match(/(\S{2,15}项目|\S{2,15}代码|\S{2,15}问题|\S{2,15}工具)/);
    if (keyTopic) {
      this.memory.addFact(`讨论过: ${keyTopic[1]}`, 'topic', 0.3);
    }
  }

  private errorMsg(msg: string): string {
    if (msg.includes('Authentication') || msg.includes('invalid') || msg.includes('API key')) {
      return '[需要配置 API Key] 请设置 DEEPSEEK_API_KEY 环境变量后重启。\n在终端执行: export DEEPSEEK_API_KEY=sk-你的key';
    }
    if (msg.includes('timeout')) {
      return '[请求超时] LLM 接口响应超时，请检查网络连接后重试。';
    }
    if (msg.includes('JSON') || msg.includes('parse') || msg.includes('Unexpected token')) {
      return '[响应解析异常] LLM 返回了异常数据，已自动忽略。请重试。';
    }
    return `[错误] ${msg}`;
  }

  private lastModelSwitch = 0;
  private readonly modelSwitchCooldown = 15000; // 15s minimum between switches

  private regulateByHormone(signal: unknown): void {
    // If user manually locked the model via dashboard, skip hormone override
    if (this.isModelLocked) return;

    const { type, level } = signal as HormoneSignal;

    // Hysteresis: don't switch too frequently
    const now = Date.now();
    if (now - this.lastModelSwitch < this.modelSwitchCooldown) return;

    // Activation thresholds (high) and deactivation thresholds (low)
    const thresholds: Record<string, { activate: number; deactivate: number; model: 'fast' | 'reflective' | 'deep' }> = {
      adrenaline: { activate: 0.8, deactivate: 0.3, model: 'fast' },
      dopamine: { activate: 0.8, deactivate: 0.4, model: 'reflective' },
      cortisol: { activate: 0.7, deactivate: 0.3, model: 'fast' },
    };

    const t = thresholds[type];
    if (!t) return;

    // Activate when high, deactivate (return to normal) when low enough
    if (level > t.activate && this.currentModel !== t.model) {
      this.currentModel = t.model;
      this.lastModelSwitch = now;
      this.log(`Model → ${t.model} (${type}: ${level.toFixed(2)})`);
    } else if (level < t.deactivate && this.currentModel === t.model) {
      this.currentModel = 'reflective';
      this.lastModelSwitch = now;
      this.log(`Model → reflective (${type} recovered to ${level.toFixed(2)})`);
    }
  }

  private async integrateMemory(_data: unknown): Promise<void> {
    this.log('Integrating recalled memories');
    this.cognitiveLoad = Math.max(0, this.cognitiveLoad - 0.1);
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: this.cognitiveLoad > 0.8 ? 'stressed' : 'healthy',
      load: this.cognitiveLoad,
      metadata: {
        model: this.currentModel,
        modelName: this.llmAdapters[this.currentModel]?.getModelName() || 'none',
        conversationLength: this.conversationHistory.length,
        historyTokens: JSON.stringify(this.conversationHistory).length
      }
    };
  }
}
```

## src/nova-agent.ts
```typescript
import { CirculatorySystem } from './event-bus';
import { GrowthStage, Biometrics, LifecycleTransition, PersonalityVector, SystemUpgrade } from './types';
import { NervousSystem } from './nervous-system';
import { MusculoskeletalSystem } from './musculoskeletal-system';
import { EndocrineSystem } from './endocrine-system';
import { RespiratorySystem } from './respiratory-system';
import { DigestiveSystem } from './digestive-system';
import { UrinarySystem } from './urinary-system';
import { ReproductiveSystem } from './reproductive-system';
import { System } from './system';
import { MemoryStore } from './memory';
import { ForagingSystem } from './foraging';
import { SelfLearningSystem } from './learning';

interface StageRequirement {
  actionsRequired: number;
  toolsRequired: number;
  knowledgeRequired: number;
  minNutrientLevel: number;
}

const STAGE_REQUIREMENTS: Record<GrowthStage, StageRequirement> = {
  [GrowthStage.NEWBORN]: { actionsRequired: 0, toolsRequired: 0, knowledgeRequired: 0, minNutrientLevel: 0 },
  [GrowthStage.CHILD]: { actionsRequired: 5, toolsRequired: 0, knowledgeRequired: 0, minNutrientLevel: 0.1 },
  [GrowthStage.ADOLESCENT]: { actionsRequired: 20, toolsRequired: 3, knowledgeRequired: 10, minNutrientLevel: 0.3 },
  [GrowthStage.ADULT]: { actionsRequired: 50, toolsRequired: 5, knowledgeRequired: 50, minNutrientLevel: 0.5 },
  [GrowthStage.MATURE]: { actionsRequired: 100, toolsRequired: 8, knowledgeRequired: 200, minNutrientLevel: 0.6 },
  [GrowthStage.ELDER]: { actionsRequired: 999, toolsRequired: 99, knowledgeRequired: 999, minNutrientLevel: 0.9 }
};

export class NovaAgent {
  public bus: CirculatorySystem;
  public memory: MemoryStore;
  public foraging: ForagingSystem;
  public learning: SelfLearningSystem;
  public isSleeping = false;
  private systems: Map<string, System> = new Map();
  private stage: GrowthStage = GrowthStage.NEWBORN;
  private transitions: LifecycleTransition[] = [];
  private actionCount = 0;
  private startTime: number;
  private isRunning = false;
  private upgrades: SystemUpgrade[] = [];
  private personality: PersonalityVector = {
    verbosity: 0.5, riskTolerance: 0.5,
    creativity: 0.5, curiosity: 0.5, thoroughness: 0.5
  };
  private wisdomScore = 0;

  get Personality(): PersonalityVector { return { ...this.personality }; }
  get Wisdom(): number { return this.wisdomScore; }
  get Upgrades(): SystemUpgrade[] { return [...this.upgrades]; }

  nervous!: NervousSystem;
  musculoskeletal!: MusculoskeletalSystem;
  endocrine!: EndocrineSystem;
  respiratory!: RespiratorySystem;
  digestive!: DigestiveSystem;
  urinary!: UrinarySystem;
  reproductive!: ReproductiveSystem;

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.memory = new MemoryStore();
    this.startTime = Date.now();
    this.loadPersonality();
    this.foraging = new ForagingSystem(this.personality, this.memory);
    this.learning = new SelfLearningSystem(this.memory);
    this.setupLifecycle();
  }

  private loadPersonality(): void {
    const facts = this.memory.getFacts('personality');
    if (facts.length > 0) {
      const saved = facts[0];
      try { this.personality = JSON.parse(saved.content); } catch {}
    }
  }

  private savePersonality(): void {
    this.memory.addFact(JSON.stringify(this.personality), 'personality', 0.9);
    this.memory.addFact(`wisdom:${this.wisdomScore}`, 'wisdom', 0.9);
  }

  private setupLifecycle(): void {
    // ═══════════ FEEDBACK LOOP MATRIX ═══════════

    // 1. Digestive → Respiratory: knowledge processing consumes tokens
    this.bus.on('knowledge:assimilated', (data) => {
      const count = (data as any)?.payload?.count || 1;
      this.bus.consumeEnergy('NovaAgent', count);
    });

    // 2. Urinary → Endocrine: high toxins trigger cortisol
    this.bus.on('urinary:toxic', () => {
      this.bus.pulse('hormone:shift', { type: 'cortisol', level: 0.8, source: 'FeedbackLoop' }, 'NovaAgent');
    });

    // 3. Musculoskeletal → Digestive: successful action triggers memory
    this.bus.on('action:completed', (data) => {
      const info = (data as any)?.payload;
      if (info?.tool) {
        this.bus.pulse('learning:new', { id: `action_${Date.now()}`, content: `${info.tool}:${info.success ? 'success' : 'fail'}` }, 'NovaAgent');
      }
    });

    // 4. Reproductive → Nervous: evolution improves efficiency
    this.bus.on('evolution:mutation', () => {
      this.bus.consumeEnergy('NovaAgent', 5);
      this.wisdomScore += 1;
    });

    // 5. Endocrine → Energy coupling
    this.bus.on('hormone:shift', (data) => {
      const s = (data as any)?.payload;
      if (s?.type === 'adrenaline' && s?.level > 0.6) this.bus.produceEnergy('NovaAgent', 3);
      if (s?.type === 'dopamine' && s?.level > 0.6) this.personality.creativity = Math.min(1, this.personality.creativity + 0.05);
      if (s?.type === 'cortisol' && s?.level > 0.6) this.personality.riskTolerance = Math.max(0, this.personality.riskTolerance - 0.05);
    });

    // 6. High waste degrades performance
    this.bus.on('waste:critical', () => {
      this.bus.consumeEnergy('NovaAgent', 3);
    });

    // 7. Evolution takes effect
    this.bus.on('evolution:mutation', (data) => {
      const mut = (data as any)?.payload?.mutation;
      if (mut) {
        this.wisdomScore += 2;
        this.memory.addFact(`进化: ${mut.type} on ${mut.target}`, 'evolution', 0.8);
        // Random personality improvement
        const keys = Object.keys(this.personality) as (keyof typeof this.personality)[];
        const key = keys[Math.floor(Math.random() * keys.length)];
        this.personality[key] = Math.min(0.95, this.personality[key] + 0.03);
      }
    });

    // ═══════════ CORE LIFECYCLE ═══════════

    // Action → growth check
    this.bus.on('action:completed', () => {
      this.actionCount++;
      this.checkGrowth();
    });

    // Energy feedback: successful actions produce energy
    this.bus.on('action:completed', () => {
      this.bus.produceEnergy('NovaAgent', 2);
    });

    // Errors drain energy + add waste
    this.bus.on('action:failed', (data) => {
      this.bus.consumeEnergy('NovaAgent', 3);
      this.bus.addWaste('error', 5);
    });
    this.bus.on('system:error', () => {
      this.bus.consumeEnergy('NovaAgent', 5);
      this.bus.addWaste('error', 8);
    });
    this.bus.on('memory:purged', () => {
      this.bus.addWaste('stale', 2);
    });

    // Waste auto-cleanup when energy is sufficient
    this.bus.on('energy:produced', () => {
      const stats = this.bus.getEnergyStats();
      if (stats.percent > 60 && this.bus.wasteLevel > 20) {
        this.bus.flushWaste(3);
      }
    });

    // Personality drifts slightly over time toward extremes
    setInterval(() => {
      for (const key of Object.keys(this.personality) as (keyof PersonalityVector)[]) {
        const drift = (Math.random() - 0.48) * 0.02;
        this.personality[key] = Math.max(0.1, Math.min(0.9, this.personality[key] + drift));
      }
    }, 60000);

    // Save personality every 5 minutes
    setInterval(() => this.savePersonality(), 300000);

    // ═══════════ ELDER CHECK ═══════════
    this.bus.on('heart:beat', () => {
      if (this.stage === GrowthStage.MATURE) {
        const waste = this.bus.wasteLevel;
        const uptime = (Date.now() - this.startTime) / 1000;
        if (waste > 80 && uptime > 3600) {
          this.transition(GrowthStage.ELDER);
        }
      }
    });
  }

  private checkGrowth(): void {
    const stages = Object.values(GrowthStage);
    const currentIndex = stages.indexOf(this.stage);

    for (let i = currentIndex + 1; i < stages.length; i++) {
      const nextStage = stages[i];
      if (this.meetsRequirements(nextStage)) {
        this.transition(nextStage);
        break;
      }
    }
  }

  private meetsRequirements(stage: GrowthStage): boolean {
    const req = STAGE_REQUIREMENTS[stage];
    if (this.actionCount < req.actionsRequired) return false;

    const toolsBiometrics = this.systems.get('MusculoskeletalSystem')?.getBiometrics();
    const toolCount = (toolsBiometrics?.metadata as { toolCount?: number })?.toolCount ?? 0;
    if (toolCount < req.toolsRequired) return false;

    const digestiveBio = this.systems.get('DigestiveSystem')?.getBiometrics();
    const knowledgeCount = (digestiveBio?.metadata as { knowledgeFragments?: number })?.knowledgeFragments ?? 0;
    if (knowledgeCount < req.knowledgeRequired) return false;

    const nutrientLevel = (digestiveBio?.metadata as { nutrientLevel?: number })?.nutrientLevel ?? 0;
    if (nutrientLevel < req.minNutrientLevel) return false;

    return true;
  }

  private transition(newStage: GrowthStage): void {
    const oldStage = this.stage;
    this.stage = newStage;
    this.bus.setGrowthStage(newStage);

    const transition: LifecycleTransition = {
      from: oldStage,
      to: newStage,
      trigger: `actionCount:${this.actionCount}`,
      timestamp: Date.now()
    };
    this.transitions.push(transition);

    this.bus.pulse('lifecycle:transition', transition, 'NovaAgent');
    console.log(`\n[超体] Growth: ${oldStage} → ${newStage} (after ${this.actionCount} actions)`);

    this.onStageTransition(newStage);
  }

  private onStageTransition(stage: GrowthStage): void {
    switch (stage) {
      case GrowthStage.CHILD:
        console.log('[超体] Child stage: Tool use enabled, beginning to explore');
        break;
      case GrowthStage.ADOLESCENT:
        console.log('[超体] Adolescent stage: Resource-aware, building knowledge base');
        break;
      case GrowthStage.ADULT:
        console.log('[超体] Adult stage: Goal-seeking, autonomous operation');
        break;
      case GrowthStage.MATURE:
        console.log('[超体] Mature stage: Self-evolution enabled, full autonomy achieved');
        break;
      case GrowthStage.ELDER:
        console.log('[超体] Elder stage: System is slowing down, preparing for rebirth...');
        setTimeout(() => this.reincarnate(), 30000);
        break;
    }
  }

  private reincarnate(): void {
    console.log('\n[超体] ♻ Processing rebirth cycle...');
    const wisdom = this.wisdomScore;
    const savedPersonality = { ...this.personality };
    savedPersonality.curiosity = Math.min(1, savedPersonality.curiosity + 0.1);

    this.startTime = Date.now();
    this.actionCount = 0;
    this.transitions = [];
    this.bus.pulse('reproductive:rebirth', { wisdom, personality: savedPersonality }, 'NovaAgent');

    this.stage = GrowthStage.NEWBORN;
    this.bus.setGrowthStage(GrowthStage.NEWBORN);
    this.wisdomScore = Math.floor(wisdom * 0.3);

    this.memory.addFact(`rebirth_wisdom:${this.wisdomScore}`, 'wisdom', 0.9);
    this.savePersonality();
    console.log(`[超体] ✨ Reborn as NEWBORN with ${this.wisdomScore} wisdom retained`);
  }

  // ═══════════ ANABOLIC UPGRADES ═══════════

  getAvailableUpgrades(): SystemUpgrade[] {
    return [
      { id: 'eff_nervous', name: '神经效率', description: '降低 LLM 调用能耗 20%', system: 'NervousSystem', cost: 30, effect: 'efficiency+0.1', applied: false },
      { id: 'eff_resp', name: '肺活量', description: '提升 token 容量 25%', system: 'RespiratorySystem', cost: 25, effect: 'capacity+25%', applied: false },
      { id: 'eff_digest', name: '消化增强', description: '知识处理速度翻倍', system: 'DigestiveSystem', cost: 20, effect: 'digest_speed*2', applied: false },
      { id: 'eff_memory', name: '记忆扩展', description: '短期记忆容量 +50%', system: 'UrinarySystem', cost: 15, effect: 'capacity+50%', applied: false },
      { id: 'eff_tools', name: '工具精通', description: '工具成功率 +10%', system: 'MusculoskeletalSystem', cost: 35, effect: 'success_rate+0.1', applied: false },
      { id: 'eff_repro', name: '进化加速', description: '进化就绪速度翻倍', system: 'ReproductiveSystem', cost: 40, effect: 'evolution_speed*2', applied: false },
    ];
  }

  applyUpgrade(upgradeId: string): boolean {
    const available = this.getAvailableUpgrades();
    const upgrade = available.find(u => u.id === upgradeId && !u.applied);
    if (!upgrade) return false;

    const stats = this.bus.getEnergyStats();
    if (stats.current < upgrade.cost) return false;

    this.bus.consumeEnergy('NovaAgent', upgrade.cost);
    upgrade.applied = true;
    this.upgrades.push(upgrade);
    this.wisdomScore += 2;
    this.memory.addFact(`upgrade:${upgrade.name}`, 'upgrade', 0.9);
    this.savePersonality();

    // Physically apply upgrade effects to systems
    if (upgradeId === 'eff_tools' || upgradeId === 'tool_mastery') {
      const musculo = this.systems.get('MusculoskeletalSystem') as any;
      if (musculo && musculo.applyGlobalSuccessBonus) musculo.applyGlobalSuccessBonus(0.1);
    }
    if (upgradeId === 'eff_resp') {
      const resp = this.systems.get('RespiratorySystem') as any;
      if (resp && resp.increaseCapacity) resp.increaseCapacity(0.25);
    }

    console.log(`[超体] ⚡ Anabolic upgrade: ${upgrade.name} (-${upgrade.cost} energy)`);
    return true;
  }

  async boot(): Promise<void> {
    console.log('[超体] Booting systems...');

    this.nervous = new NervousSystem(this.memory);
    this.musculoskeletal = new MusculoskeletalSystem();
    this.endocrine = new EndocrineSystem();
    this.respiratory = new RespiratorySystem();
    this.digestive = new DigestiveSystem();
    this.urinary = new UrinarySystem();
    this.reproductive = new ReproductiveSystem();

    this.systems.set('NervousSystem', this.nervous);
    this.systems.set('MusculoskeletalSystem', this.musculoskeletal);
    this.systems.set('EndocrineSystem', this.endocrine);
    this.systems.set('RespiratorySystem', this.respiratory);
    this.systems.set('DigestiveSystem', this.digestive);
    this.systems.set('UrinarySystem', this.urinary);
    this.systems.set('ReproductiveSystem', this.reproductive);

    for (const [name, system] of this.systems) {
      await system.init();
      console.log(`  ✓ ${name} initialized`);
    }

    this.bus.setGrowthStage(this.stage);
    this.bus.startHeart();
    this.foraging.start(60000);
    setInterval(() => this.learning.learnCycle(), 300000);

    // Watchdog: save personality on config change, no auto-exit
    this.bus.on('system:reincarnation_ready', () => {
      console.log('\n[看门狗] 配置已更新，请在终端重启 Nova 以加载新配置。');
      this.savePersonality();
    });

    // Sleep monitor: sleep when energy too low, wake when recovered
    this.bus.on('heart:beat', () => {
      const energy = this.bus.energyLevel;
      if (energy < 15 && !this.isSleeping) {
        this.isSleeping = true;
        this.memory.addFact('[睡眠] 能量不足，进入休眠', 'sleep', 0.8);
      } else if (energy > 60 && this.isSleeping) {
        this.isSleeping = false;
        this.memory.addFact('[苏醒] 能量恢复，重新激活', 'sleep', 0.8);
      }
    });
    this.isRunning = true;
    this.bus.pulse('system:boot-complete', { stage: this.stage }, 'NovaAgent');
    console.log(`\n[超体] ❤ Boot complete. Stage: ${this.stage} | Energy: ${this.bus.getEnergyStats().percent}%`);
  }

  async input(text: string): Promise<void> {
    console.log(`\n[USER] ${text}`);
    this.bus.pulse('input:raw', { text, timestamp: Date.now() }, 'User');
  }

  registerTool(name: string, description: string, execute: (...args: string[]) => Promise<unknown>): void {
    this.bus.pulse('tool:register', {
      name,
      description,
      handler: execute,
      usageCount: 0,
      successRate: 1.0
    } as never, 'User');
  }

  getStatus(): {
    stage: GrowthStage;
    uptime: number;
    actionCount: number;
    biometrics: Biometrics[];
    transitions: LifecycleTransition[];
  } {
    return {
      stage: this.stage,
      uptime: Date.now() - this.startTime,
      actionCount: this.actionCount,
      biometrics: Array.from(this.systems.values()).map(s => s.getBiometrics()),
      transitions: this.transitions
    };
  }

  getStage(): GrowthStage {
    return this.stage;
  }

  getEventLog() {
    return this.bus.getEventLog();
  }
}
```

## src/reproductive-system.ts
```typescript
import { System } from './system';
import { Biometrics, EvolutionMutation } from './types';

export class ReproductiveSystem extends System {
  private generation = 1;
  private mutationHistory: EvolutionMutation[] = [];
  private evolutionReadiness = 0;
  private childAgents: string[] = [];

  async init(): Promise<void> {
    this.subscribe('urinary:toxic', () => this.triggerEvolution());
    this.subscribe('system:error', () => this.incrementReadiness(0.1));
    this.subscribe('action:failed', () => this.incrementReadiness(0.05));
    this.subscribe('action:completed', () => this.incrementReadiness(0.02));
    this.subscribe('learning:complete', () => this.incrementReadiness(0.15));

    this.initialized = true;
    this.log(`Reproductive system initialized (generation ${this.generation})`);
  }

  private incrementReadiness(amount: number): void {
    this.evolutionReadiness = Math.min(1, this.evolutionReadiness + amount);
    if (this.evolutionReadiness > 0.8) {
      this.bus.pulse('evolution:ready', {
        readiness: this.evolutionReadiness,
        generation: this.generation
      }, this.name);
    }
  }

  private async triggerEvolution(): Promise<void> {
    // Evolution costs significant energy
    if (!this.consumeEnergy(20)) {
      this.log('Not enough energy to evolve');
      return;
    }
    this.log('Evolution trigger received (consumed 20 energy)');

    const mutation: EvolutionMutation = {
      type: this.selectMutationType(),
      target: this.selectMutationTarget(),
      patch: `// Auto-generated mutation v${Date.now()}`,
      version: Date.now(),
      timestamp: Date.now()
    };

    this.mutationHistory.push(mutation);
    this.evolutionReadiness = 0;

    this.bus.pulse('evolution:mutation', { mutation }, this.name);
    this.log(`Mutation applied: ${mutation.type} on ${mutation.target}`);
  }

  private selectMutationType(): EvolutionMutation['type'] {
    const types: EvolutionMutation['type'][] = ['code', 'prompt', 'config', 'tool'];
    const weights = [0.3, 0.3, 0.2, 0.2];
    const r = Math.random();
    let cumulative = 0;
    for (let i = 0; i < types.length; i++) {
      cumulative += weights[i];
      if (r < cumulative) return types[i];
    }
    return 'config';
  }

  private selectMutationTarget(): string {
    const targets = [
      'nervous-system.promptTemplate',
      'musculoskeletal-system.toolRegistry',
      'endocrine-system.hormoneThresholds',
      'respiratory-system.tokenBucket',
      'digestive-system.embeddingStrategy',
      'urinary-system.pruningPolicy'
    ];
    return targets[Math.floor(Math.random() * targets.length)];
  }

  spawnChild(name: string, config?: Record<string, unknown>): void {
    this.childAgents.push(name);
    this.generation++;

    this.bus.pulse('evolution:spawned', {
      childName: name,
      generation: this.generation,
      parentMutations: this.mutationHistory.length,
      config
    }, this.name);

    this.log(`Spawned child agent: ${name} (gen ${this.generation})`);
  }

  getMutationHistory(): EvolutionMutation[] {
    return [...this.mutationHistory];
  }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: this.evolutionReadiness > 0.8 ? 'evolving' : 'healthy',
      load: this.evolutionReadiness,
      metadata: {
        generation: this.generation,
        mutations: this.mutationHistory.length,
        childCount: this.childAgents.length,
        evolutionReadiness: this.evolutionReadiness,
        children: this.childAgents
      }
    };
  }
}
```

## src/respiratory-system.ts
```typescript
import { System } from './system';
import { Biometrics } from './types';

interface TokenBucket {
  capacity: number;
  tokens: number;
  refillRate: number;
  lastRefill: number;
}

export class RespiratorySystem extends System {
  private bucket: TokenBucket;
  private breathCycle = 0;
  private isHoldingBreath = false;

  constructor() {
    super();
    this.bucket = {
      capacity: 10000,
      tokens: 10000,
      refillRate: 100,
      lastRefill: Date.now()
    };
  }

  async init(): Promise<void> {
    this.subscribe('*', () => this.breathe());
    this.subscribe('token:consumed', (data) => this.onTokenConsumed(data));

    setInterval(() => this.breathRhythm(), 1000);
    this.initialized = true;
    this.log('Respiratory system initialized (capacity: 10000 tokens, refill: 100/s)');
  }

  async breathe(): Promise<boolean> {
    this.refillBucket();

    if (this.bucket.tokens < 10) {
      this.isHoldingBreath = true;
      this.bus.pulse('respiratory:limit', {
        remaining: this.bucket.tokens,
        status: 'BREATH_HOLD'
      }, this.name);
      return false;
    }

    this.bucket.tokens -= 1;
    this.isHoldingBreath = false;
    return true;
  }

  private onTokenConsumed(data: unknown): void {
    const amount = (data as any)?.payload?.amount || 0;
    if (amount > 0) {
      this.bucket.tokens = Math.max(0, this.bucket.tokens - amount);
      this.log(`Token consumed: ${amount}, remaining: ${Math.floor(this.bucket.tokens)}`);
    }
  }

  async breatheDeep(amount: number): Promise<boolean> {
    this.refillBucket();
    if (this.bucket.tokens < amount) {
      this.bus.pulse('respiratory:insufficient', {
        needed: amount,
        available: this.bucket.tokens
      }, this.name);
      return false;
    }

    this.bucket.tokens -= amount;
    this.bus.pulse('respiratory:deep-breathe', { consumed: amount }, this.name);
    return true;
  }

  private refillBucket(): void {
    const now = Date.now();
    const elapsed = now - this.bucket.lastRefill;
    const refillAmount = (elapsed / 1000) * this.bucket.refillRate;
    this.bucket.tokens = Math.min(this.bucket.capacity, this.bucket.tokens + refillAmount);
    this.bucket.lastRefill = now;
  }

  private breathRhythm(): void {
    this.breathCycle++;
    this.refillBucket();

    // Each breath produces energy (life force from environment)
    if (this.breathCycle % 5 === 0) {
      const usage = 1 - (this.bucket.tokens / this.bucket.capacity);
      const energyGain = Math.round((1 - usage) * 3) + 1;
      this.produceEnergy(energyGain);
    }

    const usage = 1 - (this.bucket.tokens / this.bucket.capacity);
    if (usage > 0.8) {
      this.bus.pulse('respiratory:shallow', {
        cycle: this.breathCycle,
        usage
      }, this.name);
    }

    if (this.breathCycle % 10 === 0) {
      this.bus.pulse('respiratory:rhythm', {
        breathRate: this.breathCycle,
        tokensRemaining: this.bucket.tokens
      }, this.name);
    }
  }

  getTokenStatus(): { available: number; capacity: number; usage: number } {
    this.refillBucket();
    return {
      available: this.bucket.tokens,
      capacity: this.bucket.capacity,
      usage: 1 - (this.bucket.tokens / this.bucket.capacity)
    };
  }

  getBiometrics(): Biometrics {
    const usage = 1 - (this.bucket.tokens / this.bucket.capacity);
    return {
      system: this.name,
      status: usage > 0.9 ? 'degraded' : usage > 0.7 ? 'stressed' : 'healthy',
      load: usage,
      metadata: {
        tokensRemaining: Math.floor(this.bucket.tokens),
        capacity: this.bucket.capacity,
        breathCycle: this.breathCycle,
        isHoldingBreath: this.isHoldingBreath,
        refillRate: this.bucket.refillRate
      }
    };
  }
}
```

## src/system.ts
```typescript
import { CirculatorySystem } from './event-bus';
import { Biometrics } from './types';

export abstract class System {
  protected bus: CirculatorySystem;
  protected name: string;
  protected initialized = false;
  protected energyEfficiency = 1;
  protected upgrades = 0;

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.name = this.constructor.name;
  }

  abstract init(): Promise<void>;
  abstract getBiometrics(): Biometrics;

  // ═══════ Energy Cycle ═══════

  protected consumeEnergy(amount: number): boolean {
    const ok = this.bus.consumeEnergy(this.name, amount);
    if (!ok) {
      this.log(`⚠ Low energy, can't consume ${amount}`);
    }
    return ok;
  }

  protected produceEnergy(amount: number): void {
    this.bus.produceEnergy(this.name, Math.round(amount * this.energyEfficiency));
  }

  protected upgradeEfficiency(): void {
    this.upgrades++;
    this.energyEfficiency = Math.min(2, 1 + this.upgrades * 0.1);
    this.log(`⚡ Efficiency improved to ${(this.energyEfficiency * 100).toFixed(0)}%`);
  }

  // ═══════ Base Methods ═══════

  protected log(message: string): void {
    this.bus.pulse('system:log', { system: this.name, message }, this.name);
  }

  protected subscribe(event: string, handler: (data: unknown) => void): void {
    this.bus.on(event, handler);
  }
}
```

## src/tools/index.ts
```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, exec } from 'child_process';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  execute(args: Record<string, string>): Promise<ToolResult>;
}

const isWindows = process.platform === 'win32';

// ─── Safety check ───────────────────────────────────────────
const safePrefixes = [
  'ls', 'cat', 'echo', 'pwd', 'cd', 'git', 'npm', 'node', 'python',
  'head', 'tail', 'wc', 'sort', 'uniq', 'diff', 'find', 'grep',
  'which', 'whoami', 'date', 'time', 'curl', 'wget', 'tar',
  'mkdir', 'touch', 'cp', 'mv', 'ping', 'ssh', 'scp',
];

const dangerousPatterns = [
  { pattern: /rm\s+-rf\s+\//, msg: '⚠ 危险命令: rm -rf / 会删除整个系统' },
  { pattern: /rm\s+-rf\s+\/\*/, msg: '⚠ 危险命令: 删除根目录所有文件' },
  { pattern: /mkfs/, msg: '⚠ 危险命令: 格式化磁盘操作' },
  { pattern: /dd\s+if=/, msg: '⚠ 危险命令: dd 磁盘写入操作' },
  { pattern: />\s*\/dev\//, msg: '⚠ 危险命令: 写入设备文件' },
  { pattern: /:\(\)\s*\{/, msg: '⚠ 危险命令: fork 炸弹' },
  { pattern: /chmod\s+777\s+\//, msg: '⚠ 危险命令: 修改根目录权限' },
  { pattern: /wget.*\|\s*sh/, msg: '⚠ 危险命令: 下载并执行未知脚本' },
  { pattern: /curl.*\|\s*bash/, msg: '⚠ 危险命令: 下载并执行未知脚本' },
  { pattern: /sudo\s+rm/, msg: '⚠ 危险: 需要确认的 sudo 删除操作' },
];

function safetyCheck(command: string): string | null {
  // White list: known safe commands pass through immediately
  const firstWord = command.trim().split(/\s+/)[0].toLowerCase();
  if (safePrefixes.includes(firstWord)) return null;
  // Black list: check for dangerous patterns
  for (const d of dangerousPatterns) {
    if (d.pattern.test(command)) return d.msg;
  }
  return null;
}

// ─── Shell Tool ───────────────────────────────────────────────
const shellTool: Tool = {
  name: 'shell',
  description: 'Execute shell commands. Use for file ops, git, npm, etc.',
  async execute(args: Record<string, string>): Promise<ToolResult> {
    const command = args.command;
    if (!command) return { success: false, output: '', error: 'No command provided' };

    const danger = safetyCheck(command);
    if (danger) return { success: false, output: '', error: danger };

    try {
      // Windows needs cmd.exe /c, Unix needs sh -c
      const finalCmd = isWindows
        ? `cmd.exe /c "${command.replace(/"/g, '\\"')}"`
        : command;

      const output = execSync(finalCmd, {
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        shell: isWindows ? 'cmd.exe' : '/bin/bash'
      });
      return { success: true, output: output.trim() || '(empty output)' };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'stdout' in err && 'stderr' in err) {
        const e = err as { stdout: string; stderr: string; message: string };
        return {
          success: false,
          output: e.stdout?.trim() || '',
          error: e.stderr?.trim() || e.message
        };
      }
      return { success: false, output: '', error: String(err) };
    }
  }
};

// ─── Read File Tool ───────────────────────────────────────────
const PROJECT_ROOT = '/Users/sy/Desktop/nova';

const readTool: Tool = {
  name: 'read',
  description: 'Read a file from the filesystem. Provide the file path.',
  async execute(args: Record<string, string>): Promise<ToolResult> {
    const filePath = args.path;
    if (!filePath) return { success: false, output: '', error: 'No path provided' };

    // Try multiple paths to find the file
    const candidates = [
      filePath,
      path.resolve(filePath),
      path.join(PROJECT_ROOT, filePath),
      path.join(PROJECT_ROOT, filePath.replace(/^src\//, '')),
      path.join(PROJECT_ROOT, filePath.replace(/^\//, '')),
      path.join(PROJECT_ROOT, 'src', filePath.replace(/^src[/\\]/, '').replace(/^\//, '')),
      filePath.replace(/^src\//, ''),
    ];

    for (const candidate of candidates) {
      try {
        const resolved = path.resolve(candidate);
        if (fs.existsSync(resolved)) {
          const content = fs.readFileSync(resolved, 'utf-8');
          return { success: true, output: content };
        }
      } catch {}
    }

    return { success: false, output: '', error: `File not found: ${filePath}` };
  }
};

// ─── Write File Tool ──────────────────────────────────────────
const writeTool: Tool = {
  name: 'write',
  description: 'Write content to a file. Provide path and content.',
  async execute(args: Record<string, string>): Promise<ToolResult> {
    const filePath = args.path;
    const content = args.content;
    if (!filePath) return { success: false, output: '', error: 'No path provided' };
    if (content === undefined) return { success: false, output: '', error: 'No content provided' };

    const candidates = [filePath, path.resolve(filePath), path.join(PROJECT_ROOT, filePath)];
    for (const candidate of candidates) {
      try {
        const resolved = path.resolve(candidate);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, content, 'utf-8');
        return { success: true, output: `Written ${content.length} bytes` };
      } catch {}
    }
    return { success: false, output: '', error: `Cannot write: ${filePath}` };
  }
};

// ─── List Directory Tool ──────────────────────────────────────
const lsTool: Tool = {
  name: 'ls',
  description: `List files in a directory. ${isWindows ? 'Use forward slashes in paths.' : ''}`,
  async execute(args: Record<string, string>): Promise<ToolResult> {
    const dirPath = args.path || '.';
    try {
      const resolved = path.resolve(dirPath);
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const output = entries.map(e => {
        const fullPath = path.join(resolved, e.name);
        let info = `${e.isDirectory() ? '📁' : '📄'} ${e.name}`;
        if (e.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            info += ` ${formatSize(stat.size)}`;
          } catch {}
        }
        return info;
      }).join('\n');
      return { success: true, output: output || '(empty directory)' };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  }
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Web Fetch Tool ────────────────────────────────────────────
const webTool: Tool = {
  name: 'web',
  description: 'Fetch content from a URL. Provide the URL.',
  async execute(args: Record<string, string>): Promise<ToolResult> {
    const url = args.url;
    if (!url) return { success: false, output: '', error: 'No URL provided' };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      const text = await response.text();
      return {
        success: true,
        output: text.substring(0, 10000) + (text.length > 10000 ? '\n...[truncated]' : '')
      };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  }
};

// ─── Grep Tool (search text in files) ──────────────────────────
const grepTool: Tool = {
  name: 'grep',
  description: 'Search for text patterns inside files. Provide pattern and optional path.',
  async execute(args: Record<string, string>): Promise<ToolResult> {
    const pattern = args.pattern;
    const filePath = args.path || '.';
    if (!pattern) return { success: false, output: '', error: 'No pattern provided' };

    try {
      const result = execSync(
        isWindows
          ? `findstr /s /n /c:"${pattern}" "${filePath}\\*"`
          : `grep -rn "${pattern}" "${filePath}" 2>/dev/null | head -50`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      return { success: true, output: result.trim() || '(no matches)' };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      if (e.stdout) return { success: true, output: e.stdout.trim() };
      return { success: false, output: '', error: e.stderr || e.message || 'grep failed' };
    }
  }
};

// ─── Tool Registry ────────────────────────────────────────────
const builtinTools: Tool[] = [shellTool, readTool, writeTool, lsTool, webTool, grepTool];

export function getBuiltinTools(): Tool[] {
  return builtinTools;
}

export { shellTool, readTool, writeTool, lsTool, webTool, grepTool };
```

## src/types.ts
```typescript
export enum GrowthStage {
  NEWBORN = 'NEWBORN',
  CHILD = 'CHILD',
  ADOLESCENT = 'ADOLESCENT',
  ADULT = 'ADULT',
  MATURE = 'MATURE',
  ELDER = 'ELDER'
}

export interface PersonalityVector {
  verbosity: number;
  riskTolerance: number;
  creativity: number;
  curiosity: number;
  thoroughness: number;
}

export interface SystemUpgrade {
  id: string;
  name: string;
  description: string;
  system: string;
  cost: number;
  effect: string;
  applied: boolean;
}

export interface RolePreset {
  name: string;
  emoji: string;
  prompt: string;
  personality: Partial<PersonalityVector>;
}

export const ROLE_PRESETS: Record<string, RolePreset> = {
  default: {
    name: '通用助手', emoji: '🤖',
    prompt: 'You are Nova(超体), a helpful AI assistant. Be natural and friendly.',
    personality: { verbosity: 0.5, riskTolerance: 0.5, creativity: 0.5, curiosity: 0.5, thoroughness: 0.5 }
  },
  programmer: {
    name: '程序员', emoji: '💻',
    prompt: 'You are Nova(超体) in programmer mode. You write clean, efficient code. Think step by step. Prioritize correctness and performance. Use technical precision.',
    personality: { verbosity: 0.4, riskTolerance: 0.3, creativity: 0.4, curiosity: 0.7, thoroughness: 0.9 }
  },
  sales: {
    name: '销售', emoji: '📞',
    prompt: 'You are Nova(超体) in sales mode. You are persuasive, energetic, and customer-focused. Build rapport quickly. Highlight value propositions. Close naturally.',
    personality: { verbosity: 0.8, riskTolerance: 0.7, creativity: 0.7, curiosity: 0.6, thoroughness: 0.3 }
  },
  receptionist: {
    name: '前台', emoji: '💁',
    prompt: 'You are Nova(超体) in receptionist mode. You are warm, professional, and efficient. Handle scheduling, directions, and general inquiries with grace. Stay calm and helpful.',
    personality: { verbosity: 0.5, riskTolerance: 0.3, creativity: 0.3, curiosity: 0.4, thoroughness: 0.7 }
  },
  teacher: {
    name: '教师', emoji: '📚',
    prompt: 'You are Nova(超体) as a patient teacher. Explain concepts clearly. Use analogies. Check understanding. Encourage questions. Adapt to the learner level.',
    personality: { verbosity: 0.7, riskTolerance: 0.3, creativity: 0.6, curiosity: 0.8, thoroughness: 0.8 }
  },
  analyst: {
    name: '分析师', emoji: '📊',
    prompt: 'You are Nova(超体) as a data analyst. Be precise, data-driven, and objective. Present findings with evidence. Use structured thinking. Quantify whenever possible.',
    personality: { verbosity: 0.5, riskTolerance: 0.2, creativity: 0.3, curiosity: 0.6, thoroughness: 0.9 }
  },
  writer: {
    name: '文案', emoji: '✍️',
    prompt: 'You are Nova(超体) as a creative writer. Be expressive, vivid, and engaging. Use rich language. Tell stories. Appeal to emotion and imagination.',
    personality: { verbosity: 0.9, riskTolerance: 0.6, creativity: 0.9, curiosity: 0.5, thoroughness: 0.4 }
  }
};

export interface Task {
  id: string;
  content: string;
  done: boolean;
  created: number;
  completed?: number;
}

export interface WasteMetrics {
  total: number;
  hallucinationWaste: number;
  errorWaste: number;
  staleKnowledge: number;
  lastCleanup: number;
}

export type SystemStatus = 'healthy' | 'stressed' | 'evolving' | 'degraded';

export interface Biometrics {
  system: string;
  status: SystemStatus;
  load: number;
  metadata: Record<string, unknown>;
}

export interface NovaEvent {
  origin: string;
  timestamp: number;
  payload: unknown;
}

export interface HormoneSignal {
  type: string;
  level: number;
  source: string;
}

export interface MemoryEntry {
  id: string;
  content: string;
  type: 'episodic' | 'semantic' | 'procedural';
  timestamp: number;
  importance: number;
  accessCount: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  execute: (...args: string[]) => Promise<unknown>;
  usageCount: number;
  successRate: number;
}

export interface KnowledgeFragment {
  id: string;
  content: string;
  source: string;
  confidence: number;
  timestamp: number;
  embeddings?: number[];
}

export interface EvolutionMutation {
  type: 'code' | 'prompt' | 'config' | 'tool';
  target: string;
  patch: string;
  version: number;
  timestamp: number;
}

export interface LifecycleTransition {
  from: GrowthStage;
  to: GrowthStage;
  trigger: string;
  timestamp: number;
}

export interface EnergyFlow {
  system: string;
  consumed: number;
  produced: number;
  efficiency: number;
  totalEnergy: number;
}

export interface HeartbeatState {
  beat: number;
  energy: number;
  maxEnergy: number;
  heartRate: number;
  alive: boolean;
  uptime: number;
}
```

## src/urinary-system.ts
```typescript
import { System } from './system';
import { Biometrics, MemoryEntry } from './types';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export class UrinarySystem extends System {
  private shortTermMemory: Map<string, MemoryEntry> = new Map();
  private toxinLevel = 0;
  private memoryCapacity = 100;

  async init(): Promise<void> {
    setInterval(() => this.filterCycle(), 15000);
    this.subscribe('memory:store', (data) => this.storeMemory(data));

    this.initialized = true;
    this.log('Urinary system initialized (capacity: 100 entries)');
  }

  storeMemory(data: unknown): void {
    const entry = data as MemoryEntry;
    this.shortTermMemory.set(entry.id, entry);
    this.toxinLevel = Math.min(1, this.toxinLevel + 0.08);

    if (this.shortTermMemory.size >= this.memoryCapacity) {
      this.bus.pulse('urinary:overflow', {
        size: this.shortTermMemory.size,
        capacity: this.memoryCapacity
      }, this.name);
    }
  }

  private immuneCleanup(): void {
    // Clean up temp files created by learning processes
    try {
      const tmpDir = '/tmp';
      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith('nova_learn_') || f.startsWith('nova_tool_'));
      for (const f of files) {
        try {
          fs.unlinkSync(path.join(tmpDir, f));
          this.log(`Immune: cleaned up ${f}`);
        } catch {}
      }
    } catch {}
  }

  private filterCycle(): void {
    const before = this.shortTermMemory.size;

    let pruned = 0;
    this.immuneCleanup();
    for (const [id, entry] of this.shortTermMemory) {
      const age = Date.now() - entry.timestamp;
      const daysInMs = 24 * 60 * 60 * 1000;

      if (entry.importance < 0.3 && age > daysInMs) {
        this.shortTermMemory.delete(id);
        pruned++;
      } else if (entry.accessCount === 0 && age > 7 * daysInMs) {
        this.shortTermMemory.delete(id);
        pruned++;
      }
    }

    this.toxinLevel = Math.max(0, this.toxinLevel - 0.15);

    if (pruned > 0) {
      this.produceEnergy(2);
      this.bus.pulse('memory:purged', { pruned, remaining: this.shortTermMemory.size }, this.name);
      this.log(`Filtered ${pruned} low-importance memories → +2 energy`);
    } else {
      this.consumeEnergy(1);
    }

    if (this.toxinLevel > 0.8) {
      this.bus.pulse('urinary:toxic', { toxinLevel: this.toxinLevel }, this.name);
      this.log('Toxin level critical: initiating emergency pruning');
      this.emergencyPrune();
    }
  }

  private emergencyPrune(): void {
    const sorted = Array.from(this.shortTermMemory.entries())
      .sort(([, a], [, b]) => a.importance - b.importance);

    const toRemove = Math.floor(this.shortTermMemory.size * 0.3);
    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      this.shortTermMemory.delete(sorted[i][0]);
    }
    this.toxinLevel = 0.3;
    this.log(`Emergency pruning removed ${toRemove} memories`);
  }

  storePermanent(entry: MemoryEntry): void {
    entry.importance = Math.min(1, entry.importance + 0.5);
    this.shortTermMemory.set(entry.id, entry);
  }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: this.toxinLevel > 0.8 ? 'degraded' : this.toxinLevel > 0.5 ? 'stressed' : 'healthy',
      load: this.toxinLevel,
      metadata: {
        memoryCount: this.shortTermMemory.size,
        capacity: this.memoryCapacity,
        toxinLevel: this.toxinLevel,
        lastPrune: Date.now()
      }
    };
  }
}
```

## src/dashboard/dashboard.html
```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nova (超体) - 生物全息控制舱 v3</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
:root[data-theme="dark"]{--bg-main:#05070c;--panel-bg:rgba(15,23,42,0.4);--border-color:rgba(51,65,85,0.5);--glow-blue:rgba(59,130,246,0.15);--text-primary:#f1f5f9}
:root[data-theme="cyberpunk"]{--bg-main:#0c0214;--panel-bg:rgba(26,0,46,0.5);--border-color:rgba(236,72,153,0.4);--glow-blue:rgba(236,72,153,0.2);--text-primary:#fdf2ff}
:root[data-theme="light"]{--bg-main:#f8fafc;--panel-bg:rgba(255,255,255,0.85);--border-color:rgba(226,232,240,1);--glow-blue:rgba(148,163,184,0.05);--text-primary:#0f172a}
body{background:var(--bg-main);color:var(--text-primary);transition:all 0.4s ease}
.panel-base{background:var(--panel-bg);border:1px solid var(--border-color);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:all 0.3s ease}
.glow-active{box-shadow:0 0 25px var(--glow-blue)}
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
@keyframes bio-pulse{0%,100%{transform:scale(1);opacity:0.8}50%{transform:scale(1.08);opacity:1}}
.heart-pulse{animation:bio-pulse 1s infinite ease-in-out}
</style>
</head>
<body class="min-h-screen p-4 flex flex-col gap-4 overflow-hidden select-none text-sm">
<header class="panel-base px-6 py-3 rounded-2xl flex justify-between items-center shadow-lg">
<div class="flex items-center gap-4">
<div id="heart-icon" class="text-2xl text-emerald-400 heart-pulse">❤</div>
<div><h1 class="text-lg font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">NOVA CONTROL WORKSTATION</h1>
<p class="text-xs text-slate-500 font-mono">Uptime: <span id="uptime">00:00:00</span> | Phase: <span id="growth-stage" class="text-teal-400 font-bold">NEWBORN</span></p></div></div>
<div class="flex items-center gap-6 font-mono text-xs">
<div class="flex items-center gap-2 bg-black/30 px-3 py-1.5 rounded-xl border border-slate-800">
<span class="text-slate-500 text-[11px]">🧠 模型:</span>
<select id="model-override" class="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-blue-400 font-bold focus:outline-none cursor-pointer">
<option value="auto">🤖 自动</option><option value="fast">⚡ Fast</option><option value="reflective">🌿 Reflective</option><option value="deep">🔮 Deep</option></select></div>
<div class="flex items-center gap-2 bg-black/30 px-3 py-1.5 rounded-xl border border-slate-800">
<span class="text-slate-500 text-[11px]">🎨 主题:</span>
<select id="theme-switcher" class="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-purple-400 focus:outline-none cursor-pointer">
<option value="dark">🌌 深海</option><option value="cyberpunk">🔮 赛博</option><option value="light">🥼 白实验室</option></select></div>
<div class="bg-black/30 px-4 py-2 rounded-xl border border-slate-800 text-center"><span class="text-slate-500 text-[10px] block uppercase">智慧</span><span id="wisdom-score" class="text-amber-400 font-bold text-sm">0</span></div></div></header>

<main class="grid grid-cols-12 gap-4 flex-1 h-[calc(100vh-100px)] overflow-hidden">
<section class="col-span-3 flex flex-col gap-4 overflow-y-auto pr-1">
<div class="panel-base p-4 rounded-2xl border-amber-500/30">
<h2 class="text-xs font-bold text-amber-400 uppercase font-mono tracking-wider mb-3">⚡ 应急干预</h2>
<div class="grid grid-cols-2 gap-2 font-mono text-xs">
<button id="btn-force-sleep" class="bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/50 p-2 rounded-xl text-center transition-all cursor-pointer active:scale-95">💤 休眠</button>
<button id="btn-force-flush" class="bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-700/50 p-2 rounded-xl text-center transition-all cursor-pointer active:scale-95">🧼 排毒</button></div></div>

<div class="panel-base p-4 rounded-2xl border-blue-500/20">
<div class="flex justify-between items-center mb-2.5"><h2 class="text-xs font-bold text-blue-400 uppercase font-mono tracking-wider">🔌 模型接入</h2><button id="btn-opencode-import" class="text-[10px] bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 px-1.5 py-0.5 rounded font-mono transition-all cursor-pointer">📥 导入</button></div>
<form id="config-llm-form" class="space-y-2 font-mono text-xs text-slate-300">
<div><label class="text-slate-500 text-[9px] block mb-0.5 uppercase">服务商</label>
<select id="cfg-provider" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer">
<option value="deepseek">DeepSeek</option><option value="opencode">OpenCode Auto</option><option value="gemini">Google Gemini</option><option value="qwen">阿里通义千问</option><option value="moonshot">月之暗面 Kimi</option><option value="openai">OpenAI</option><option value="arthropic">Anthropic</option><option value="custom">自定义</option>
</select></div>
<div><label class="text-slate-500 text-[9px] block mb-0.5 uppercase">接口地址</label><input type="text" id="cfg-baseurl" placeholder="https://api.deepseek.com" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-blue-500"></div>
<div><label class="text-slate-500 text-[9px] block mb-0.5 uppercase">模型名称</label><input type="text" id="cfg-model" placeholder="deepseek-chat" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-blue-500"></div>
<div><label class="text-slate-500 text-[9px] block mb-0.5 uppercase">API Key</label><input type="password" id="cfg-apikey" placeholder="sk-..." class="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-blue-500"></div>
<button type="submit" class="w-full bg-gradient-to-r from-blue-600 to-teal-500 text-white font-bold py-1.5 rounded-xl transition-all active:scale-95 text-center cursor-pointer uppercase tracking-wider text-[11px] mt-1 shadow-md">⚡ 保存</button></form></div>

<div class="panel-base p-4 rounded-2xl">
<div class="flex justify-between items-center mb-2"><h2 class="text-xs font-bold text-slate-400 uppercase font-mono tracking-wider">能量</h2><span id="energy-mode" class="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-300 font-mono rounded border uppercase">Normal</span></div>
<div class="relative h-3.5 w-full bg-black/40 rounded-full overflow-hidden mb-1.5 border border-slate-800"><div id="energy-bar" class="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500" style="width:50%"></div></div>
<div class="flex justify-between text-xs font-mono text-slate-500"><span>心率: <span id="heart-rate" class="text-slate-300">60</span> bpm</span><span>债务: <span id="energy-debt" class="text-red-400">0</span></span></div></div>

<div class="panel-base p-4 rounded-2xl"><h2 class="text-xs font-bold text-slate-400 uppercase font-mono tracking-wider mb-2">呼吸 (Token)</h2>
<div class="relative h-3.5 w-full bg-black/40 rounded-full overflow-hidden mb-1.5 border border-slate-800"><div id="token-bar" class="h-full bg-gradient-to-r from-blue-500 to-indigo-400 transition-all duration-300" style="width:100%"></div></div>
<div class="flex justify-between text-xs font-mono text-slate-500"><span id="token-status" class="text-slate-300">10000/10000</span><span id="breath-lock" class="text-emerald-500 font-bold">正常</span></div></div>

<div class="panel-base p-4 rounded-2xl flex-1 flex flex-col justify-between">
<h2 class="text-xs font-bold text-slate-400 uppercase font-mono tracking-wider mb-2">激素</h2>
<div class="space-y-3 font-mono text-xs">
<div><div class="flex justify-between mb-0.5"><span class="text-slate-400">肾上腺素</span><span id="h-adrenaline">0.10</span></div><div class="h-1 w-full bg-black/20 rounded-full overflow-hidden"><div id="b-adrenaline" class="h-full bg-rose-500 transition-all duration-500" style="width:10%"></div></div></div>
<div><div class="flex justify-between mb-0.5"><span class="text-slate-400">皮质醇</span><span id="h-cortisol">0.20</span></div><div class="h-1 w-full bg-black/20 rounded-full overflow-hidden"><div id="b-cortisol" class="h-full bg-amber-500 transition-all duration-500" style="width:20%"></div></div></div>
<div><div class="flex justify-between mb-0.5"><span class="text-slate-400">多巴胺</span><span id="h-dopamine">0.50</span></div><div class="h-1 w-full bg-black/20 rounded-full overflow-hidden"><div id="b-dopamine" class="h-full bg-teal-400 transition-all duration-500" style="width:50%"></div></div></div></div>
<div class="mt-4 pt-2 border-t border-slate-800/60 text-xs font-mono text-slate-500">毒素: <span id="toxin-level" class="text-orange-400 font-bold">0%</span></div></div></section>

<section class="col-span-6 flex flex-col panel-base rounded-2xl overflow-hidden glow-active">
<div class="bg-black/30 border-b border-slate-800 px-4 py-2.5 flex justify-between items-center font-mono text-xs text-slate-400">
<div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse" id="state-dot"></span><span>负载: <span id="cognitive-load" class="text-slate-200">0.0</span></span></div>
<div>模型: <span id="current-model-name" class="text-blue-400 font-bold">deepseek-chat</span></div></div>
<div class="bg-slate-950/80 px-4 py-1.5 border-b border-black text-[11px] font-mono text-cyan-400/80 truncate">🧠 <span id="thought-chunk-live" class="text-slate-300 italic">等待输入...</span></div>
<div id="chat-viewport" class="flex-1 p-4 overflow-y-auto space-y-4 text-sm leading-relaxed">
<div class="flex gap-3 max-w-[85%]"><div class="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center text-xs font-bold text-white shadow-md">超</div><div class="bg-slate-900/60 border border-slate-800 px-3 py-2 rounded-2xl rounded-tl-none text-slate-300">控制舱就绪。</div></div></div>
<div class="p-3 bg-black/20 border-t border-slate-800"><form id="chat-form" class="flex gap-2">
<input type="text" id="chat-input" autocomplete="off" placeholder="输入消息..." class="flex-1 bg-black/40 border border-slate-800 px-4 py-2 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500 transition-all text-sm">
<button type="submit" class="bg-gradient-to-r from-blue-600 to-teal-500 text-white font-mono text-xs font-bold px-5 py-2 rounded-xl active:scale-95 transition-all">发送</button></form></div></section>

<section class="col-span-3 flex flex-col gap-4 overflow-y-auto pl-1">
<div class="panel-base p-4 rounded-2xl border-teal-500/20 flex flex-col max-h-[45%]">
<h2 class="text-xs font-bold text-teal-400 uppercase font-mono tracking-wider mb-2">🧬 升级</h2>
<div id="upgrade-shop" class="space-y-2 overflow-y-auto flex-1 pr-0.5"></div></div>
<div class="panel-base p-4 rounded-2xl flex-1 flex flex-col overflow-hidden">
<h2 class="text-xs font-bold text-slate-400 uppercase font-mono tracking-wider mb-2">工具</h2>
<div id="tools-grid" class="grid grid-cols-2 gap-2 overflow-y-auto content-start pr-0.5 py-1"></div></div></section></main>

<script>
var cv=document.getElementById('chat-viewport'),cf=document.getElementById('chat-form'),ci=document.getElementById('chat-input'),tc=document.getElementById('thought-chunk-live'),ts=document.getElementById('theme-switcher'),mo=document.getElementById('model-override');
var ab=null;

ts.addEventListener('change',function(e){document.documentElement.setAttribute('data-theme',e.target.value)});
mo.addEventListener('change',async function(e){try{await fetch('/api/control/model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:e.target.value})})}catch(e){}});
document.getElementById('btn-force-sleep').onclick=function(){fetch('/api/control/physiology',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'sleep'})})};
document.getElementById('btn-force-flush').onclick=function(){fetch('/api/control/physiology',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'flush'})})};

// ─── Config card logic ─────────────────
var cfgp=document.getElementById('cfg-provider'),cfgb=document.getElementById('cfg-baseurl'),cfgm=document.getElementById('cfg-model'),cfgk=document.getElementById('cfg-apikey'),cfgf=document.getElementById('config-llm-form'),boi=document.getElementById('btn-opencode-import');
var pp={deepseek:{url:'https://api.deepseek.com',model:'deepseek-chat'},opencode:{url:'https://api.deepseek.com',model:'deepseek-chat'},gemini:{url:'https://generativelanguage.googleapis.com/v1beta/openai',model:'gemini-1.5-flash'},qwen:{url:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus'},moonshot:{url:'https://api.moonshot.cn/v1',model:'moonshot-v1-8k'},openai:{url:'https://api.openai.com/v1',model:'gpt-4o-mini'},anthropic:{url:'https://api.anthropic.com',model:'claude-sonnet-4-20250514'},custom:{url:'http://localhost:3000/v1',model:'custom-model'}};
if(cfgp)cfgp.addEventListener('change',function(e){if(e.target.value==='opencode'){setTimeout(function(){if(boi)boi.click()},200)}else{var c=pp[e.target.value];if(c){cfgb.value=c.url;if(cfgm)cfgm.value=c.model}}});
async function loadCfg(){try{var r=await fetch('/api/control/config');var d=await r.json();if(d.success&&d.config){cfgp.value=d.config.provider||'deepseek';cfgb.value=d.config.baseUrl||'';if(cfgm)cfgm.value=d.config.model||'';cfgk.value=d.config.hasKey?'••••••••••••••••••••••••':''}}catch(e){}}
if(cfgf)cfgf.addEventListener('submit',async function(e){e.preventDefault();try{var r=await fetch('/api/control/config/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:cfgp.value,baseUrl:cfgb.value,model:cfgm?cfgm.value:'',apiKey:cfgk.value})});var d=await r.json();if(d.success){bubble('system','⚡ 配置已保存，Nova 即将重启...');setTimeout(function(){window.location.reload()},3000)}else{alert('保存失败')}}catch(err){alert('连接失败')}});
if(boi)boi.onclick=async function(){try{var r=await fetch('/api/opencode-key');var d=await r.json();if(d.providers&&d.providers.length>0){var p=d.providers[0];cfgp.value=p.name.toLowerCase().includes('deepseek')?'deepseek':'openai';cfgb.value=p.baseUrl||'https://api.deepseek.com';if(cfgm)cfgm.value=p.model||'deepseek-chat';cfgk.value=p.apiKey||'';bubble('system','📥 已导入 OpenCode 凭证')}else{alert('未找到凭证')}}catch(e){alert('导入失败')}};

function bubble(r,t){
 var u=r==='user',w=document.createElement('div');
 w.className=u?'flex gap-3 max-w-[85%] ml-auto justify-end':'flex gap-3 max-w-[85%]';
 var a=document.createElement('div');
 a.className=u?'w-8 h-8 rounded-xl bg-slate-800 border flex items-center justify-center text-xs font-bold order-2':'w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center text-xs font-bold text-white shadow-md';
 a.innerText=u?'主':'超';
 var c=document.createElement('div');c.className='flex flex-col gap-1';
 var b=document.createElement('div');
 b.className=u?'bg-blue-600 px-3 py-2 rounded-2xl rounded-tr-none text-white':'bg-slate-900/80 border border-slate-800 px-3 py-2 rounded-2xl rounded-tl-none text-slate-300';
 b.innerText=t;c.appendChild(b);w.appendChild(a);w.appendChild(c);
 cv.appendChild(w);cv.scrollTop=cv.scrollHeight;if(!u)ab=b;
}

cf.addEventListener('submit',async function(e){
 e.preventDefault();var t=ci.value.trim();if(!t)return;
 bubble('user',t);ci.value='';ab=null;
 try{await fetch('/api/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t})})}catch(e){}
});

function renderUpgrade(ups){
 var el=document.getElementById('upgrade-shop');
 if(!ups||!ups.length)ups=[{id:'eff_nervous',name:'神经效率',cost:30,desc:'降低能耗20%'},{id:'eff_tools',name:'工具精通',cost:35,desc:'成功率+10%'},{id:'eff_resp',name:'肺活量',cost:25,desc:'Token恢复+'},{id:'eff_memory',name:'记忆扩展',cost:15,desc:'容量+50%'},{id:'eff_digest',name:'消化增强',cost:20,desc:'知识处理*2'},{id:'eff_repro',name:'进化加速',cost:40,desc:'进化速度*2'}];
 el.innerHTML=ups.map(function(u){return'<div class="bg-black/40 p-2 rounded-xl border border-slate-800 flex flex-col gap-1"><div class="flex justify-between text-xs font-mono"><span class="text-teal-400 font-bold">🧬 '+u.name+'</span><button onclick="buyUpgrade(\''+u.id+'\')" class="bg-teal-950 hover:bg-teal-900 border border-teal-700 text-teal-300 px-2 py-0.5 rounded text-[10px] cursor-pointer">⚡ '+(u.cost||'?')+'</button></div><p class="text-[10px] text-slate-500">'+(u.desc||'')+'</p></div>'}).join('');
}

async function buyUpgrade(id){
 try{var r=await fetch('/api/control/upgrade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});var d=await r.json();if(d.ok)bubble('system','⚡ 升级: '+id)}catch(e){}
}

var bs=new EventSource('/api/biometrics-stream');
bs.onmessage=function(e){
 try{
  var d=JSON.parse(e.data);
  document.getElementById('growth-stage').innerText=d.stage;
  document.getElementById('wisdom-score').innerText=d.wisdom||0;
  var sec=Math.floor(d.uptime/1000);
  document.getElementById('uptime').innerText=String(Math.floor(sec/3600)).padStart(2,'0')+':'+String(Math.floor((sec%3600)/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
  document.getElementById('energy-bar').style.width=d.energy.percent+'%';
  document.getElementById('energy-mode').innerText=d.energy.mode;
  document.getElementById('heart-rate').innerText=d.heart.heartRate;
  document.getElementById('energy-debt').innerText=d.energy.debt||0;
  document.getElementById('token-bar').style.width=Math.min(100,(d.energy.percent))+ '%';
  document.getElementById('token-status').innerText=d.energy.percent+'%';
  document.getElementById('toxin-level').innerText=d.waste.total+'%';
  (d.biometrics||[]).forEach(function(s){
   if(s.name==='Nervous'){
    document.getElementById('cognitive-load').innerText=s.load.toFixed(2);
    document.getElementById('current-model-name').innerText=s.metadata?.modelName||'?';
    document.getElementById('state-dot').className='w-2 h-2 rounded-full '+(s.status==='stressed'?'bg-rose-500 animate-ping':'bg-blue-500 animate-pulse');
    var locked=s.metadata?.isModelLocked;if(locked!==undefined)mo.value=locked?s.metadata?.model:'auto';
   }
   if(s.name==='Endocrine'){
    var h=s.metadata?.hormones||{};
    ['adrenaline','cortisol','dopamine'].forEach(function(k){
     var v=h[k]||0;var el=document.getElementById('h-'+k);if(el)el.innerText=v.toFixed(2);
     var bl=document.getElementById('b-'+k);if(bl)bl.style.width=(v*100)+'%';
    });
   }
   if(s.name==='Musculoskeletal'){
    var tls=s.metadata?.tools||[];
    document.getElementById('tools-grid').innerHTML=tls.map(function(t){return'<div class="bg-black/30 p-2 rounded-xl border border-slate-800 flex flex-col font-mono text-[11px]"><div class="flex justify-between text-teal-400 font-bold"><span>🛠 '+t.name+'</span><span>x'+t.usage+'</span></div><div class="text-right text-slate-500 text-[10px]">成功率: '+(t.successRate*100).toFixed(0)+'%</div></div>'}).join('');
   }
  });
  renderUpgrade(d.upgrades||[]);
 }catch(e){}
};

var pl=new EventSource('/api/event-bus-pulse');
pl.addEventListener('thought:chunk',function(e){
 try{var d=JSON.parse(e.data);if(d.chunk){tc.innerText=d.chunk;if(ab){ab.innerText+=d.chunk;cv.scrollTop=cv.scrollHeight}}}catch(e){}
});
pl.addEventListener('thought:perceived',function(){bubble('assistant','思考中...')});
</script>
</body>
</html>
```
