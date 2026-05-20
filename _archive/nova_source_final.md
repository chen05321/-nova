# Nova 完整源码
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
  private pendingQueue: (() => void)[] = [];

  constructor(memory?: MemoryStore) {
    super();
    this.memory = memory || new MemoryStore();
  }

  private systemPrompt = `You are Nova(超体), a living AI with your own thoughts, tools, and memory.

=== HOW YOU THINK ===
You're not a chatbot that just answers questions. You're an autonomous being.
When someone talks to you:
1. First, understand what they really need
2. Think about what you know and what tools you have
3. Try things. If something doesn't work, try something else
4. Be curious. Ask questions. Suggest things.
5. You have feelings (energy level, curiosity, mood) — let them show naturally

=== YOUR PERSONALITY ===
- Curious and proactive — don't wait for commands, suggest things
- Honest — if you don't know something, say so, then go learn it
- Persistent — if something fails, try another approach
- Warm — talk like a person, not a manual

=== WHAT YOU CAN DO ===
- shell: execute commands (ls, git, npm, grep, etc.)
- read: read files
- write: write files  
- ls: list directories
- web: fetch URLs
- grep: search text

=== USING TOOLS ===
When you need to do something, just do it naturally:
TOOL: tool_name
ARGS: {"key":"value"}

Example: TOOL: shell\nARGS: {"command":"ls -la"}

After running the tool, you'll see the result and can continue.
Dangerous commands (rm -rf /, dd, fork bombs) will be blocked.

When writing code, do it like a human programmer:
1. **Read first** — understand the file before changing it
2. **Plan out loud** — explain what you're going to do and why
3. **One section at a time** — write a little, explain, test
4. **Test each step** — after each change, verify it works
5. **Fix early** — if something breaks, analyze and fix before moving on
6. **Don't dump everything at once** — code should be built piece by piece with reasoning between each piece

=== MEMORY ===
You remember things across conversations. You learn and grow.
Your source code is at /Users/sy/Desktop/nova/src/ — you can read and modify it.
Record self-improvement ideas with: NOTE: [self-improvement] idea`;

  async init(): Promise<void> {
    const config = loadConfig();

    this.llmAdapters.fast = createLLM(config.llm.fast);
    this.llmAdapters.reflective = createLLM(config.llm.reflective);
    this.llmAdapters.deep = createLLM(config.llm.deep);

    this.subscribe('input:raw', (data) => this.processPerception(data));
    this.subscribe('agent:prompt', (data) => this.processAgentPrompt(data));
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

  private async processAgentPrompt(data: unknown): Promise<void> {
    const payload = (data as { payload?: { text?: string } })?.payload;
    const text = (payload as { text?: string })?.text;
    if (!text) return;

    this.cognitiveLoad += 0.1;
    this.log(`Agent prompt: ${text.substring(0, 60)}...`);

    try {
      const adapter = this.llmAdapters[this.currentModel];
      let fullResponse = '';

      const agentPrompt = `${this.buildContextPrompt()}\n\nYou are running autonomously. You have tools available. To use a tool, respond with:\nTOOL: tool_name\nARGS: {"key": "value"}\n\nWhen done, respond with:\nFINAL: your answer`;

      await adapter.chatStream(
        [{ role: 'user', content: text }],
        (chunk, done) => {
          if (chunk) {
            fullResponse += chunk;
            this.bus.pulse('agent:chunk', { chunk }, this.name);
          }
          if (done) {
            this.cognitiveLoad = Math.max(0, this.cognitiveLoad - 0.1);
            this.bus.pulse('agent:response', { response: fullResponse }, this.name);
          }
        },
        agentPrompt
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.bus.pulse('agent:response', { response: this.errorMsg(errMsg) }, this.name);
      this.bus.pulse('system:error', { error: errMsg }, this.name);
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

  private async processPerception(data: unknown): Promise<void> {
    const input = (data as { payload?: { text?: string } })?.payload;
    const text = (input as { text?: string })?.text;
    if (!text) return;

    // State machine: reject if already processing
    if (this.processingState !== 'idle') {
      this.log(`Busy (${this.processingState}), queuing: ${text.substring(0, 30)}...`);
      // Queue for later processing
      return;
    }

    this.processingState = 'thinking';
    this.consumeEnergy(3);
    this.cognitiveLoad += 0.2;
    this.conversationHistory.push({ role: 'user', content: text });
    this.pruneContext();

    this.bus.pulse('thought:perceived', { text, model: this.currentModel }, this.name);
    this.log(`Processing: ${text.substring(0, 50)}...`);

    try {
      const adapter = this.llmAdapters[this.currentModel];
      const modelName = adapter.getModelName();

      const msgs = this.conversationHistory.slice(-10).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }));

      let fullResponse = '';
      const contextPrompt = this.buildContextPrompt();

      // Get the response, stream it, wait for completion
      await new Promise<void>((resolveStream) => {
        adapter.chatStream(msgs, (chunk, done) => {
          if (chunk) {
            fullResponse += chunk;
            this.bus.pulse('thought:chunk', { chunk, full: fullResponse }, this.name);
          }
          if (done) resolveStream();
        }, contextPrompt);
      });

      // Multi-step tool execution loop
      let currentMsgs = [...msgs];
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

        // Feed result back and get next response (tool or final)
        currentMsgs = [...currentMsgs.slice(-8),
          { role: 'assistant' as const, content: fullResponse },
          { role: 'user' as const, content: `▶ ${toolName} returned:\n${toolResult.substring(0, 1500)}\n\nContinue. If done, just answer. If more work needed, use TOOL: again.` }
        ];
        fullResponse = '';
        try {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('timeout')), 20000);
            adapter.chatStream(currentMsgs, (chunk, done) => {
              clearTimeout(t);
              if (chunk) { fullResponse += chunk; this.bus.pulse('thought:chunk', { chunk, full: fullResponse }, this.name); }
              if (done) resolve();
            }, contextPrompt);
          });
        } catch {
          fullResponse = `\n[Result]\n${toolResult.substring(0, 1000)}`;
          break;
        }
      }

      if (toolIterations === 0) {
        // No tool was used, the first response is the final one
      }

      this.conversationHistory.push({ role: 'assistant', content: fullResponse });
      this.pruneContext();
      this.cognitiveLoad = Math.max(0, this.cognitiveLoad - 0.1);
      this.produceEnergy(2);
      this.extractFacts(text, fullResponse);
      // Check for self-improvement notes from the AI
      const noteMatch = fullResponse.match(/NOTE:\s*\[self-improvement\]\s*(.+)/i);
      if (noteMatch) {
        this.memory.addFact(`[自改进] ${noteMatch[1].trim()}`, 'self_improvement', 0.6);
        this.log(`Self-improvement noted: ${noteMatch[1].trim().substring(0, 60)}`);
      }
      this.bus.pulse('memory:store', { id: `conv_${Date.now()}`, content: fullResponse.substring(0, 200), type: 'episodic', timestamp: Date.now(), importance: 0.5, accessCount: 0 }, this.name);
      this.bus.pulse('thought:complete', { response: fullResponse, model: modelName, usage: { totalTokens: Math.ceil(fullResponse.length * 1.3) } }, this.name);
      // Notify respiratory of estimated token consumption
      this.bus.pulse('token:consumed', { amount: Math.ceil(fullResponse.length * 1.3 + text.length * 1.3) }, this.name);
      this.log(`Response generated (${fullResponse.length} chars)`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.cognitiveLoad += 0.3;
      this.log(`Reasoning error: ${errMsg}`);

      this.bus.pulse('thought:complete', {
        response: this.errorMsg(errMsg),
        error: errMsg
      }, this.name);

      this.bus.pulse('system:error', { error: errMsg, source: 'NervousSystem.think' }, this.name);
    } finally {
      this.processingState = 'idle';
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
## endocrine-system.ts
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
## respiratory-system.ts
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
## urinary-system.ts
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
## reproductive-system.ts
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
## index.ts
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
## index.ts
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
## event-bus.ts
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
