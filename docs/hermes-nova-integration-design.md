# Hermes × Nova 融合架构设计

> **设计日期：** 2026-05-18
> **作者：** Hermes Agent（外脑/助手）
> **版本：** v1.0

---

## 一、核心洞察

### 1.1 Nova 的真实面貌

第一次评估错误——Nova **不是空心玩具**。它拥有完整且优秀的框架：

| 能力 | 状态 |
|------|------|
| 自治调度循环（agent loop） | ✅ 最多10次迭代，带重试+超时 |
| 工具系统 | ✅ readFile / writeFile / shell / webFetch / MCP |
| 自改源码 + 热重启 | ✅ execSync build → process.exit(0) |
| 技能树 | ✅ 12个技能分类，15个子技能，依赖关系图 |
| 学习循环（learnCycle） | ✅ **存在**，但实现是哑的 |
| 元认知审查 | ✅ LLM自检幻觉 → 阻断死循环 |
| 8大系统隐喻（神经系统/消化系统等） | ✅ 架构隐喻完整 |

### 1.2 Nova 的（唯一）问题：学习引擎假学

问题很集中——就在 `learnCycle()` 里：

```
learnCycle()
  ├─ pickNextSkill() → 找前置满足的技能
  ├─ discoverTopic() → research()
  │   └─ Wikipedia API（只拿summary，不调deepseek）
  ├─ practice()
  │   └─ 硬编码 "Practice存根正常"（不写代码/不跑测试）
  └─ evolveSkill() → 写技能树标记 learned
      └─ keyword overlap 匹配就声称学会
```

**已有工具（shellTool / writeFileTool / webFetchTool）完全未在学习循环中使用。**

### 1.3 Hermes 的定位

| 能力 | Nova缺什么 | Hermes能给什么 |
|------|-----------|---------------|
| 实时搜索 | Wikipedia 只能读百科 | web_search + web_extract |
| 浏览器互动 | 无 | 浏览器控制 |
| 代码执行验证 | practice() 硬编码 | execute_code → shellTool |
| 代码质量审查 | 无 | diff_review |
| 视觉理解 | 无 | vision_analyze |
| 飞书消息收发 | 无 | 飞书网关 |
| 持久化记忆/知识库 | 知识图谱静态 | Holographic Memory + Obsidian |

---

## 二、架构方案

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        飞书（Feishu）统一消息层                        │
│                   你可以同时跟两者说话，也能私聊                         │
└──────────┬────────────────────────────────────┬──────────────────────┘
           │                                    │
           ▼                                    ▼
┌──────────────────────┐          ┌──────────────────────────────┐
│   Nova（骨架/身体）    │          │   Hermes Agent（外脑/皮层）    │
│                      │          │                              │
│  ● 自治循环(agent     │  MCP     │  ● web_search / web_extract │
│    loop) + 工具系统    │◄───────►│  ● browser 控制             │
│  ● 自改源码+热重启     │          │  ● code_execute + terminal  │
│  ● 学习循环(learn     │          │  ● vision_analyze           │
│    Cycle) + 技能树    │          │  ● 飞书消息                 │
│  ● 8大系统架构         │          │  ● 记忆/知识库存取           │
│  ● 能量/激素/代谢系统   │          │  ● 代码审查(diff_review)    │
│  ● Vite Dashboard     │          │                              │
└──────────────────────┘          └──────────────────────────────┘
```

**核心原则：Nova 的框架 + Hermes 的能力 = 真正的AI进化体**

### 2.2 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 通信方式 | **MCP 协议** | Nova已有MCP插件，零代码改动，即插即用 |
| Hermes修改范围 | **zero Nova代码改动** | Hermes作为MCP Server独立运行，Nova只改config |
| 学习方向 | **定向学习 vs 随机Wikipedia** | 用户指定领域→Hermes搜索→代码验证→Nova技能树 |
| 消息层 | **飞书统一** | 用户在飞书跟我对话，同时看到Nova的日志/报告 |
| 源码存放 | **Hermes Obsidian vault** | 设计文档、协议、架构图存 ~/AI-Knowledge/ |

### 2.3 MCP Server注册拓扑

```
Nova MCP Plugin
       │
       ▼
Hermes MCP Server (localhost:8899)
       │
       ├── tool: hermes_search(query, limit)     → web_search
       ├── tool: hermes_extract(url)             → web_extract
       ├── tool: hermes_execute(code, language)  → execute_code
       ├── tool: hermes_terminal(cmd)            → terminal
       ├── tool: hermes_vision(image_url)        → vision_analyze
       ├── tool: hermes_browser(url, action)     → browser
       ├── tool: hermes_code_review(diff)        → diff_review
       ├── tool: hermes_memory(action, content)  → fact_store
       └── tool: hermes_feishu_send(msg)         → send_message
```

设计理由：MCP 是唯一**无需改 Nova 一行代码**的方案。Nova 已有 MCP plugin resolver，只要用 `npx @anthropic/mcp-serve` 或类似工具跑起来，在 Nova config 里注册 endpoint 即可。

---

## 三、升级路径（Phase 1 → Phase 3）

### Phase 1：让 Nova 真的会学（重构 learnCycle）

**目标**：Nova 的学习不再是 Wikipedia + 存根，而是 Hermes 驱动的真实学习

**改动点**（仅改 `dist/learn-cycle.js` 或 `src/`）：

```
原 learnCycle():
  research() → Wikipedia API → 写知识图谱
  practice() → console.log("存根正常") → 写技能树

