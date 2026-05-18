#!/usr/bin/env node
process.on('unhandledRejection', (err) => console.error('[安全阀] 未捕获的异常:', (err as any)?.message || err));
process.on('uncaughtException', (err) => {
  console.error('[安全阀] 致命错误:', err.message);
  console.error(err.stack?.substring(0, 500));
  console.log('[安全阀] 5 秒后自动重启...');
  setTimeout(() => {
    const { execSync } = require('child_process');
    try { execSync('node ' + process.argv[1] + ' &', { cwd: process.cwd() }); } catch {}
    process.exit(1);
  }, 5000);
});
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
