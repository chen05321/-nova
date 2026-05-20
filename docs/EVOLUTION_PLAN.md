# Nova 四步进化执行方案

## 总纲

在不依赖 Hermes 的前提下，让 Nova 原生达到甚至超越 Hermes 的能力。
每步独立可测，互不阻塞。

---

## 第一步：脑核重构（树状规划）

**目标**：把 NervousSystem 从"死循环 ReAct"升级为"先规划后执行"

**改动文件**：`src/nervous-system.ts`

**具体做法**：
1. 收到用户输入后，先用 Deep 模型做一次任务拆解
2. 拆解结果写入 `conversationHistory` 作为执行计划
3. 然后按计划逐步执行工具
4. 某条路径失败时自动回溯，不走回头路

**工作量**：中
**可测性**：对话时看板能看到"🧠 规划中..."然后按计划执行

---

## 第二步：肉身夺舍（工具增强）

### 2a. 网络硬检索

**目标**：webFetchTool 不再死等 Wikipedia，集成 Google/Tavily

**改动文件**：`src/tools/index.ts`

**具体做法**：
- 新增 `searchTool`，调用 Tavily API（免费额度）
- 如果没配置 API Key，降级到现有的 Wikipedia fallback

**工作量**：小
**可测性**：`nova，搜索一下最新的 TypeScript 新闻`

### 2b. 代码沙箱

**目标**：学习后必须跑通测试代码才能标记 `learned = true`

**改动文件**：`src/learning/index.ts`

**具体做法**：
- learnCycle 中的 practice() 改为写入 `/tmp/*.test.ts`
- 用 `npx tsx` 执行，Exit Code 0 才算通过
- 编译失败 → 重试修正 → 3 次不过才降级

**工作量**：中
**可测性**：学习日志会显示 `🧪 代码沙箱: Exit 0 ✓` 或 `Exit 1 ✗`

---

## 第三步：记忆革命（向量检索）

**目标**：用语义搜索取代关键词匹配

**改动文件**：`src/memory/vector.ts`（新建）

**具体做法**：
1. 安装 `@xenova/transformers` 
2. 新文件 `vector.ts` 提供 `embed(text)` 和 `semanticSearch(query, notes)`
3. 每次写 Obsidian 笔记时自动生成向量
4. `buildContextPrompt()` 改为语义检索

**工作量**：中
**可测性**：搜"异步编程"能找出"asyncio 协程"的笔记

---

## 第四步：解禁宿主（真·自进化）

**目标**：生殖系统不再自嗨，真正修改代码并重启

**改动文件**：`src/reproductive-system.ts`、`src/nova-agent.ts`

**具体做法**：
1. evolutionReadiness > 0.9 时自动触发
2. 读取 Obsidian 错题本
3. 用 Deep 模型生成修复代码
4. 调用 writeFileTool 覆写 src/ 文件
5. 调用 shellTool 执行 npm run build
6. 编译成功则 process.exit(0) 重启

**工作量**：大
**可测性**：看板显示"🧬 自我进化中..."然后服务重启

---

## 执行顺序

```
Step 1 (脑核) ──────────────┐
                             ├──→ 可独立运行
Step 2a (网络搜索) ──────────┘

Step 2b (代码沙箱) ──────────┐
                             ├──→ 依赖 Step 1
Step 3 (向量记忆) ───────────┘

Step 4 (自进化) ───────────── → 依赖全部前置
```

建议：先做 Step 1 + Step 2a（本周能跑），再 Step 2b + Step 3，最后 Step 4。
