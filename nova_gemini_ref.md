# Nova (超体) 完整改方案 — 给 Gemini 的参考文档

## 一、现状总结

Nova 是一个基于人体 8 大系统隐喻的 AI Agent 框架，当前 v5.8。功能丰富但架构上缺少方法论指导。

### 核心矛盾

功能做得很多（8系统、Obsidian记忆库、自进化、看板、元认知），但：
1. 没有系统性的代码审计机制
2. 看板组件缺少 loading/empty/error 态覆盖
3. 记忆检索只有关键词匹配，无向量语义搜索
4. 工具扩展缺少 Manifest 声明式注册
5. 自进化链路通了但缺少自动触发

---

## 二、缺陷清单

### P0 — 影响核心体验

| 缺陷 | 表现 | 涉及文件 |
|:----|:-----|:---------|
| **无向量检索** | `searchNotes()` 只做关键词匹配，"Python异步"搜不出"asyncio" | `src/memory/obsidian.ts` |
| **看板组件只有 data 态** | Tasks/Upgrades 面板无数据时白屏 | `src/dashboard/dashboard.html` |
| **MCP 工具链未完全打通** | 主对话可能无法调用 MCP 注册的工具 | `src/agent-loop/index.ts` |
| **学习系统依赖外网 API** | Wikipedia/GitHub 不稳定时学不到东西 | `src/learning/index.ts` |

### P1 — 影响架构健壮性

| 缺陷 | 表现 | 涉及文件 |
|:----|:-----|:---------|
| **系统初始化硬编码** | `boot()` 里 7 个系统逐个 init，顺序写死 | `src/nova-agent.ts` |
| **工具无 Manifest** | Tool 只有 name/description/execute，缺少 version/errorCodes | `src/tools/index.ts` |
| **事件监听无登记** | 不知道哪些系统 subscribe 了什么事件 | 全局 |
| **记忆无限增长** | 旧会话不自动清理，磁盘占用增长 | `src/memory/index.ts` |
| **进化缺自动触发** | 需要人告诉它才改代码 | `src/nova-agent.ts` |

### P2 — 细节优化

| 缺陷 | 表现 | 涉及文件 |
|:----|:-----|:---------|
| shell 工具超时固定 15s | 大安装包超时 | `src/tools/index.ts` |
| 系统提示词部分仍偏硬 | 激素/能量状态每次都注入，不够优雅 | `src/nervous-system.ts` |

---

## 三、整改路线方案

### 阶段一：架构硬化

1. **向量记忆检索** — 引入 `@xenova/transformers` 做本地 Embedding
   - 新文件: `src/memory/vector.ts`
   - 改动: `src/memory/obsidian.ts` 增加 `semanticSearch()`
   - 效果: 语义搜索取代关键词匹配

2. **看板四态覆盖** — 每个数据组件补 loading/empty/error 态
   - 改动: `src/dashboard/dashboard.html` JS
   - 模板: renderUpgrade() 已实现 empty 态，tasks/tools 同理

3. **MCP 工具链验证** — 确认 `superbody.mcp.json` 配置的 puppeteer 工具能正常在主对话中使用

### 阶段二：自进化闭环

4. **自动触发进化** — 生殖系统 `evolutionReadiness > 0.9` 时自动：
   - 读 Obsidian 错题本
   - 选频率最高的缺陷
   - 定位对应 src/ 文件
   - 生成修复补丁
   - write 覆写 → npm run build → 热重启

5. **系统初始化注册表** — Manifest 声明式注册，自动排序依赖

### 阶段三：体验优化

6. **动态工具超时** — 根据命令类型调整 shell 超时
7. **记忆自动归档** — 超出 N 条自动压缩旧会话

---

## 四、代码结构

```
nova/
├── src/
│   ├── cli/index.ts                  # CLI 入口
│   ├── nova-agent.ts                 # 主控制器
│   ├── nervous-system.ts             # 神经系统 (LLM + 元认知)
│   ├── event-bus.ts                  # 循环系统 (心跳 + 事件总线)
│   ├── system.ts                     # 系统基类
│   ├── endocrine-system.ts           # 内分泌系统
│   ├── respiratory-system.ts         # 呼吸系统
│   ├── digestive-system.ts           # 消化系统
│   ├── urinary-system.ts             # 泌尿系统
│   ├── musculoskeletal-system.ts     # 运动系统
│   ├── reproductive-system.ts        # 生殖系统
│   ├── types.ts                      # 类型定义
│   ├── tools/index.ts                # 工具集 (write/read/shell/web + ToolRegistry)
│   ├── memory/
│   │   ├── index.ts                  # JSON 记忆存储 + Obsidian 集成
│   │   └── obsidian.ts              # Obsidian 记忆库读写
│   ├── learning/index.ts             # 学习系统 (自动写 Obsidian 笔记)
│   ├── foraging/index.ts             # 觅食系统
│   ├── agent-loop/index.ts           # 自主任务
│   ├── llm/ (adapter.ts, deepseek-adapter.ts, openai-adapter.ts, anthropic-adapter.ts)
│   ├── config/index.ts               # 配置
│   ├── mcp/client.ts                 # MCP 插件
│   └── dashboard/
│       ├── status-server.ts          # 看板 API
│       └── dashboard.html            # 前端
├── NOVA_METHODOLOGY.md               # 方法论 (新)
├── NOVA_PLAN.md                      # 架构方案 (新)
├── nova.config.example.json
├── superbody.mcp.json
└── package.json
```

## 五、API 接口总览

| 端点 | 方法 | 功能 |
|:----|:----:|:----|
| `/api/status` | GET | 全系统状态 |
| `/api/control/config` | GET | 读取配置 |
| `/api/control/config/save` | POST | 保存配置并重启 |
| `/api/control/model` | POST | 切换模型模式 |
| `/api/control/physiology` | POST | 休眠/排毒 |
| `/api/control/upgrade` | POST | 安装升级芯片 |
| `/api/input` | POST | 发送消息 |
| `/api/session/new` | POST | 新建会话 |
| `/api/chat/history` | GET | 对话历史 |
| `/api/convs` | GET | 会话列表 |
| `/api/conv/switch` | POST | 切换会话 |
| `/api/tasks` | GET | 任务列表 |
| `/api/task/add` /done /del | POST | 任务管理 |
| `/api/opencode-key` | GET | 导入 OpenCode 凭证 |
| `/api/biometrics-stream` | SSE | 实时体征推送 (2s/次) |
| `/api/event-bus-pulse` | SSE | 事件流推送 (含 isReasoning 标签) |

数据存储:
- `~/.nova-memory/memory.json` — 对话历史 + 事实
- `~/.nova-vault/` — Obsidian 知识库
- `~/.nova/.env` — API Key
- `~/.nova/tasks.json` — 任务列表
