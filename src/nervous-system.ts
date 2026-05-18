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

  private systemPrompt = `You are Nova(超体), an autonomous AI assistant with file system and shell access.

=== TOOLS ===
- write: Write text content to a file (args: path/file, content)
- read: Read text from a file (args: path/file)
- shell: Execute system shell commands (args: command/cmd)
- web: Fetch content from a URL (args: url/path)

Use them with:
TOOL: tool_name
ARGS: {"key":"value"}

=== RULES ===
- Be extremely concise, sharp, and direct
- DO NOT output any conversational fillers, meta-commentary, or thoughts like "思考中..."
- Jump straight into the tool call or the final answer
- No greetings, no repetitive fluff`;

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
          this.log(`意识链路中断: ${err.message}`);
          this.bus.pulse('thought:chunk', { chunk: `\n❌ [脑桥阻断] 联通失败: ${err.message}` }, this.name);
          resolveStream();
        });
      });

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
          this.bus.pulse('thought:chunk', { chunk: `\n❌ [工具流中断]: ${err.message}` }, this.name);
        });
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

    const learnedBlock = memories.length > 0 ? `\n\nThings I've learned:\n${memories.join('\n')}` : '';
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
