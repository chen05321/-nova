# Nova (超体) 整改清单 & 当前状态 (v5.7)

## 🟢 当前能力

| 模块 | 状态 | 说明 |
|:----|:----:|:-----|
| 对话 + LLM 推理 | ✅ | Fast/Reflective/Deep 三档，激素驱动切换 |
| 文件读写 (write/read) | ✅ | 兼容 path/file 双参数，文件句柄防泄露 |
| Shell 命令执行 | ✅ | 15s 超时，仅拦截 rm -rf / 等危险命令 |
| Web 网页抓取 | ✅ | 8s 超时，自动清洗 HTML 标签 |
| 全息控制舱看板 | ✅ | v5.6 三面板可折叠，SSE 流式推送 |
| 8 大系统生命模拟 | ✅ | 心跳/能量/激素/废物/排毒 |
| 多会话管理 | ✅ | 新建/切换/清理 |
| 激素驱动 LLM 参数 | ✅ | 肾上腺素/多巴胺/皮质醇影响 temperature |
| 元认知反思 | ✅ | 工具调用后审查 [FAIL]/[PASS] |
| 内心独白过滤 | ✅ | `<inner_monologue>` 落盘前剥离 |
| reasoning_content 分流 | ✅ | DeepSeek 思维流只更新跑马灯，不污染气泡 |
| 多模型接入 | ✅ | DeepSeek / OpenAI / Anthropic / Gemini 等 |
| **Obsidian 记忆库** | ✅ | **`~/.nova-vault/` markdown 笔记存储，支持双向链接** |
| **学习自动入库** | ✅ | **技能解锁/知识捕获时自动写 Obsidian 笔记 + 关联链接** |
| **混合检索** | ✅ | **标题权重 ×50 + 内容词频 ×2 的密度评分算法** |
| 全局崩溃保护 | ✅ | unhandledRejection 兜底 + try/catch 多层防护 |

## 🔴 已知缺陷

| 缺陷 | 原因 | 优先级 |
|:----|:-----|:------:|
| **没有向量检索** | 知识检索靠关键词密度评分，无语义搜索 | P0 |
| **不能自修改代码** | 进化系统只改数字，不写代码 | P1 |
| **学习依赖外网 API** | Wikipedia/GitHub 不稳定 | P1 |
| **工具超时固定 15s** | 大安装包可能超时 | P2 |
| **记忆无限增长** | 无自动归档清理机制 | P2 |
| **人格进化是假的** | 只随机漂移数字，不真正进化能力 | P1 |

## 🔧 整改路线

### P0 — 马上该做的

1. **向量检索** — 引入本地 Embedding 模型，Obsidian 笔记做语义索引
2. **知识图谱在 Obsidian 里可视化** — 笔记已写好 `[[双向链接]]`，打开 Obsidian 图谱即可

### P1 — 下一步

3. **真自我进化** — 允许 Nova 读写自身源码 + 编译重启（`write` 改 `src/` → `npm run build` → 热重启）
4. **学习系统加固** — 本地缓存 + 多源降级

### P2 — 远期

5. **动态工具超时** — 根据命令类型动态调整
6. **记忆自动归档** — 超出 N 条自动压缩旧会话

## 📁 代码结构

```
nova/src/
├── cli/index.ts                  # CLI 入口
├── nova-agent.ts                 # 主控制器
├── nervous-system.ts             # 神经系统 — LLM + 元认知
├── event-bus.ts                  # 循环系统 — 心跳 + 能量
├── system.ts                     # 系统基类
├── endocrine-system.ts           # 内分泌系统
├── respiratory-system.ts         # 呼吸系统
├── digestive-system.ts           # 消化系统
├── urinary-system.ts             # 泌尿系统
├── musculoskeletal-system.ts     # 运动系统
├── reproductive-system.ts        # 生殖系统
├── types.ts                      # 类型定义
├── tools/index.ts                # 工具集 + ToolRegistry
├── memory/
│   ├── index.ts                  # 记忆存储 + Obsidian 集成
│   └── obsidian.ts               # Obsidian 记忆库读写 + 密度检索
├── learning/index.ts             # 学习系统（自动写笔记到 Obsidian）
├── llm/                          # LLM 适配器
├── config/index.ts               # 配置系统
├── agent-loop/index.ts           # 自主任务
├── foraging/index.ts             # 觅食系统
├── mcp/client.ts                 # MCP 插件
└── dashboard/
    ├── status-server.ts          # 看板 API
    └── dashboard.html            # 前端 v5.6
```

## 🔌 API 接口

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
| `/api/biometrics-stream` | SSE | 实时体征推送 |
| `/api/event-bus-pulse` | SSE | 事件流推送 |
