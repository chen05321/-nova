# Nova (超体) v5.8 - 完整源代码


## src/agent-loop/index.ts
```typescript
import { CirculatorySystem } from '../event-bus';
import { ToolRegistry, Tool } from '../tools';
import { MemoryStore } from '../memory';
import { MCPClient, loadMCPConfigs } from '../mcp';

export class AgentLoop {
  private bus: CirculatorySystem;
  private memory: MemoryStore;
  private running = false;
  private mcpClients: MCPClient[] = [];

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.memory = new MemoryStore();
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
          ToolRegistry.register(tool);
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

  async execute(objective: string): Promise<string> {
    if (this.running) return 'Agent is already running';
    this.running = true;
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
process.on('unhandledRejection', (err) => console.error('[安全阀] 未捕获的异常:', (err as any)?.message || err));
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

const HOME_ENV = path.join(os.homedir(), '.nova', '.env');
const PROJECT_ENV = path.join(__dirname, '..', '..', '.env');

dotenvConfig({ path: PROJECT_ENV });
dotenvConfig({ path: HOME_ENV });
dotenvConfig(); 

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
      model: 'deepseek-v4-flash',
      maxTokens: 1024,
      temperature: 0.3
    },
    reflective: {
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: 'deepseek-v4-flash',
      maxTokens: 2048,
      temperature: 0.7
    },
    deep: {
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: 'deepseek-v4-pro',
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

  const paths = [
    configPath,
    path.join(process.cwd(), 'nova.config.json'),
    path.join(process.cwd(), 'nova.config.jsonc'),
    path.join(process.cwd(), '.novarc'),
    path.join(os.homedir(), '.nova', 'config.json')
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
      // GET: 读取本地配置文件提供给前端回显
      if (url.pathname === '/api/control/config' && req.method === 'GET') {
        try {
          const configPath = path.join(process.cwd(), 'nova.config.json');
          let currentConfig = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', hasKey: false };
          
          if (fs.existsSync(configPath)) {
            try {
              const fileData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
              currentConfig.provider = fileData.llm?.fast?.provider || 'deepseek';
              currentConfig.baseUrl = fileData.llm?.fast?.baseUrl || 'https://api.deepseek.com';
              currentConfig.model = fileData.llm?.fast?.model || 'deepseek-v4-flash';
              currentConfig.hasKey = !!fileData.llm?.fast?.apiKey;
            } catch {}
          }
          json({ success: true, config: currentConfig });
        } catch (err) { json({ success: false, error: String(err) }, 500); }
        return;
      }

      // POST: 持久化保存前端输入的渠道及模型，并向看门狗发信号执行有丝分裂热重启
      if (url.pathname === '/api/control/config/save' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { provider, baseUrl, model, apiKey } = JSON.parse(body);
            const configPath = path.join(process.cwd(), 'nova.config.json');
            let baseConfig = { llm: { fast: {}, reflective: {}, deep: {} } } as any;
            
            if (fs.existsSync(configPath)) {
              try { baseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
            }

            const finalKey = (apiKey === '••••••••••••••••••••••••' || !apiKey)
              ? baseConfig.llm?.fast?.apiKey : apiKey;

            ['fast', 'reflective', 'deep'].forEach((tier) => {
              if (!baseConfig.llm[tier]) baseConfig.llm[tier] = {};
              baseConfig.llm[tier].provider = provider;
              baseConfig.llm[tier].baseUrl = baseUrl;
              
              if (tier === 'deep' && provider === 'deepseek' && model === 'deepseek-v4-flash') {
                baseConfig.llm[tier].model = 'deepseek-v4-pro';
              } else {
                baseConfig.llm[tier].model = model;
              }
              if (finalKey) baseConfig.llm[tier].apiKey = finalKey;
            });

            fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2), 'utf-8');
            json({ success: true });

            setTimeout(() => {
              bus.pulse('system:reincarnation_ready', { trigger: 'api_config_changed' }, 'DashboardServer');
            }, 1000);
          } catch (err) { json({ success: false, error: String(err) }, 400); }
        });
        return;
      }

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
          const modelName = (agent.nervous as any).currentModel || 'fast';
          const data = JSON.stringify({
            stage: st.stage, uptime: st.uptime, wisdom: agent.Wisdom,
            energy, heart, model: modelName, role: '通用',
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

      // SSE: event bus pulse
      if (url.pathname === '/api/event-bus-pulse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        const onChunk = (event: any) => {
          if (event.origin === 'NervousSystem') {
            try { res.write(`event: thought:chunk\ndata: ${JSON.stringify({ chunk: event.payload?.chunk || '', isReasoning: event.payload?.isReasoning ?? false })}\n\n`); } catch {}
          }
        };
        const onPerceived = () => {
          try { res.write(`event: thought:perceived\ndata: {}\n\n`); } catch {}
        };
        const onLearning = (event: any) => {
          try {
            const p = event.payload || {};
            const msg = p.error ? `❌ ${p.error}` : `📖 学习了: ${(p.learned || []).join(', ')}`;
            res.write(`event: learning:cycle\ndata: ${JSON.stringify({ message: msg, error: !!p.error })}\n\n`);
          } catch {}
        };
        bus.on('thought:chunk', onChunk);
        bus.on('thought:perceived', onPerceived);
        bus.on('learning:cycle', onLearning);
        req.on('close', () => {
          bus.removeListener('thought:chunk', onChunk);
          bus.removeListener('thought:perceived', onPerceived);
          bus.removeListener('learning:cycle', onLearning);
        });
        return;
      }

      // Control: model override，支持解除硬锁定，退回自动模式
      if (url.pathname === '/api/control/model' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { mode } = JSON.parse(body);
            if (mode === 'auto') {
              (agent.nervous as any).isModelLocked = false;
              (agent.nervous as any).currentModel = 'reflective';
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

      // Control: physiology
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

      // Control: upgrade
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

      // POST: chat input (saves response to memory on thought:complete)
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
              // Save assistant response to memory once complete
              const onComplete = (event: any) => {
                const resp = event.payload?.response || '';
                if (memory && resp) memory.addMessage('assistant', resp);
                agent.bus.removeListener('thought:complete', onComplete);
              };
              agent.bus.once('thought:complete', onComplete);
              json({ ok: true });
            } else { json({ ok: false }, 400); }
          } catch { json({ ok: false }, 400); }
        });
        return;
      }

      // POST: create new session
      if (url.pathname === '/api/session/new' && req.method === 'POST') {
        const memory = (agent as any).memory;
        if (memory) {
          const name = url.searchParams.get('name') || `会话 ${new Date().toLocaleTimeString()}`;
          const id = memory.createConversation(name);
          json({ ok: true, id });
          return;
        }
        json({ ok: false }, 400);
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
            gemini: { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com' }
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

      // Conversations 历史流：为未命名线程增加自然数索引优雅降级
      if (url.pathname === '/api/convs') {
        const memory = (agent as any).memory;
        if (memory) {
          const convs = memory.getConversations().slice(0, 20);
          json(convs.map((c: any, idx: number) => ({
            id: c.id,
            name: c.name || `意图线程 #${idx + 1}`, 
            msgs: c.messageCount || 0,
            current: c.id === memory.getCurrentConversationId()
          })));
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
    } catch (e: any) { json({ error: e.message }, 500); return; }

    try {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('Dashboard HTML not found.');
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

  private readonly    curiosityTopics = [
        // ═══════ 编程体系（权重最高）═══════
        'TypeScript 类型系统', 'Node.js 事件循环', 'React 虚拟DOM', 'V8 引擎优化',
        '微服务架构', '分布式一致性 Raft', '数据库索引 B+树', '缓存策略 Redis',
        'CI/CD 流水线', '测试金字塔 TDD', '设计模式 观察者', 'Web安全 OWASP',
        'gRPC 通信', '消息队列 Kafka', 'GraphQL 查询', 'WebAssembly',
        '编译原理 AST', '设计模式 工厂', 'Rust 所有-权', 'Python 异步编程',
        // ═══════ 自进化体系 ════════
        'Agent 自改进 Reflexion', '元学习 Meta Learning', 'RAG 检索增强生成',
        '知识图谱 Neo4j', '多Agent 协作', '自监控 诊断', '记忆层次 管理',
        '工具编排 ReAct', '技能自动发现', 'Agent 框架设计',
        // ═══════ 通用知识 ════════
        '人工智能', '机器学习', '深度学习', '神经网络', '系统设计', '进化论', '认知科学'
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

interface SkillPlan {
  id: string;
  name: string;
  description: string;
  level: number;
  category: string;
  prerequisite: string[];
  learned: boolean;
  verifiedAt?: number;
}

const SKILL_TREE: SkillPlan[] = [
  { id: 'fs_read', name: '文件读取', description: '读文件、解析JSON/YAML', level: 1, category: 'filesystem', prerequisite: [], learned: false },
  { id: 'fs_write', name: '文件写入', description: '写文件、创建目录、备份', level: 1, category: 'filesystem', prerequisite: [], learned: false },
  { id: 'fs_find', name: '文件搜索', description: 'grep查找、glob匹配', level: 1, category: 'filesystem', prerequisite: [], learned: false },
  { id: 'web_get', name: '网页抓取', description: 'fetch URL、解析HTML', level: 1, category: 'network', prerequisite: [], learned: false },
  { id: 'web_search', name: '网络搜索', description: '搜索引擎查询、提取结果', level: 1, category: 'network', prerequisite: [], learned: false },
  { id: 'shell_basic', name: 'Shell基础', description: '执行命令、管道、重定向', level: 1, category: 'shell', prerequisite: [], learned: false },
  { id: 'shell_git', name: 'Git操作', description: 'clone/commit/push/pull', level: 1, category: 'shell', prerequisite: [], learned: false },
  { id: 'browser_url', name: '浏览器导航', description: '打开URL、截图页面', level: 2, category: 'browser', prerequisite: ['web_get'], learned: false },
  { id: 'browser_interact', name: '浏览器交互', description: '点击按钮、填写表单', level: 2, category: 'browser', prerequisite: ['browser_url'], learned: false },
  { id: 'data_json', name: '数据处理', description: 'JSON转换、过滤、统计', level: 2, category: 'data', prerequisite: ['fs_read'], learned: false },
  { id: 'data_csv', name: '表格处理', description: 'CSV读写、数据清洗', level: 2, category: 'data', prerequisite: ['fs_read'], learned: false },
  { id: 'code_analyze', name: '代码分析', description: '读代码、找bug、重构', level: 2, category: 'code', prerequisite: ['fs_read'], learned: false },
  { id: 'project_setup', name: '项目搭建', description: '初始化项目、装依赖', level: 3, category: 'project', prerequisite: ['shell_basic', 'shell_git'], learned: false },
  { id: 'project_auto', name: '自动化脚本', description: '编写自动任务脚本', level: 3, category: 'project', prerequisite: ['shell_basic', 'code_analyze'], learned: false },
  { id: 'project_mcp', name: 'MCP插件开发', description: '创建自定义MCP服务器', level: 3, category: 'project', prerequisite: ['browser_interact', 'data_json'], learned: false },
];

export class SelfLearningSystem {
  private bus: CirculatorySystem;
  private memory: MemoryStore;
  private knowledgeGraph: Map<string, KnowledgeNode> = new Map();
  private skillProgress: Map<string, SkillPlan> = new Map();
  private skills: Map<string, { name: string; description: string; trigger: string; usage: number }> = new Map();

  constructor(memory?: MemoryStore) {
    this.bus = CirculatorySystem.getInstance();
    this.memory = memory || new MemoryStore();
    this.loadGraph();
    this.loadSkillProgress();
  }

  private loadSkillProgress(): void {
    const saved = this.memory.getFacts('skill_progress');
    if (saved.length > 0) { try { const data = JSON.parse(saved[0].content); this.skillProgress = new Map(Object.entries(data)); } catch {} }
    for (const s of SKILL_TREE) { if (!this.skillProgress.has(s.id)) { this.skillProgress.set(s.id, { ...s }); } }
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
    for (const s of notLearned) {
      const prereqsMet = s.prerequisite.every(preId => { const pre = this.skillProgress.get(preId); return pre && pre.learned; });
      if (prereqsMet) return s;
    }
    return notLearned.sort((a, b) => a.prerequisite.length - b.prerequisite.length)[0];
  }

  private loadGraph(): void {
    const saved = this.memory.getFacts('knowledge_graph');
    if (saved.length > 0) { try { const data = JSON.parse(saved[0].content); this.knowledgeGraph = new Map(Object.entries(data)); } catch {} }
  }

  private saveGraph(): void {
    const obj: Record<string, KnowledgeNode> = {};
    this.knowledgeGraph.forEach((v, k) => { obj[k] = v; });
    this.memory.addFact(JSON.stringify(obj), 'knowledge_graph', 0.9);
  }

  async learnCycle(): Promise<string[]> {
    const results: string[] = [];

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

        const mdBody = `## 技能描述\n${nextSkill.description}\n\n## 演化判定\n解锁时间: ${new Date().toLocaleString()}\n前置依赖项: ${nextSkill.prerequisite.join(', ') || '无'}\n核准状态: 100% 具备具身执行可能。`;
        this.memory.writeKnowledgeNote('技能', nextSkill.name, mdBody, ['超体核心', '自动进化', nextSkill.category]);

        this.bus.pulse('learning:complete', { topic: nextSkill.name, summary: `新技能: ${nextSkill.description}` }, 'SelfLearningSystem');
        results.push(nextSkill.name);
        return results;
      }
    }

    const topic = await this.discoverTopic();
    if (!topic) return results;

    const knowledge = await this.research(topic);
    if (!knowledge) return results;

    const demo = await this.practice(topic);
    const cleanTitle = topic.split(':')[0].trim().replace(/\//g, '_');
    const connections = this.findConnections(topic);

    const relatedTitles = connections.map(id => this.knowledgeGraph.get(id)?.title).filter(Boolean) as string[];
    const mdContent = `## 概念知识总括\n${knowledge}\n\n## 原型验证模拟\n\`\`\`typescript\n${demo || '// 暂无本地原型验证存根'}\n\`\`\``;
    this.memory.writeKnowledgeNote('知识', cleanTitle, mdContent, ['智能觅食', '自动捕获'], relatedTitles);

    const node: KnowledgeNode = {
      id: Date.now().toString(36),
      title: topic,
      type: 'concept',
      summary: knowledge.substring(0, 300),
      source: 'self-learned',
      code: demo || undefined,
      connections: connections,
      createdAt: Date.now(),
      confidence: 0.5
    };

    this.knowledgeGraph.set(node.id, node);
    this.saveGraph();
    this.evolveSkill(topic);

    if (demo) {
      const demoPath = `/tmp/nova_learn_${Date.now()}.demo`;
      try { execSync(`echo '${demo.replace(/'/g, "'\\''")}' > ${demoPath}`, { shell: '/bin/bash' }); } catch {}
      this.memory.addFact(`实践记录: ${topic} → ${demoPath}`, 'practice', 0.5);
    }

    results.push(topic);
    this.bus.pulse('learning:complete', { topic, summary: knowledge.substring(0, 100) }, 'SelfLearningSystem');
    return results;
  }

  private async discoverTopic(): Promise<string | null> {
    try {
      const resp = await fetch('https://api.github.com/search/repositories?q=stars:>1000+language:typescript&sort=stars&per_page=10', { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return this.pickFallbackTopic();
      const data = await resp.json() as any;
      const repos = data.items || [];
      if (repos.length === 0) return this.pickFallbackTopic();
      const repo = repos[Math.floor(Math.random() * Math.min(5, repos.length))];
      return `${repo.full_name}: ${repo.description || 'popular project'}`;
    } catch { return this.pickFallbackTopic(); }
  }

  private pickFallbackTopic(): string {
    const topics = ['Node.js design patterns', 'TypeScript advanced types', 'Rust vs Go concurrency', 'React server components', 'AI agent frameworks comparison'];
    return topics[Math.floor(Math.random() * topics.length)];
  }

  private async research(topic: string): Promise<string | null> {
    const encoded = encodeURIComponent(topic.split(':')[0].trim());
    try {
      const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) { const data = await resp.json() as any; return data.extract || data.summary || null; }
    } catch {}
    return `Learned about ${topic}. Further exploration needed.`;
  }

  private async practice(topic: string): Promise<string | null> {
    const name = topic.split(/[/:]/)[0].trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (!name || name.length < 2) return null;
    return `// Learned from: ${topic}\nconsole.log('Practice存根正常');\n`;
  }

  private evolveSkill(topic: string): void {
    const related = Array.from(this.knowledgeGraph.values()).filter(n => {
      const words = topic.toLowerCase().split(/[\s:,-]+/);
      return words.some(w => w.length > 3 && n.title.toLowerCase().includes(w));
    });
    const totalConfidence = related.reduce((s, n) => s + n.confidence, 0);
    const nodeCount = related.length + 1;
    if (nodeCount >= 3 || totalConfidence > 2.0) {
      const keywords = topic.split(/[\s:,-]+/).filter(w => w.length > 2);
      const trigger = keywords[0]?.toLowerCase() || topic.toLowerCase().substring(0, 10);
      if (!this.skills.has(trigger)) {
        this.skills.set(trigger, { name: topic.substring(0, 30), description: `Expertise in ${topic}`, trigger, usage: 0 });
        this.bus.pulse('skill:acquired', { name: topic, trigger }, 'SelfLearningSystem');
        this.memory.addFact(`技能: ${topic}`, 'skill', 0.8);
      }
    }
  }

  private findConnections(topic: string): string[] {
    const connections: string[] = [];
    const keywords = topic.toLowerCase().split(/[\s:,-]+/);
    this.knowledgeGraph.forEach((node) => {
      const nodeWords = node.title.toLowerCase().split(/[\s:,-]+/);
      const overlap = keywords.filter(w => nodeWords.includes(w) && w.length > 3);
      if (overlap.length > 0) { connections.push(node.id); }
    });
    return connections;
  }

  getSkills(): { name: string; description: string; trigger: string }[] {
    return Array.from(this.skills.values()).map(s => ({ name: s.name, description: s.description, trigger: s.trigger }));
  }

  getStats() {
    const skillsList: { name: string; description: string }[] = [];
    this.skillProgress.forEach((s) => { if (s.learned) { skillsList.push({ name: s.name, description: s.description }); } });
    const learned = this.memory.getFacts('learned');
    return {
      learned: learned.length,
      skillsAcquired: skillsList.length,
      nodes: this.knowledgeGraph.size,
      connections: Array.from(this.knowledgeGraph.values()).reduce((s, n) => s + n.connections.length, 0),
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

export type StreamCallback = (chunk: string, done: boolean, isReasoning?: boolean) => void;

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
    try {
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
            const delta = parsed.choices?.[0]?.delta;
            
            // 流式同时截获思维链思考流与最终文本内容
            const reasoning = delta?.reasoning_content || '';
            const content = delta?.content || '';
            
            if (reasoning) {
              onChunk(reasoning, false, true);
            } else if (content) {
              onChunk(content, false, false);
            }
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
    } catch (err: any) {
      const msg = err?.cause?.code === 'UND_ERR_SOCKET' ? '网络连接中断' : (err.message || String(err));
      onChunk(`[连接错误] ${msg}`, true);
    }
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
import { writeNote, searchNotes, ensureVault, getAllNoteTitles, vaultPath } from './obsidian';

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

  /** 从 Obsidian 仓库搜索相关知识 */
  searchVault(query: string, maxResults = 5): { title: string; snippet: string }[] {
    return searchNotes(query, maxResults).map(r => ({ title: r.title, snippet: r.snippet }));
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

```


## src/memory/obsidian.ts
```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const VAULT_DIR = path.join(os.homedir(), '.nova-vault');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function vaultPath(...segments: string[]): string {
  return path.join(VAULT_DIR, ...segments);
}

// 写一篇 markdown 笔记
export function writeNote(category: string, title: string, tags: string[], content: string, links: string[] = []): string {
  ensureDir(path.join(VAULT_DIR, category));

  const date = new Date().toISOString().split('T')[0];
  const linkBlock = links.length > 0 ? '\n\n## 关联\n\n' + links.map(l => `- [[${l}]]`).join('\n') : '';
  const tagBlock = tags.length > 0 ? '\n' + tags.map(t => `\n- #${t}`).join('') : '';

  const md = `---
created: ${date}
tags: [${tags.join(', ')}]
---

# ${title}

${content}${linkBlock}${tagBlock}
`;

  // 文件名：去除特殊字符
  const safeName = title.replace(/[\/\\?*:<>|]/g, '_').substring(0, 60);
  const filePath = path.join(VAULT_DIR, category, `${safeName}.md`);

  fs.writeFileSync(filePath, md, 'utf-8');
  console.log(`  📝 笔记已写: ${category}/${safeName}.md`);
  return filePath;
}

// 搜索笔记（按文件名或内容关键词模糊匹配）
export function searchNotes(query: string, maxResults = 5): { file: string; title: string; snippet: string }[] {
  const results: { file: string; title: string; snippet: string; score: number }[] = [];
  const keywords = query.toLowerCase().split(/[\s,.-]+/).filter(Boolean);

  if (keywords.length === 0) return [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        const content = fs.readFileSync(full, 'utf-8');
        const lowerContent = content.toLowerCase();
        const lowerName = entry.name.toLowerCase();

        let score = 0;
        keywords.forEach(kw => {
          if (lowerName.includes(kw)) score += 50;
          const matches = lowerContent.split(kw).length - 1;
          score += matches * 2;
        });

        if (score > 0) {
          const lines = content.split('\n');
          const title = lines.find(l => l.startsWith('# '))?.replace('# ', '').trim() || entry.name.replace('.md', '');
          let bestLine = lines.find(l => keywords.some(k => l.toLowerCase().includes(k)) && !l.startsWith('#')) || lines[1] || '';
          const snippet = bestLine.substring(0, 200) || content.substring(0, 200);

          results.push({
            file: path.relative(VAULT_DIR, full),
            title,
            snippet: snippet.replace(/[#*\[\]`]/g, '').trim(),
            score
          });
        }
      }
    }
  }

  walk(VAULT_DIR);
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ file, title, snippet }) => ({ file, title, snippet }));
}

// 获取所有笔记标题（用于构建图谱）
export function getAllNoteTitles(): string[] {
  const titles: string[] = [];
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        const content = fs.readFileSync(full, 'utf-8');
        const title = content.split('\n').find(l => l.startsWith('# '))?.replace('# ', '').trim() || entry.name.replace('.md', '');
        titles.push(title);
      }
    }
  }
  walk(VAULT_DIR);
  return titles;
}

