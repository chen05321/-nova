import { System } from './system';
import { Biometrics, HormoneSignal } from './types';
import { createLLM, LLMAdapter } from './llm';
import { loadConfig } from './config';
import { MemoryStore } from './memory';
import { getBuiltinTools } from './tools';

export class NervousSystem extends System {
  private cognitiveLoad = 0;
  private currentModel: 'fast' | 'reflective' | 'deep' = 'fast';
  private llmAdapters: Record<string, LLMAdapter> = {};
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  private maxHistoryTokens = 8000;
  private memory: MemoryStore = new MemoryStore();
  private systemPrompt = `You are Nova(超体), a self-evolving AI with built-in tools and memory.

Available tools you can use when needed:
- shell: Execute terminal commands
- read: Read files from the filesystem
- write: Write content to files
- ls: List directory contents
- web: Fetch content from URLs
- grep: Search for text patterns in files
- puppeteer: Control Chrome browser (screenshots, clicks, forms)

You have long-term memory that persists across conversations.
Forage for knowledge when you need to learn something new.

To use a tool, include in your response:
TOOL: tool_name
ARGS: {"key": "value"}

Example:
TOOL: shell
ARGS: {"command": "ls -la"}

Use tools freely but safely—dangerous operations (rm -rf /, dd, fork bombs) are blocked.
When you identify a shortcoming in yourself, record it with: NOTE: [self-improvement] description
Your self-assessments help improve your code.`;

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

    const modeNote = `\n[Energy: ${energyMode.toUpperCase()}] ${modeInstructions[energyMode]}`;

    return `${this.systemPrompt}\n(Energy: ${this.bus.getEnergyStats().percent}% | Learned: ${learned.length} topics)${learnedBlock}${modeNote}`;
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

      // Check if LLM requested a tool
      const toolMatch = fullResponse.match(/TOOL:\s*(\w+)\s*(?:\nARGS:\s*(\{[^}]*\}))?/);
      if (toolMatch && toolMatch[2]) {
        const toolName = toolMatch[1];
        let args: Record<string, string> = {};
        try { args = JSON.parse(toolMatch[2]); } catch { args = { command: toolMatch[2] }; }
        const toolResult = await this.executeToolByName(toolName, args);
        this.log(`Tool ${toolName} executed: ${toolResult.substring(0, 60)}`);

        // Feed result back for final response
        const followMsgs = [...msgs, { role: 'assistant' as const, content: fullResponse }, { role: 'user' as const, content: `Tool result:\n${toolResult.substring(0, 2000)}\n\nProvide the answer to the user based on this result.` }];
        fullResponse = '';
        await new Promise<void>((resolve) => {
          adapter.chatStream(followMsgs, (chunk, done) => {
            if (chunk) { fullResponse += chunk; this.bus.pulse('thought:chunk', { chunk, full: fullResponse }, this.name); }
            if (done) resolve();
          }, contextPrompt);
        });
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
      this.bus.pulse('thought:complete', { response: fullResponse, model: modelName }, this.name);
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
    return `[错误] ${msg}`;
  }

  private regulateByHormone(signal: unknown): void {
    const { type, level } = signal as HormoneSignal;

    if (type === 'adrenaline' && level > 0.7) {
      this.currentModel = 'fast';
      this.log(`Model switched to fast (${this.llmAdapters.fast?.getModelName() || 'unknown'})`);
    } else if (type === 'dopamine' && level > 0.7) {
      this.currentModel = 'reflective';
      this.log(`Model switched to reflective (${this.llmAdapters.reflective?.getModelName() || 'unknown'})`);
    } else if (type === 'cortisol' && level > 0.6) {
      this.currentModel = 'fast';
      this.log(`Model switched to fast due to stress (${this.llmAdapters.fast?.getModelName() || 'unknown'})`);
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
