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
      this.processingState = 'idle';
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
    }
    this.processingState = 'idle';
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