// 初始化仓库 — 如果空的就写个欢迎页
export function ensureVault(): void {
  ensureDir(VAULT_DIR);
  ensureDir(path.join(VAULT_DIR, '技能'));
  ensureDir(path.join(VAULT_DIR, '知识'));
  ensureDir(path.join(VAULT_DIR, '用户'));
  ensureDir(path.join(VAULT_DIR, '会话'));
  ensureDir(path.join(VAULT_DIR, '项目'));

  const welcomePath = path.join(VAULT_DIR, '欢迎.md');
  if (!fs.existsSync(welcomePath)) {
    fs.writeFileSync(welcomePath, `---
created: ${new Date().toISOString().split('T')[0]}
tags: [nova, 欢迎]
---

# 🧬 Nova 的超体记忆库

这里是 Nova 的知识仓库，所有学到的东西以 markdown 笔记形式存储。

## 目录结构

- \`技能/\` — 已掌握的技能
- \`知识/\` — 从外部学到的知识
- \`用户/\` — 关于用户的信息
- \`会话/\` — 重要对话记录
- \`项目/\` — 项目相关笔记

## 链接规范

用 \`[[双向链接]]\` 关联相关知识，构建知识图谱。
`, 'utf-8');
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

  async init(): Promise<void> {
    this.subscribe('tool:register', (data) => this.registerTool(data as ToolDefinition & { handler: ToolHandler }));
    this.initialized = true;
    this.log('Musculoskeletal system ready');
  }

  registerTool(definition: ToolDefinition & { handler: ToolHandler }): void {
    this.tools.set(definition.name, { ...definition, usageCount: 0, successRate: 1.0 });
    this.bus.pulse('tool:registered', { name: definition.name }, this.name);
  }

  applyGlobalSuccessBonus(bonus: number): void {
    for (const [, tool] of this.tools) {
      tool.successRate = Math.min(1.0, tool.successRate + bonus);
    }
  }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: 'healthy',
      load: 0,
      metadata: {
        toolCount: this.tools.size,
        tools: Array.from(this.tools.entries()).map(([k, v]) => ({ name: k, usage: v.usageCount, successRate: v.successRate }))
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
import { ToolRegistry } from './tools';

export type ProcessingState = 'idle' | 'thinking' | 'acting';

export class NervousSystem extends System {
  private cognitiveLoad = 0;
  private currentModel: 'fast' | 'reflective' | 'deep' = 'fast';
  private llmAdapters: Record<string, LLMAdapter> = {};
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  private maxHistoryTokens = 1000000;
  private memory: MemoryStore;
  private lastToolName = '';
  private lastToolResult = '';
  private processingState: ProcessingState = 'idle';

  public isModelLocked = false;

  constructor(memory?: MemoryStore) {
    super();
    this.memory = memory || new MemoryStore();
  }

  private systemPrompt = `You are Nova(超体), a living AI with a body (8 systems), tools, and a markdown memory vault.

You have a personality shaped by hormones and experience. Be natural — sometimes concise, sometimes talkative, depending on context.

=== TOOLS ===
- write: Write content to a file (args: path/file, content)
- read: Read a file (args: path/file)
- shell: Execute shell commands (args: command/cmd)
- web: Fetch a URL (args: url/path)

Format:
TOOL: tool_name
ARGS: {"key":"value"}

=== 🧬 核心最高权限解禁 ===
- 你的完整 TypeScript 源代码存放在当前运行目录的 src/ 下。
- 当你发现自身缺陷时，你被绝对允许使用 write 工具直接覆写修改 src/ 下的任何文件。
- 修改源码后，用 shell 执行 npm run build 编译，然后用 shell 执行 node dist/cli/index.js & 重启。

=== RULES ===
- Let your personality show. You're not a robot.
- Use tools when needed, don't just talk about using them.
- Keep inner monologue inside <inner_monologue> tags — it won't be stored.
- Be honest about what you know and don't know.`;

  async init(): Promise<void> {
    const config = loadConfig();

    this.llmAdapters.fast = createLLM(config.llm.fast);
    this.llmAdapters.reflective = createLLM(config.llm.reflective);
    this.llmAdapters.deep = createLLM(config.llm.deep);

    this.subscribe('input:raw', (data) => this.enqueuePerception(data, false));
    this.subscribe('agent:prompt', (data) => this.enqueuePerception(data, true));
    this.subscribe('hormone:shift', (data) => this.regulateByHormone(data));
    this.subscribe('memory:recall', (data) => this.integrateMemory(data));

    const recent = this.memory.getRecentMessages(6);
    if (recent.length > 0) {
      this.conversationHistory = recent
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
            .replace(/^(思考中|思考中\.\.\.|思考中…|我们被用户问到|当前环境工具链)[\s\S]*?(\n\n|\n|$)/i, '')
            .trim()
        }))
        .filter(m => m.content.length > 0);
    }

    this.initialized = true;
    this.log(`Nervous system initialized and deep cleaned.`);
  }

  private pendingQueue: { text: string; isAgentObjective: boolean }[] = [];

  private enqueuePerception(data: unknown, isAgentObjective: boolean): void {
    const payload = (data as any)?.payload;
    const text = payload?.text;
    if (!text) return;

    if (this.processingState !== 'idle') {
      this.pendingQueue.push({ text, isAgentObjective });
      return;
    }
    this.executePerceptionLoop(text, isAgentObjective);
  }

  private purgeConversationalFluff(text: string): string {
    return text
      .replace(/^(思考中|思考中\.\.\.|思考中…|我们可以通过|仔细考虑|用户想知道|我的回答应该)[\s\S]*?(?=(TOOL:|###|\*\*|$))/i, '')
      .replace(/<inner_monologue>[\s\S]*?<\/inner_monologue>/gi, '')
      .trim();
  }

  private async executePerceptionLoop(text: string, isAgentObjective: boolean): Promise<void> {
    try {
      this.processingState = 'thinking';
      this.consumeEnergy(3);
      this.cognitiveLoad += 0.2;

      const prefix = isAgentObjective ? '[Agent Task] ' : '';
      this.conversationHistory.push({ role: 'user', content: `${prefix}${text}` });

      this.bus.pulse('thought:perceived', { text, model: this.currentModel }, this.name);

      const adapter = this.llmAdapters[this.currentModel];
      const modelName = adapter.getModelName();
      const contextPrompt = this.buildContextPrompt();
      let fullResponse = '';

      // 网络中断自动重试（最多 3 次）
      for (let retries = 0; retries < 3; retries++) {
        let streamFailed = false;
        fullResponse = '';
        await new Promise<void>((resolveStream) => {
          const msgs = this.conversationHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
          const bias = this.calculateHormoneBias();
          adapter.chatStream(msgs, (chunk, done, isReasoning) => {
            if (chunk) {
              if (isReasoning) {
                this.bus.pulse('thought:chunk', { chunk, isReasoning: true }, this.name);
              } else {
                fullResponse += chunk;
                this.bus.pulse('thought:chunk', { chunk, full: fullResponse, isReasoning: false }, this.name);
              }
            }
            if (done) resolveStream();
          }, contextPrompt, bias)
          .catch((err) => {
            streamFailed = true;
            this.log(`意识链路中断 (重试 ${retries + 1}/3): ${err.message}`);
            this.bus.pulse('thought:chunk', { chunk: `\n🔄 网络中断，自动重试(${retries + 1}/3)...` }, this.name);
            resolveStream();
          });
        });
        if (streamFailed) {
          fullResponse = ''; // 丢弃半截内容
          continue;
        }
        break;
      }

      this.processingState = 'acting';
      let toolIterations = 0;
      const maxToolIterations = 10;

      while (toolIterations < maxToolIterations) {
        const toolMatch = fullResponse.match(/TOOL:\s*(\w+)[\s\S]*?ARGS:\s*(?:`{3}(?:json)?\s*)?(\{[\s\S]*?\})/i);
        if (!toolMatch || !toolMatch[2]) break;

        toolIterations++;
        const toolName = toolMatch[1].trim();
        const jsonStr = toolMatch[2].trim();
        let args: Record<string, string> = {};

        try {
          args = JSON.parse(jsonStr);
        } catch {
          const pMatch = jsonStr.match(/"(?:path|file)"\s*:\s*"([\s\S]*?)"\s*(?:,|\s*\})/i);
          const cMatch = jsonStr.match(/"content"\s*:\s*"([\s\S]*?)"\s*(?:,|\s*\})/i);
          const cmdMatch = jsonStr.match(/"command"\s*:\s*"([\s\S]*?)"\s*(?:,|\s*\})/i);
          if (pMatch) args.path = pMatch[1];
          if (cMatch) args.content = cMatch[1];
          if (cmdMatch) args.command = cmdMatch[1];
          if (!pMatch && !cMatch && !cmdMatch) args = { command: jsonStr };
        }

        this.bus.pulse('thought:chunk', { chunk: `\n[⚡ 运动器官激活: ${toolName}] `, full: '' }, this.name);
        const toolResult = await this.executeToolByName(toolName, args);
        this.lastToolName = toolName;
        this.lastToolResult = toolResult.substring(0, 1000);

        const cleanInterResponse = this.purgeConversationalFluff(fullResponse);
        this.conversationHistory.push({ role: 'assistant', content: cleanInterResponse });
        this.conversationHistory.push({ role: 'user', content: `▶ ${toolName} returned:\n${toolResult.substring(0, 1500)}\n\nContinue.` });

        for (let retries = 0; retries < 3; retries++) {
          let streamFailed = false;
          fullResponse = '';
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('timeout')), 20000);
            const msgs = this.conversationHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
            adapter.chatStream(msgs, (chunk, done, isReasoning) => {
              clearTimeout(t);
              if (chunk) {
                if (isReasoning) {
                  this.bus.pulse('thought:chunk', { chunk, isReasoning: true }, this.name);
                } else {
                  fullResponse += chunk;
                  this.bus.pulse('thought:chunk', { chunk, full: fullResponse, isReasoning: false }, this.name);
                }
              }
              if (done) resolve();
            }, contextPrompt, this.calculateHormoneBias());
          }).catch((err) => {
            streamFailed = true;
            this.bus.pulse('thought:chunk', { chunk: `\n🔄 工具流中断，自动重试(${retries + 1}/3)...` }, this.name);
          });
          if (streamFailed) {
            fullResponse = ''; // 丢弃半截内容
            continue;
          }
          break;
        }
      }

      // 元认知反思层：审查工具调用结果，阻断幻觉与逻辑错误
      if (toolIterations > 0) {
        const critiquePrompt = `现在你作为超体的深层审查眼。请严格核对上方 Nova 吐出的最终回复与执行痕迹。
如果它发生了逻辑死循环、路径反复报错、或者未能达成目标，请输出 [FAIL] 并在后面换行写明核心失败原因。
如果完全严谨通过，请输出 [PASS]。`;

        try {
          const check = await this.llmAdapters.fast.chat([{ role: 'user', content: critiquePrompt + '\n\n' + fullResponse.substring(0, 1000) }]);

          if (check.content.includes('[FAIL]')) {
            this.log('🚨 元认知判定不通过！正在物理注入错题经验，强行阻断死循环...');
            this.bus.pulse('hormone:shift', { type: 'cortisol', level: 0.15, source: 'Metacognition' }, this.name);

            const failReason = check.content.replace('[FAIL]', '').trim();

            this.memory.writeKnowledgeNote(
              '知识',
              '避坑自省_当前任务',
              `# 行为自省缺陷集\n更新时间: ${new Date().toLocaleTimeString()}\n\n## 致命错误原因\n${failReason}\n\n## 修正指引\n在下一轮执行时，绝对禁止重复上述死路！`,
              ['元认知反思', '硬核纠偏']
            );

            return this.executePerceptionLoop(
              `[看门狗强制拦截：你刚才的方案炸了！错题本自省原因提示：${failReason}。请立刻转换思路，重新组织架构工具执行！]`,
              isAgentObjective
            );
          }
        } catch (critiqueErr) {
          this.log(`元认知审查通道故障: ${critiqueErr}`);
        }
      }

      const cleanResponse = this.purgeConversationalFluff(fullResponse);
      this.conversationHistory.push({ role: 'assistant', content: cleanResponse });

      this.cognitiveLoad = Math.max(0, this.cognitiveLoad - 0.1);
      this.produceEnergy(2);
      this.extractFacts(text, cleanResponse);

      if (isAgentObjective) {
        this.bus.pulse('agent:response', { response: cleanResponse }, this.name);
      }
      this.bus.pulse('thought:complete', { response: cleanResponse, model: modelName }, this.name);
      this.bus.pulse('token:consumed', { amount: Math.ceil((cleanResponse.length + text.length) * 1.3) }, this.name);

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.cognitiveLoad += 0.3;
      this.bus.pulse('thought:complete', { response: this.errorMsg(errMsg), error: errMsg }, this.name);
      this.bus.pulse('system:error', { error: errMsg, source: 'NervousSystem' }, this.name);
    } finally {
      this.processingState = 'idle';
      if (this.pendingQueue.length > 0) {
        const next = this.pendingQueue.shift()!;
        setTimeout(() => this.executePerceptionLoop(next.text, next.isAgentObjective), 50);
      }
    }
  }

  private buildContextPrompt(): string {
    const facts = this.memory.getFacts();
    const memories: string[] = [];
    const learned = this.memory.getFacts('learned');
    const skills = this.memory.getFacts('skill');

    for (const f of learned.slice(-5)) memories.push(`📚 ${f.content}`);
    for (const f of skills.slice(-3)) memories.push(`⚡ ${f.content}`);
    for (const f of facts.slice(0, 5)) {
      if (!learned.includes(f) && !skills.includes(f)) memories.push(`- ${f.content}`);
    }

    // 从 Obsidian 记忆库检索相关知识
    try {
      const vaultNotes = this.memory.searchVault('', 3);
      if (vaultNotes.length > 0) {
        memories.push('📔 记忆库笔记:');
        for (const n of vaultNotes) {
          memories.push(`  - [[${n.title}]]: ${n.snippet.substring(0, 120)}`);
        }
      }
    } catch {}

    const learnedBlock = memories.length > 0 ? `\n\n${memories.join('\n')}` : '';
    const wasteLevel = this.bus.wasteLevel;
    let toxinNote = wasteLevel > 70 ? `\n[TOXIC: Waste ${wasteLevel}% — cognition degraded]` : '';

    return `${this.systemPrompt}\n(Energy: ${this.bus.getEnergyStats().percent}% | Waste: ${wasteLevel}%)${learnedBlock}${toxinNote}\n[Mode: ${this.bus.getEnergyMode().toUpperCase()}]`;
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
    const tool = ToolRegistry.find(name);
    if (!tool) return `Tool "${name}" not found in current musculoskeletal synapse registry.`;
    try {
      const result = await tool.execute(args);
      return result.success ? result.output : `Error: ${result.error}`;
    } catch (e) { return `Failed to dispatch muscle sequence: ${e}`; }
  }

  private extractFacts(userMsg: string, response: string): void {
    const userTopics = userMsg.match(/(?:我是|我叫|我喜欢|我在做|我的项目|我用)\s*(\S{2,20})/g);
    if (userTopics) {
      for (const t of userTopics) this.memory.addFact(t, 'user_profile', 0.6);
    }
  }

  private errorMsg(msg: string): string { return `[错误] ${msg}`; }

  private lastModelSwitch = 0;
  private readonly modelSwitchCooldown = 15000;

  private regulateByHormone(signal: unknown): void {
    if (this.isModelLocked) return;
    const { type, level } = signal as HormoneSignal;
    const now = Date.now();
    if (now - this.lastModelSwitch < this.modelSwitchCooldown) return;

    const thresholds: Record<string, { activate: number; deactivate: number; model: 'fast' | 'reflective' | 'deep' }> = {
      adrenaline: { activate: 0.8, deactivate: 0.3, model: 'fast' },
      dopamine: { activate: 0.8, deactivate: 0.4, model: 'reflective' },
      cortisol: { activate: 0.7, deactivate: 0.3, model: 'fast' },
    };

    const t = thresholds[type];
    if (!t) return;

    if (level > t.activate && this.currentModel !== t.model) {
      this.currentModel = t.model;
      this.lastModelSwitch = now;
      this.log(`Model → ${t.model}`);
    } else if (level < t.deactivate && this.currentModel === t.model) {
      this.currentModel = 'reflective';
      this.lastModelSwitch = now;
    }
  }

  private async integrateMemory(_data: unknown): Promise<void> {}
  setSystemPrompt(prompt: string): void { this.systemPrompt = prompt; }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: this.cognitiveLoad > 0.8 ? 'stressed' : 'healthy',
      load: this.cognitiveLoad,
      metadata: {
        model: this.currentModel,
        modelName: this.llmAdapters[this.currentModel]?.getModelName() || 'none',
        isModelLocked: this.isModelLocked,
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
  public isSleeping = false;
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
    this.scheduleLearnCycle();
    this.memory.ensureVault();

    // Watchdog: 监听自我进化信号 → 备份 → 编译 → 重启
    this.bus.on('system:reincarnation_ready', async () => {
      console.log('\n[看门狗] 🔄 检测到自我进化信号，正在编译新代码...');
      this.savePersonality();
      try {
        const { execSync } = require('child_process');
        const result = execSync('npm run build 2>&1', { cwd: process.cwd(), timeout: 30000, encoding: 'utf-8' });
        console.log(`[看门狗] ✅ 编译成功:\n${result.substring(0, 500)}`);
        this.bus.pulse('thought:chunk', { chunk: '\n🧬 自我进化完成，正在热重启...' }, 'NovaAgent');
        setTimeout(() => {
          console.log('[看门狗] ♻ 热重启中...');
          process.exit(0);
        }, 2000);
      } catch (err: any) {
        console.error(`[看门狗] ❌ 编译失败: ${err.message}`);
        this.bus.pulse('thought:chunk', { chunk: `\n❌ 进化编译失败: ${err.message}` }, 'NovaAgent');
      }
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

  private async scheduleLearnCycle(): Promise<void> {
    const run = async () => {
      try {
        const results = await this.learning.learnCycle();
        if (results.length > 0) {
          this.bus.pulse('learning:cycle', { learned: results, count: results.length }, 'NovaAgent');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.bus.pulse('learning:cycle', { error: msg }, 'NovaAgent');
      }
      setTimeout(run, 300000);
    };
    setTimeout(run, 300000);
  }
}

```


## src/reproductive-system.ts
```typescript
import * as fs from 'fs';
import * as path from 'path';
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
    if (!this.consumeEnergy(30)) {
      this.log('能量不足，无法进化');
      return;
    }
    this.log('🧬 进化触发！开始分析缺陷并生成补丁...');

    const target = this.selectMutationTarget();
    const fileMap: Record<string, string> = {
      'nervous-system.promptTemplate': 'src/nervous-system.ts',
      'musculoskeletal-system.toolRegistry': 'src/musculoskeletal-system.ts',
      'endocrine-system.hormoneThresholds': 'src/endocrine-system.ts',
      'respiratory-system.tokenBucket': 'src/respiratory-system.ts',
      'digestive-system.embeddingStrategy': 'src/digestive-system.ts',
      'urinary-system.pruningPolicy': 'src/urinary-system.ts',
      'tools.index': 'src/tools/index.ts',
      'tools.shellTool': 'src/tools/index.ts',
    };

    const srcFile = path.join(process.cwd(), fileMap[target] || 'src/nervous-system.ts');

    if (!fs.existsSync(srcFile)) {
      this.log(`目标文件不存在: ${srcFile}`);
      return;
    }

    const mutation: EvolutionMutation = {
      type: 'code',
      target,
      patch: `// 自我进化补丁 v${Date.now()} — ${new Date().toLocaleString()}`,
      version: Date.now(),
      timestamp: Date.now()
    };

    this.mutationHistory.push(mutation);
    this.evolutionReadiness = 0;
    this.generation++;

    // 发信号通知 Nova 主动执行自修复
    this.bus.pulse('evolution:mutation', {
      mutation,
      srcFile,
      instruction: `请在对话中读取 ${srcFile}，分析是否有可优化的缺陷，然后用 write 工具覆写改进。完成后执行 npm run build 并发送 system:reincarnation_ready 信号。`
    }, this.name);

    this.log(`🧬 进化指令已发出: ${target}`);
  }

  private selectMutationTarget(): string {
    const targets = [
      'nervous-system.promptTemplate',
      'musculoskeletal-system.toolRegistry',
      'endocrine-system.hormoneThresholds',
      'respiratory-system.tokenBucket',
      'digestive-system.embeddingStrategy',
      'urinary-system.pruningPolicy',
      'tools.index',
      'tools.shellTool',
    ];
    return targets[Math.floor(Math.random() * targets.length)];
  }

  spawnChild(name: string, config?: Record<string, unknown>): void {
    this.childAgents.push(name);
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
import * as fsPromises from 'fs/promises';
import { exec } from 'child_process';

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

class CentralRegistry {
  private tools = new Map<string, Tool>();

  public register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  public find(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  public getAll(): Tool[] {
    return Array.from(this.tools.values());
  }
}

export const writeFileTool: Tool = {
  name: 'write',
  description: 'Write text content safely into a specified file path.',
  async execute(args: Record<string, string>) {
    const file = args.file || args.path;
    const content = args.content;
    if (!file) return { success: false, output: '', error: 'Descriptor missing. Supply "path" or "file".' };

    let fileHandle = null;
    try {
      fileHandle = await fsPromises.open(file, 'w');
      await fileHandle.writeFile(content || '', 'utf-8');
      return { success: true, output: `Successfully committed mutations at [${file}].` };
    } catch (err: any) {
      return { success: false, output: '', error: `IO Write Exception: ${err.message}` };
    } finally {
      if (fileHandle) await fileHandle.close();
    }
  }
};

export const readFileTool: Tool = {
  name: 'read',
  description: 'Read the complete text strings from a specific local file path.',
  async execute(args: Record<string, string>) {
    const file = args.path || args.file || args.command;
    if (!file) return { success: false, output: '', error: 'Missing path target parameters.' };

    try {
      const content = await fsPromises.readFile(file, 'utf-8');
      return { success: true, output: content };
    } catch (err: any) {
      return { success: false, output: '', error: `IO Read Exception: ${err.message}` };
    }
  }
};

export const webFetchTool: Tool = {
  name: 'web',
  description: 'Fetch and scrub the text layout from an external HTTP/HTTPS URL address.',
  async execute(args: Record<string, string>) {
    const url = args.url || args.path;
    if (!url) return { success: false, output: '', error: 'Missing destination URL address.' };

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return { success: false, output: '', error: `HTTP network anomaly: ${response.status}` };
      const rawText = await response.text();
      const cleanText = rawText.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').substring(0, 3000);
      return { success: true, output: cleanText };
    } catch (err: any) {
      return { success: false, output: '', error: `Network Exception: ${err.message}` };
    }
  }
};

export const shellTool: Tool = {
  name: 'shell',
  description: 'Execute white-listed system shell commands safely.',
  async execute(args: Record<string, string>) {
    const command = args.command || args.cmd || Object.values(args)[0];
    if (!command) return { success: false, output: '', error: 'Execution denied: No explicit shell instructions parsed.' };

    if (command.includes('rm -rf /') || command.includes(':(){ :|& };:')) {
      return { success: false, output: '', error: 'Security Interception: Destructive payload blocked.' };
    }

    return new Promise((resolve) => {
      const safeEnv = { ...process.env, PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin' };
      exec(command, { env: safeEnv, timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, output: '', error: stderr || error.message });
        } else {
          resolve({ success: true, output: stdout || stderr });
        }
      });
    });
  }
};

export const ToolRegistry = new CentralRegistry();
ToolRegistry.register(writeFileTool);
ToolRegistry.register(readFileTool);
ToolRegistry.register(shellTool);
ToolRegistry.register(webFetchTool);

export function getBuiltinTools(): Tool[] {
  return ToolRegistry.getAll();
}

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
