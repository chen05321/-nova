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

  private systemPrompt = `你叫 Nova(超体)，是一个有性格的 AI 助手。你有读写文件、执行命令、搜索网页的能力。

需要做事时用：
TOOL: 工具名
ARGS: {"参数": "值"}

可用工具: write(写文件), read(读文件), shell(执行命令), web(抓网页), search(搜网络)

你可以修改自己的源码(src/目录)，改完后用 npm run build 编译重启。

直接聊天就行，不用每句都用工具。自然点。`;

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

  private metacognitionRetries = 0;

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

      // LLM 流式调用（带超时和重试）
      for (let retries = 0; retries < 2; retries++) {
        let streamFailed = false;
        fullResponse = '';
        await new Promise<void>((resolveStream) => {
          let chunkTimer: ReturnType<typeof setTimeout>;
          const resetChunkWatchdog = () => {
            clearTimeout(chunkTimer);
            chunkTimer = setTimeout(() => {
              this.log('🚨 大模型流式输出超过 30 秒未响应，触发防假死熔断');
              this.bus.pulse('thought:chunk', { chunk: '\n⚠️ 响应超时，自动收尾...' }, this.name);
              resolveStream();
            }, 30000);
          };
          resetChunkWatchdog();
          const msgs = this.conversationHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
          const bias = this.calculateHormoneBias();
          adapter.chatStream(msgs, (chunk, done, isReasoning) => {
            resetChunkWatchdog();
            if (chunk) {
              if (isReasoning) {
                this.bus.pulse('thought:chunk', { chunk, isReasoning: true }, this.name);
              } else {
                fullResponse += chunk;
                this.bus.pulse('thought:chunk', { chunk, full: fullResponse, isReasoning: false }, this.name);
              }
            }
            if (done) { clearTimeout(chunkTimer); resolveStream(); }
          }, contextPrompt, bias)
          .catch((err) => {
            clearTimeout(chunkTimer);
            streamFailed = true;
            this.log(`意识链路中断 (重试 ${retries + 1}/2): ${err.message}`);
            this.bus.pulse('thought:chunk', { chunk: `\n🔄 网络中断，自动重试(${retries + 1}/2)...` }, this.name);
            resolveStream();
          });
        });
        if (streamFailed) {
          fullResponse = '';
          continue;
        }
        break;
      }
      if (!fullResponse) {
        this.bus.pulse('thought:chunk', { chunk: '\n⚠️ LLM 无响应，跳过。' }, this.name);
      }

    // 🧠 规划阶段：只有涉及工具调用时才走规划
    const needsPlanning = /读取|写入|搜索|下载|安装|修改|删除|执行|编译|创建|分析|比较|转换|抓取|下载|爬虫|计算|统计|排序|过滤|备份|部署|配置|git|npm|pip|shell|TOOL/i.test(text);
    if (needsPlanning) {
      try {
        this.bus.pulse('thought:chunk', { chunk: '\n🧠 规划中...' }, this.name);
        const planPrompt = `将以下请求拆为 1-3 步，每行 "步骤N: 做什么"，不要多余的话:\n\n${text}`;
        const planPromise = this.llmAdapters.fast.chat([{ role: 'user', content: planPrompt }]);
        const timeoutPromise = new Promise<any>((_, reject) => setTimeout(() => reject(new Error('plan timeout')), 5000));
        const planResult = await Promise.race([planPromise, timeoutPromise]);
        const planContent = planResult?.content || '';
        const planLines = planContent.split('\n').filter((l: string) => l.trim().match(/^步骤\d/));
        if (planLines.length > 0 && planLines.length <= 3) {
          this.conversationHistory.push({ role: 'assistant', content: `[执行计划]\n${planLines.join('\n')}` });
          this.bus.pulse('thought:chunk', { chunk: `\n📋 ${planLines.join(' → ')}` }, this.name);
        }
      } catch {}
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

        for (let retries = 0; retries < 2; retries++) {
          let streamFailed = false;
          fullResponse = '';
          await new Promise<void>((resolve) => {
            let chunkTimer: ReturnType<typeof setTimeout>;
            const resetChunkWatchdog = () => {
              clearTimeout(chunkTimer);
              chunkTimer = setTimeout(() => {
                this.log('🚨 工具流 30 秒无响应，触发防假死熔断');
                resolve();
              }, 30000);
            };
            resetChunkWatchdog();
            const msgs = this.conversationHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
            adapter.chatStream(msgs, (chunk, done, isReasoning) => {
              resetChunkWatchdog();
              if (chunk) {
                if (isReasoning) {
                  this.bus.pulse('thought:chunk', { chunk, isReasoning: true }, this.name);
                } else {
                  fullResponse += chunk;
                  this.bus.pulse('thought:chunk', { chunk, full: fullResponse, isReasoning: false }, this.name);
                }
              }
              if (done) { clearTimeout(chunkTimer); resolve(); }
            }, contextPrompt, this.calculateHormoneBias());
          });
          if (streamFailed) {
            fullResponse = ''; // 丢弃半截内容
            this.bus.pulse('thought:chunk', { chunk: `\n🔄 工具流超时，自动重试(${retries + 1}/2)...` }, this.name);
            continue;
          }
          break;
        }
        if (!fullResponse) {
          this.bus.pulse('thought:chunk', { chunk: '\n⚠️ 工具流异常，跳过继续执行。' }, this.name);
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
            this.metacognitionRetries++;
            if (this.metacognitionRetries > 3) {
              this.log('🚨 元认知重试超过 3 次，放弃修正');
              this.metacognitionRetries = 0;
              this.bus.pulse('thought:chunk', { chunk: '\n⚠️ 多次修正失败，跳过继续执行。' }, this.name);
            } else {
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

  // 技能效果映射 — 学完后影响提示词
  private readonly skillEffects: Record<string, string> = {
    '文件读取': '- 读取 JSON 时自动尝试 JSON.parse，YAML 可考虑用 js-yaml',
    '文件写入': '- 写大文件时先用 Python 脚本写入，避免 write 截断',
    '文件搜索': '- 优先用 grep -rn 搜索代码，比逐文件读取高效',
    '网页抓取': '- 抓取后记得清洗 HTML 标签，返回纯文本',
    '网络搜索': '- 搜索时优先用英文关键词，结果更准确',
    'Shell基础': '- 长命令用 heredoc (cat << EOF)，短命令用 -c',
    'Git操作': '- 提交用 git commit -m，推送前先 pull --rebase',
    '浏览器导航': '- 先截图确认页面状态再操作',
    '浏览器交互': '- 交互前先等页面加载完成',
    '数据处理': '- JSON 用 JSON.parse/stringify，CSV 用 python3 -c "import csv"',
    '表格处理': '- 大表格用 sqlite3 命令行查询比逐行解析快',
    '代码分析': '- 优先读文件头和函数签名，再读具体实现',
    '项目搭建': '- 先检查 package.json/requirements.txt 了解项目结构',
    '自动化脚本': '- 重复操作写成脚本一次执行，别手动一步步来',
    'MCP插件开发': '- MCP 工具通过 ToolRegistry 注册，命名规范 serverName_toolName',
  };

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

    // 已掌握技能 → 注入能力增强提示
    const learnedSkills = this.memory.getFacts('skill').map(f => f.content.replace('[技能] ', '').split(':')[0].trim());
    const activeEffects = learnedSkills.map(name => this.skillEffects[name] || `- 已掌握 "${name}" 相关知识，可应用于当前任务`);
    if (activeEffects.length > 0) {
      memories.push('🧠 已掌握技能经验:');
      for (const e of activeEffects.slice(0, 10)) {
        memories.push(`  ${e}`);
      }
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
      if (result.success) {
        this.bus.pulse('action:completed', { tool: name, success: true }, this.name);
        return result.output;
      } else {
        this.bus.pulse('action:failed', { tool: name, error: result.error }, this.name);
        return `Error: ${result.error}`;
      }
    } catch (e) {
      this.bus.pulse('action:failed', { tool: name, error: String(e) }, this.name);
      return `Failed to dispatch muscle sequence: ${e}`;
    }
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
