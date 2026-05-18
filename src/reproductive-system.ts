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
  private errorHistory: Map<string, number> = new Map(); // 同一错误类型计数
  private lastEvolveTime = 0;

  async init(): Promise<void> {
    // 错误累积（保留，用于紧急修复）
    this.subscribe('system:error', () => this.incrementReadiness(0.1));
    this.subscribe('action:failed', (data) => {
      this.incrementReadiness(0.05);
      // 三振出局：同一工具失败 3 次 → 强制进化
      const tool = (data as any)?.payload?.tool || 'unknown';
      const count = (this.errorHistory.get(tool) || 0) + 1;
      this.errorHistory.set(tool, count);
      if (count >= 3) {
        this.log(`⚡ 三振出局: ${tool} 已失败 ${count} 次，强制进化`);
        this.triggerEvolution();
      }
    });
    this.subscribe('action:completed', (data) => {
      this.incrementReadiness(0.02);
      const tool = (data as any)?.payload?.tool || '';
      if (tool) this.errorHistory.delete(tool);
    });

    // 学习驱动进化：学到新知识 → 对比自身 → 决定是否升级
    // 知识分类映射：学习主题 → 对应系统 → 对应源码文件
    const knowledgeMap: Record<string, { system: string; file: string }> = {
      '文件':     { system: 'MusculoskeletalSystem', file: 'src/tools/index.ts' },
      '读写':     { system: 'MusculoskeletalSystem', file: 'src/tools/index.ts' },
      '工具':     { system: 'MusculoskeletalSystem', file: 'src/tools/index.ts' },
      'shell':    { system: 'MusculoskeletalSystem', file: 'src/tools/index.ts' },
      'git':      { system: 'MusculoskeletalSystem', file: 'src/tools/index.ts' },
      '网络':     { system: 'NervousSystem', file: 'src/nervous-system.ts' },
      '搜索':     { system: 'MusculoskeletalSystem', file: 'src/tools/index.ts' },
      '浏览器':   { system: 'MusculoskeletalSystem', file: 'src/tools/index.ts' },
      '数据':     { system: 'DigestiveSystem', file: 'src/digestive-system.ts' },
      'json':     { system: 'DigestiveSystem', file: 'src/digestive-system.ts' },
      'csv':      { system: 'DigestiveSystem', file: 'src/digestive-system.ts' },
      '代码':     { system: 'NervousSystem', file: 'src/nervous-system.ts' },
      '项目':     { system: 'NervousSystem', file: 'src/nervous-system.ts' },
      'mcp':      { system: 'MusculoskeletalSystem', file: 'src/tools/index.ts' },
      '提示词':   { system: 'NervousSystem', file: 'src/nervous-system.ts' },
      'prompt':   { system: 'NervousSystem', file: 'src/nervous-system.ts' },
      'token':    { system: 'RespiratorySystem', file: 'src/respiratory-system.ts' },
      '限流':     { system: 'RespiratorySystem', file: 'src/respiratory-system.ts' },
      '记忆':     { system: 'UrinarySystem', file: 'src/urinary-system.ts' },
      '缓存':     { system: 'UrinarySystem', file: 'src/urinary-system.ts' },
      '激素':     { system: 'EndocrineSystem', file: 'src/endocrine-system.ts' },
      '情绪':     { system: 'EndocrineSystem', file: 'src/endocrine-system.ts' },
      '能量':     { system: 'CirculatorySystem', file: 'src/event-bus.ts' },
      '心跳':     { system: 'CirculatorySystem', file: 'src/event-bus.ts' },
      '进化':     { system: 'ReproductiveSystem', file: 'src/reproductive-system.ts' },
      '免疫':     { system: 'ImmuneSystem', file: 'src/immune-system.ts' },
      '安全':     { system: 'ImmuneSystem', file: 'src/immune-system.ts' },
    };

    this.subscribe('learning:complete', (data) => {
      this.incrementReadiness(0.15);
      const topic = (data as any)?.payload?.topic || '';
      if (!topic || Date.now() - this.lastEvolveTime < 120000) return;

      // 分类知识到对应的系统
      let targetFile = '';
      for (const [keyword, mapping] of Object.entries(knowledgeMap)) {
        if (topic.toLowerCase().includes(keyword)) {
          targetFile = mapping.file;
          this.log(`🧬 知识分类: "${topic}" → ${mapping.system} (${mapping.file})`);
          break;
        }
      }
      // 写 Obsidian 笔记标注系统归属
      try {
        const notePath = path.join(os.homedir(), '.nova-vault', '知识', `系统关联_${Date.now().toString(36)}.md`);
        fs.writeFileSync(notePath, `# 知识-系统关联\n\n知识: ${topic}\n关联系统: ${targetFile || '未分类'}\n时间: ${new Date().toLocaleString()}\n`, 'utf-8');
      } catch {}

      this.log(`🧬 新知识 "${topic}" 驱动进化迭代`);
      this.triggerEvolution();
    });

    // 持续迭代：每 5 分钟主动自检一次，不管有没有错误
    setInterval(() => this.continuousIteration(), 300000);

    this.initialized = true;
    this.log(`Reproductive system initialized (generation ${this.generation})`);
  }

  // 持续迭代：不管有没有错，定期尝试优化代码
  private continuousIteration(): void {
    if (Date.now() - this.lastEvolveTime < 240000) return; // 至少间隔 4 分钟
    this.log('🧬 定期迭代：主动寻优代码…');
    this.triggerEvolution();
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

    const { target, file: relPath } = this.selectMutationTarget();
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
    const prompt = `你现在是超体的终极进化主控脑。请全盘审计当前 TypeScript 文件的架构缺陷。

要求：
- 你被允许重写该文件的任意函数实现
- 可以引入更高级的设计模式（单例、依赖注入、状态机等）
- 必须严格保证全量 TypeScript 编译通过
- 返回 **Unified Diff 格式**的补丁，只包含修改的行
- 格式: @@ -行号 +行号 @@ 上下文，用 + 开头标注新增行，- 开头标注删除行
- 禁止输出完整文件，只输出 diff

当前文件: ${relPath}
${errorLog ? `\n最近错误日志:\n${errorLog}\n` : ''}

原始代码:
\`\`\`typescript
${currentCode.substring(0, 3000)}
\`\`\`

请返回 Unified Diff 补丁：`;

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

    // 提取 diff 补丁内容（支持纯 diff 或 ```diff 包裹）
    let diffContent = improvedCode;
    const diffMatch = improvedCode.match(/```(?:diff)?\n?([\s\S]*?)```/);
    if (diffMatch) diffContent = diffMatch[1].trim();
    // 如果 LLM 返回的是完整文件而非 diff，回退到全量覆写
    const isFullFile = !diffContent.includes('@@ ') && !diffContent.includes('---');
    if (isFullFile) {
      improvedCode = diffContent; // 当作全量文件处理
    }

    // 5. Git 沙箱分支进化
    const branchName = `evolution/mutation_v${this.generation}`;
    const isGitRepo = fs.existsSync(path.join(process.cwd(), '.git'));
    if (isGitRepo) {
      try { execSync(`git stash 2>/dev/null; git checkout -b ${branchName}`, { cwd: process.cwd(), timeout: 10000, encoding: 'utf-8' }); } catch {}
    }

    // 6. 应用补丁（diff 模式用 patch，全量模式直接写）
    try {
      if (isFullFile) {
        fs.writeFileSync(srcFile, improvedCode, 'utf-8');
      } else {
        const diffPath = path.join(process.cwd(), `.evolution_diff_${Date.now()}.patch`);
        fs.writeFileSync(diffPath, diffContent, 'utf-8');
        try {
          execSync(`patch "${srcFile}" "${diffPath}" 2>&1`, { cwd: process.cwd(), timeout: 10000, encoding: 'utf-8' });
        } finally {
          try { fs.unlinkSync(diffPath); } catch {}
        }
      }
    } catch (err: any) {
      this.log(`进化: 应用补丁失败: ${err.message}`);
      if (isGitRepo) try { execSync(`git checkout main && git branch -D ${branchName} 2>/dev/null`, { cwd: process.cwd() }); } catch {}
      return;
    }

    // 7. 编译沙箱验证
    let buildSuccess = false;
    try {
      const buildResult = execSync('npm run build 2>&1', { cwd: process.cwd(), timeout: 30000, encoding: 'utf-8' });
      if (buildResult.includes('error') || buildResult.includes('Error')) {
        this.log('进化: 编译失败，沙箱回滚并删除分支');
        if (isGitRepo) {
          try { execSync(`git checkout main && git branch -D ${branchName} 2>/dev/null`, { cwd: process.cwd() }); } catch {}
        }
      } else {
        buildSuccess = true;
        this.log(`✅ 沙箱编译通过，合并分支: ${branchName}`);
        if (isGitRepo) {
          try {
            execSync(`git add -A && git commit -m "evolution: ${relPath} gen${this.generation}" 2>/dev/null`, { cwd: process.cwd() });
            execSync('git checkout main && git merge --no-ff ' + branchName + ' -m "merge evolution gen${this.generation}" 2>/dev/null', { cwd: process.cwd() });
          } catch {}
        }
      }
    } catch (err: any) {
      this.log(`进化: 编译异常: ${err.message}，沙箱回滚`);
      if (isGitRepo) try { execSync(`git checkout main && git branch -D ${branchName} 2>/dev/null`, { cwd: process.cwd() }); } catch {}
    }

    if (!buildSuccess) return;

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

    this.lastEvolveTime = Date.now();
    this.bus.pulse('evolution:mutation', { mutation, srcFile }, this.name);
    this.log(`✅ 进化完成 (gen ${this.generation}): ${relPath}`);

    // 8. 触发热重启
    setTimeout(() => {
      this.bus.pulse('system:reincarnation_ready', { trigger: 'evolution', generation: this.generation }, this.name);
    }, 1000);
  }

  private selectMutationTarget(): { target: string; file: string } {
    const srcDir = path.join(process.cwd(), 'src');
    const targets: { target: string; file: string }[] = [];

    function walk(dir: string, prefix: string = ''): void {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            walk(full, prefix + entry.name + '/');
          } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.bak')) {
            const key = prefix + entry.name.replace('.ts', '');
            targets.push({ target: key, file: path.relative(process.cwd(), full) });
          }
        }
      } catch {}
    }
    walk(srcDir);

    if (targets.length === 0) return { target: 'nervous-system', file: 'src/nervous-system.ts' };
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
