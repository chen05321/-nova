# Nova 方法论（心法）

> **先成方法论，后写代码。心法对了，错就少了。**

---

## 核心洞察

Nova 是一个**有生命感的 AI 框架**，不是"又一个 LLM 包装器"。8 大系统不是装饰——每行代码都在模拟真实生命体的运转逻辑。

---

## A. 架构方法论

### A1. 事件驱动，系统解耦

**原则：** 所有系统通过 `CirculatorySystem`（事件总线）通信，绝不直接调用。

```
✅ NervousSystem → pulse('thought:complete')
   MusculoskeletalSystem → 监听 'tool:register'
   EndocrineSystem → 监听 'hormone:shift'

❌ nervousSystem.doSomething()  ← 直接调用其他系统
```

Nova 已经做到了这一点——所有系统继承 `System` 基类，通过 `subscribe()` 监听事件。

### A2. Registry 模式

**原则：** 需要扩展的东西统一注册，不分散 import。

Nova 已有的实现：
- `ToolRegistry` — `src/tools/index.ts` 的全局单例
- 工具在 CentralRegistry 注册，NervousSystem 通过 `ToolRegistry.find(name)` 查找

需要改进的地方：
- 系统的生命周期钩子没有注册表（init 顺序硬编码在 `nova-agent.ts` 的 `boot()` 里）
- 事件监听没有清单（什么时候 subscribe 了什么，没有中心化登记）

### A3. Manifest-First

**原则：** 任何新工具/系统/模块，先定义声明式元数据，再写实现。

```typescript
// ✅ Nova 已有的 Tool interface 就是 Manifest
interface Tool {
  name: string;        // 唯一标识
  description: string; // 用途说明
  execute(args: Record<string, string>): Promise<ToolResult>;
}

// 需要扩展：给 Tool 加 version, author, errorCodes 字段
```

---

## B. 组件设计方法论

### B1. 四态覆盖

**原则：** 每一个向用户展示数据的组件，必须处理四种状态：

| 状态 | 含义 | 渲染 |
|------|------|------|
| loading | 请求中 | 骨架屏/加载动画 |
| empty | 数据为空 | "暂无" + 操作引导 |
| error | 请求失败 | 错误信息 + 重试 |
| data | 有数据 | 真实内容 |

Nova 看板的短板：大部分组件只处理了 data 态。`upgrade-shop`、`tasks-list` 在空数据时白屏。

### B2. 接口先行

**原则：** 函数/组件先写类型定义，再写实现。类型定义就是文档。

```typescript
// ✅ 正确
interface ToolResult { success: boolean; output: string; error?: string; }
function executeTool(name: string, args: Record<string, string>): Promise<ToolResult>

// ❌ 错误：any 满天飞
function doStuff(data: any): any
```

Nova 大部分代码符合这个原则，但 `dashboard.html` 的 JS 全是 var + 无类型（历史遗留——但前端没必要上 TypeScript，保持轻量即可）。

---

## C. 错误处理方法论

### C1. 层级兜底

**原则：** 错误在不同层级捕获，每层处理自己能处理的，剩下的往上抛。

Nova 现有的三层防护：
```
Layer 1: deepseek-adapter.ts 外层 try/catch     → 网络错误 → "[连接错误] ..."
Layer 2: nervous-system.ts .catch()              → 流中断 → resolveStream()
Layer 3: cli/index.ts unhandledRejection         → 漏网之鱼 → 打印日志不崩溃
```

✅ 已经做得很好了。保持。

### C2. 元认知闭环

**原则：** 工具执行出错后主动审查、写错题本、下次避开。

Nova 已有的实现：
```
工具调用 → 元认知审查 [FAIL]? → 写 Obsidian 错题本 → 强制修正重试
```

✅ 这是 Nova 独有的优势，Hermes 没有。

---

## D. 工作流方法论

### D1. 渐进式自进化

**原则：** Nova 不依赖外部 CI/CD。进化流程：

```
自检 → 读源码 → 发现问题 → 生成补丁 → write 覆写 → npm run build → 热重启
```

现在已具备全部链路，但缺少**自动触发机制**——需要有人告诉它"去改你的代码"。

下一步：让生殖系统在 evolutionReadiness > 0.9 时自动触发完整自进化闭环。

### D2. 学到的即笔记

**原则：** 任何新知识必须落盘为 markdown，存入 `~/.nova-vault/`。

```
后台学习 → 提炼摘要 → 写 Obsidian 笔记 → 标注双向链接 → 下次检索可用
```

✅ 已经在 `learning/index.ts` 和 `memory/obsidian.ts` 实现。

---

## E. Pitfalls 系统

### E1. 已踩过的坑（不要再重复）

| # | 坑 | 教训 | 修复方式 |
|---|----|------|---------|
| 1 | `setInterval` 不 await async | 用递归 `setTimeout` 替代 | `scheduleLearnCycle()` |
| 2 | `write` 工具参数名歧义 | 同时兼容 `path` 和 `file` | `args.file \|\| args.path` |
| 3 | shell 安全白名单锁死 | 改用黑名单（只拦截 rm -rf /） | 移除 safePrefixes |
| 4 | DeepSeek JSON 包裹 ```json | 正则兼容反引号包裹 | `[\s\S]*?ARGS:\s*(?:`{3}...)?(\{...)` |
| 5 | `ToolRegistry` 初始化顺序 | 先定义 tool 再 `new CentralRegistry()` | 挪到文件末尾 |
| 6 | `slice(-10)` 截断历史 | 改为全量发送 | 去掉 slice |
| 7 | `reasoning_content` 污染正文 | 用 `isReasoning` 标签分流 | 只更新跑马灯不追加气泡 |
| 8 | 历史脏记忆带偏行为 | 加载时正则清洗 | `purgeConversationalFluff()` |
| 9 | 学习静默失败 | 事件总线发 `learning:cycle` 信号 | 看板可见学习状态 |
| 10 | 网络中断丢内容 | 自动重试 3 次 + 丢弃半截内容 | retry loop |

### E2. 当前已知未修复的坑

| # | 坑 | 影响 | 优先级 |
|---|----|------|:------:|
| 1 | 无向量检索，记忆靠关键词匹配 | 知识召回不准 | P0 |
| 2 | 学习依赖 Wikipedia/GitHub API | 网络不稳时学不到东西 | P1 |
| 3 | shell 工具超时固定 15s | 大安装包可能超时 | P2 |
| 4 | 会话记忆无限增长无自动清理 | 磁盘占用越来越大 | P2 |