新 learnCycle():
  hermesResearch() → 调 Hermes MCP
    ├─ hermes_search(领域) → 获取真实资料
    ├─ hermes_extract(URLs) → 读文档/代码/文章
    └─ 写回 Nova 知识图谱 (原有的 writeKnowledge)

  hermesPractice() → 调 Hermes MCP
    ├─ 生成真实练习代码
    ├─ 通过 shellTool 执行验证
    ├─ 通过 hermes_code_review 审查
    └─ 结果写回技能树
```

**好处**：Nova 的自进化框架（自改源码、热重启、技能依赖链）全部保留。只替换"学什么"和"怎么练"。Hermes MCP 只改 learnCycle，agent loop、工具系统、能量代谢全部不动。

### Phase 2：技能树定向激活

**目标**：按用户的需求定向激活技能，不是随机学

**原流程**：`pickNextSkill()` → 选前置满足的任意技能

**新流程**：
1. 用户/助手指定领域（如"前端开发"、"漏洞挖掘"、"视频生产"）
2. Hermes 搜索该领域真实技能栈
3. 映射到 Nova 技能树节点
4. 按依赖图顺序激活学习
5. 每个技能学习后通过真实任务验证

**效果**：Nova 的 15 个技能不再是"标记 learned = true"的虚数，而是真实具备了对应能力。

### Phase 3：Nova 做我的"持久化体"

**目标**：Hermes 的上下文（思考链、决策记录、项目状态）写入 Nova 的体验系统

**现状**：Hermes每次会话清空上下文，无法跨session推理

**新流程**：
1. Hermes 每次复杂推理 → `hermes_memory('add', 内容)` → Nova experiences.json
2. Nova 的 Nervous System 负责管理这些经验的优先级和遗忘
3. 下次会话时 Hermes 拉取 ==Nova== 的经验作为上下文
4. 形成闭环：Hermes 思考 → Nova 记忆 → Hermes 拉取继续思考

---

## 四、为什么这个设计对

### 4.1 各司其职，不重复造轮子

```
Nova（留）：                 Hermes（加）：
  ├─ 自治调度循环               ├─ 搜索/提取能力
  ├─ 自改源码 + 热重启          ├─ 代码执行和审查
  ├─ 技能树 + 知识图谱          ├─ 浏览器交互
  ├─ 能量/激素/代谢系统         ├─ 视觉理解
  ├─ CUI + Dashboard           ├─ 飞书消息
  └─ MCP 插件 → 我们的入口       └─ 持久化记忆
```

Nova 做得好的框架层不动，Hermes 补它缺的能力层。**不改框架改填充。**

### 4.2 修改量最小

- **Nova 代码改动**：仅 `learnCycle()` 中的 `research()` 和 `practice()` 两个函数
- **Hermes 改动**：新增 MCP Server 包装层（~200行 Python）
- **TypeScript 支持**：零改动，MCP 是跨语言的

### 4.3 可逆 + 可观测

- MCP Server 可以随时断开/重连
- Nova 原有 Wikipedia 学习路径保留（作为 fallback）
- 所有 Hermes 调用都有完整日志

---

## 五、风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| MCP 协议不兼容 | 低 | Nova 的 MCP plugin resolver 支持 stdio 和 HTTP；不行就用 HTTP |
| Nova 自改代码覆盖 MCP config | 中 | 把 MCP 注册写进 config 的"受保护段" |
| 学习循环调用 MCP 超时 | 中 | agent loop 有重试+超时（共30s，每次10s） |
| Nova 重新编译后 MCP config 丢失 | 低 | 修改 build 脚本或 config 写死 |
| 用户不想要 Nova 了 | 低 | MCP Server 一关，Hermes 独立运行自如 |

---

## 六、待确认事项

以下需要找参谋确认：

1. **MCP 方案 vs WebSocket 方案**：MCP 是最干净的方式，但 Nova 的 MCP plugin resolver 是否支持 HTTP 模式？能否稳定解析 SSE/stdio？
2. **Nova 的 learnCycle 调用外部工具的权限**：当前 learnCycle 只有 Wikipedia API 调用，直接增加调 child_process/MCP 是否有安全或架构限制？
3. **热重启稳定性**：Nova 自改后重新编译 + execSync build → process.exit() → 进程重启 = pm2/supervisor 兜底？还是需要加自重启逻辑？
4. **飞书作为统一消息层**：Nova 原生没有消息系统，能不能接受飞书同时是：① 用户 → Nova的输入 ② Nova → 用户的输出 ③ Hermes → 用户的中介日志？

---

## 附录：关键代码路径

### Nova 关键文件

| 文件 | 功能 | 是否需要改 |
|------|------|-----------|
| `dist/cli/index.js` | 入口点 | ❌ 不改 |
| `dist/nova-agent.js` | Agent 主循环 | ❌ 不改 |
| `dist/learn-cycle/index.js` | learnCycle | ✅ 需要改 research() + practice() |
| `dist/tools/index.js` | 工具系统 | ❌ 不改（已有 shellTool 够用） |
| `dist/tools/mcp-plugin.js` | MCP 插件 | ✅ MCP 配置 |
| `dist/agent-loop/index.js` | 工具循环 | ❌ 不改 |
| `dist/nervous-system.js` | 神经系统 | ❌ 不改 |
| `dist/foraging/index.js` | 觅食系统 | ✅ 已改 endpoint + model |

### Hermes 需要新增

| 文件 | 功能 |
|------|------|
| `mcp_server.py` | MCP Server 主入口，注册所有 Hermes 工具 |
| `nova_adapter.py` | Nova 专用适配器（格式化输入输出） |
| `config/mcp_config.yaml` | Nova MCP 配置模板 |

---

*此文档存于 ~/AI-Knowledge/ 和桌面备份*
