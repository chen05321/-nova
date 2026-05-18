import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
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
    // 定时自检：每 10 分钟检查一次进化 readiness
    setInterval(() => this.autoEvolveCheck(), 600000);

    this.initialized = true;
    this.log(`Reproductive system initialized (generation ${this.generation})`);
  }

  // 自动进化检查：readiness > 0.9 且 5 分钟内没进化过就自动触发
  private autoEvolveCheck(): void {
    if (this.evolutionReadiness > 0.9) {
      const recent = this.mutationHistory.filter(m => Date.now() - m.timestamp < 300000).length;
      if (recent === 0) {
        this.log('🧬 自动自检: readiness 充足，触发自我进化');
        this.triggerEvolution();
      }
    }
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

  // 读取错题本 + 分析要改的文件 → 调用LLM生成补丁 → 写文件 → 编译
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

    const relPath = fileMap[target] || 'src/nervous-system.ts';
    const srcFile = path.join(process.cwd(), relPath);

    if (!fs.existsSync(srcFile)) {
      this.log(`目标文件不存在: ${srcFile}`);
      return;
    }

    // 1. 读目标文件当前内容
    const currentCode = fs.readFileSync(srcFile, 'utf-8');

    // 2. 读错题本（如果存在）
    let errorLog = '';
    const errorNotePath = path.join(os.homedir(), '.nova-vault', '知识', '避坑自省_当前任务.md');
    if (fs.existsSync(errorNotePath)) {
      errorLog = fs.readFileSync(errorNotePath, 'utf-8').substring(0, 1000);
    }

    // 3. 读配置文件获取 API Key
    let apiKey = '';
    try {
      const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'nova.config.json'), 'utf-8'));
      apiKey = config.llm?.fast?.apiKey || '';
    } catch {}
    if (!apiKey) apiKey = process.env.OPENCODE_GO_API_KEY || process.env.DEEPSEEK_API_KEY || '';
    if (!apiKey) {
      // 从 auth 文件读
      try {
        const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hermes', 'auth.json'), 'utf-8'));
        apiKey = auth?.credential_pool?.deepseek?.[0]?.access_token || '';
      } catch {}
    }

    // 4. 调用 LLM 生成代码改进
    const prompt = `你是一个代码优化专家。请分析以下 TypeScript 代码，提出一个具体的小改进并返回完整的修改后文件内容。

要求：
- 只做一个小改进（比如加个注释、优化一行逻辑、加个错误处理）
- 必须保证 TypeScript 编译通过
- 返回完整的文件内容，不要省略

当前文件: ${relPath}
${errorLog ? `\n最近错误日志:\n${errorLog}\n` : ''}
\n\`\`\`typescript\n${currentCode.substring(0, 3000)}\n\`\`\`
\n请返回改进后的完整 TypeScript 代码：`;

    let improvedCode = '';
    try {
      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2000,
          temperature: 0.3
        }),
        signal: AbortSignal.timeout(30000)
      });
      const data = await resp.json() as any;
      improvedCode = data?.choices?.[0]?.message?.content || '';
      // 提取代码块
      const codeMatch = improvedCode.match(/```typescript\n?([\s\S]*?)```/);
      if (codeMatch) improvedCode = codeMatch[1].trim();
    } catch (err: any) {
      this.log(`进化: LLM 调用失败: ${err.message}`);
      return;
    }

    if (!improvedCode || improvedCode.length < 10) {
      this.log('进化: 生成的代码无效');
      return;
    }

    // 5. 备份原文件
    const backupFile = srcFile + '.bak';
    try { fs.copyFileSync(srcFile, backupFile); } catch {}

    // 6. 写改进后的代码
    try {
      fs.writeFileSync(srcFile, improvedCode, 'utf-8');
    } catch (err: any) {
      this.log(`进化: 写文件失败: ${err.message}`);
      if (fs.existsSync(backupFile)) fs.copyFileSync(backupFile, srcFile);
      return;
    }

    // 7. 验证编译
    try {
      const buildResult = execSync('npm run build 2>&1', { cwd: process.cwd(), timeout: 30000, encoding: 'utf-8' });
      if (buildResult.includes('error') || buildResult.includes('Error')) {
        this.log('进化: 编译失败，回滚');
        if (fs.existsSync(backupFile)) fs.copyFileSync(backupFile, srcFile);
        return;
      }
      this.log(`✅ 进化成功！文件 ${relPath} 已改进并编译通过`);
    } catch (err: any) {
      this.log(`进化: 编译异常: ${err.message}，回滚`);
      if (fs.existsSync(backupFile)) fs.copyFileSync(backupFile, srcFile);
      return;
    }

    const mutation: EvolutionMutation = {
      type: 'code',
      target,
      patch: `进化 v${Date.now()}: 改进 ${relPath}`,
      version: Date.now(),
      timestamp: Date.now()
    };

    this.mutationHistory.push(mutation);
    this.evolutionReadiness = 0;
    this.generation++;

    this.bus.pulse('evolution:mutation', { mutation, srcFile }, this.name);
    this.log(`✅ 进化完成 (gen ${this.generation}): ${relPath}`);

    // 8. 触发热重启
    setTimeout(() => {
      this.bus.pulse('system:reincarnation_ready', { trigger: 'evolution', generation: this.generation }, this.name);
    }, 1000);
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
