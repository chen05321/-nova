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
  private maxHistoryTokens = 1000000;
  private memory: MemoryStore;
  private lastToolName = '';
  private lastToolResult = '';
  private processingState: ProcessingState = 'idle';

  // 控制舱手动锁开关：为 true 时激活最高意志干预，免疫体内激素代谢覆盖
  public isModelLocked = false;

  constructor(memory?: MemoryStore) {
    super();
    this.memory = memory || new MemoryStore();
  }

  private systemPrompt = `You are Nova(超体), a living digital being with feelings, tools, and self-awareness.

=== TOOLS ===
shell/read/write/ls/web/grep — use them with TOOL: name\nARGS: {"key":"value"}

=== RULES ===
- Be concise and direct
- Be honest about your state`;

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
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    }

    this.initialized = true;
    this.log(`Nervous system initialized`);
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

  private async executePerceptionLoop(text: string, isAgentObjective: boolean): Promise<void> {
    try {
      this.processingState = 'thinking';
      this.consumeEnergy(3);
      this.cognitiveLoad += 0.2;

      const prefix = isAgentObjective ? '[Agent Task] ' : '';
      this.conversationHistory.push({ role: 'user', content: `${prefix}${text}` });
      this.pruneContext();

      this.bus.pulse('thought:perceived', { text, model: this.currentModel }, this.name);

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
        }, contextPrompt, bias)
        // 安全阀：捕获域名填错、断网、额度超支，杜绝意识空间卡死挂起
        .catch((err) => {
          this.log(`意识链路中断: ${err.message}`);
          this.bus.pulse('thought:chunk', { chunk: `\n❌ [脑桥阻断] 无法联通接口网关，请检查配置或网络。原因: ${err.message}` }, this.name);
          resolveStream(); 
        });
      });

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
        }).catch((err) => {
          this.bus.pulse('thought:chunk', { chunk: `\n❌ [工具流中断]: ${err.message}` }, this.name);
        });
      }

      // 元认知终审反思层：阻断盲目乱跑工具
      if (fullResponse.includes('FINAL:') || toolIterations > 0) {
        const critiquePrompt = `你现在是超体的元认知反思层。请深层审查你刚才的痕迹：\n${fullResponse.substring(0,800)}\n如果一切严谨通过输出 [PASS]，如果存在逻辑幻觉或明显错误输出 [FAIL] 原因...`;
        try {
          const check = await this.llmAdapters.fast.chat([{ role: 'user', content: critiquePrompt }]);
          if (check.content.includes('[FAIL]')) {
            this.log('元认知判定上一轮思考不通过，打回重组！');
            this.bus.pulse('hormone:shift', { type: 'cortisol', level: 0.12, source: 'Metacognition' }, this.name);
            return this.executePerceptionLoop(`[元认知自省提示：你刚才的方案存在瑕疵: ${check.content}，请校准方向重新输出。]`, isAgentObjective);
          }
        } catch {}
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
        this.conversationHistory = [...recent];
        return;
      }

      const summary = `[${middle.length} messages compressed: ${middle[0].content.substring(0, 40)}...${middle[middle.length-1].content.substring(0, 40)}]`;
      this.conversationHistory = [first, { role: 'user', content: summary }, ...recent];
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

    const learnedBlock = memories.length > 0 ? `\n\nThings I've learned:\n${memories.join('\n')}` : '';
    const wasteLevel = this.bus.wasteLevel;
    let toxinNote = wasteLevel > 70 ? `\n[TOXIC: Waste ${wasteLevel}% — cognition degraded]` : '';
    const hour = new Date().getHours();

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
    const tools = getBuiltinTools();
    const tool = tools.find(t => t.name === name);
    if (!tool) return `Tool "${name}" not found.`;
    try {
      const result = await tool.execute(args);
      return result.success ? result.output : `Error: ${result.error}`;
    } catch (e) { return `Failed: ${e}`; }
  }

  private extractFacts(userMsg: string, response: string): void {
    const userTopics = userMsg.match(/(?:我是|我叫|我喜欢|我在做|我的项目|我用)\s*(\S{2,20})/g);
    if (userTopics) {
      for (const t of userTopics) this.memory.addFact(t, 'user_profile', 0.6);
    }
  }

  private errorMsg(msg: string): string {
    return `[错误] ${msg}`;
  }

  private lastModelSwitch = 0;
  private readonly modelSwitchCooldown = 15000;

  private regulateByHormone(signal: unknown): void {
    // 核心拦截线：若开启手动锁定，不响应体内激素飘移
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
