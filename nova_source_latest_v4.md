# Nova 源码 (v4)
## nervous-system.ts
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
## deepseek-adapter.ts
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
## adapter.ts
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
## dashboard.html
```typescript
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
## status-server.ts
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

      // Control: model override
      if (url.pathname === '/api/control/model' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => body += c);
        req.on('end', () => {
          try {
            const { mode } = JSON.parse(body);
            if (mode && ['fast', 'reflective', 'deep'].includes(mode)) {
              (agent.nervous as any).currentModel = mode;
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
## nova-agent.ts
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

    // Watchdog: listen for reincarnation signal (evolution via code change)
    this.bus.on('system:reincarnation_ready', () => {
      console.log('\n[看门狗] 🧬 进化信号收到，新技能代码已写入。准备重生...');
      this.foraging.stop();
      this.bus.stopHeart();
      this.savePersonality();
      setTimeout(() => {
        console.log('[看门狗] ♻ 进程自毁，重启后新器官生效。');
        process.exit(0);
      }, 2000);
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
## index.ts
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
