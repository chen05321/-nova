# Nova(超体) 架构总览

## 文件结构

```
nova/
├── src/
│   ├── nova-agent.ts          # 🧠 主控制器 — 启动所有系统
│   ├── event-bus.ts           # ❤️ 循环系统 — 心跳 + 能量 + 事件总线
│   ├── system.ts              # 🔌 系统基类 — 所有系统继承此
│   │
│   ├── nervous-system.ts      # 🧠 神经系统 — LLM调用 + 对话 + 提示词
│   ├── endocrine-system.ts    # 🧪 内分泌系统 — 激素分泌 + 情绪调节
│   ├── respiratory-system.ts  # 🌬️ 呼吸系统 — Token限流 + 能量恢复
│   ├── digestive-system.ts    # 🧬 消化系统 — 知识摄入 + 消化
│   ├── urinary-system.ts      # 🚽 泌尿系统 — 记忆清理 + 毒素过滤
│   ├── musculoskeletal-system.ts # 💪 运动系统 — 工具执行 + 动作协调
│   ├── reproductive-system.ts # 🫄 生殖系统 — 进化 + 变异触发
│   │
│   ├── foraging/              # 🔍 觅食系统 — 主动学习新知识
│   │   └── index.ts
│   ├── learning/              # 📚 学习系统 — 技能树 + 知识图谱
│   │   └── index.ts
│   ├── memory/                # 💾 记忆系统 — JSON持久化存储
│   │   └── index.ts
│   ├── tools/                 # 🛠️ 工具集 — write/read/shell/web
│   │   └── index.ts
│   ├── llm/                   # 🤖 LLM适配器 — DeepSeek/OpenAI/Anthropic
│   │   ├── adapter.ts
│   │   ├── openai-adapter.ts
│   │   ├── anthropic-adapter.ts
│   │   └── deepseek-adapter.ts
│   ├── mcp/                   # 🔌 MCP插件 — 浏览器控制等
│   │   └── client.ts
│   ├── config/                # ⚙️ 配置系统 — Key管理 + 模型配置
│   │   └── index.ts
│   ├── cli/                   # 💻 CLI入口
│   │   └── index.ts
│   └── dashboard/             # 📊 看板 — HTML界面 + 状态服务器
│       ├── dashboard.html
│       └── status-server.ts
│
├── superbody.mcp.json         # MCP配置文件(puppeteer)
├── nova.config.example.json   # 配置示例
├── package.json               # 依赖管理
└── tsconfig.json              # TypeScript配置
```

## 八大系统通信方式

所有系统通过 **CirculatorySystem（事件总线）** 通信。

```
NervousSystem → pulse('input:raw') → 收到消息
              → pulse('thought:complete') → LLM回复完毕
              → pulse('thought:chunk') → 流式输出片段

EndocrineSystem → pulse('hormone:shift') → 激素变化
                → 监听 'respiratory:limit' → 呼吸受限时分泌皮质醇
                → 监听 'system:error' → 错误时分泌肾上腺素

RespiratorySystem → pulse('respiratory:limit') → 能量不足
                  → 监听 '*' → 每次事件消耗token

DigestiveSystem → 监听 'input:raw' → 摄入知识
                → 监听 'learning:new' → 学习新知识
                → pulse('knowledge:assimilated') → 消化完成

MusculoskeletalSystem → 监听 'thought:ready' → 准备执行动作
                      → pulse('action:completed') → 动作完成
                      → pulse('action:failed') → 动作失败

UrinarySystem → 监听 'memory:store' → 收到记忆
              → 定时每15秒过滤清理
              → pulse('urinary:toxic') → 毒素过高

ReproductiveSystem → 监听 'urinary:toxic' → 触发进化
                   → 监听 'system:error' → 累计进化值
                   → 监听 'action:failed' → 累计进化值
                   → pulse('evolution:mutation') → 执行变异
```

## 数据流 (一次完整对话)

```
你输入消息
  ↓
NervousSystem.processPerception()
  ├── 消耗能量 (3)
  ├── 增加认知负载
  ├── 添加对话历史
  ├── LLM.chatStream() → 流式输出
  │   └── pulse('thought:chunk') → 看板显示
  ├── 检查是否包含 TOOL: 指令
  │   ├── 是 → executeToolByName()
  │   │   ├── 读取工具 → 获取结果
  │   │   ├── LLM再次调用 → 解释结果
  │   │   └── 合并最终响应
  │   └── 否 → 直接使用LLM回复
  ├── pulse('thought:complete')
  ├── extractFacts() → 提取记忆
  ├── pulse('memory:store') → 泌尿系统处理
  └── 产生能量 (2)
```

## 启动顺序

```
NovaAgent.boot()
  ├── 创建7个System实例
  ├── 逐个调用 init()
  ├── 设置成长阶段(GrowthStage)
  ├── 启动心跳(Heart)
  ├── 启动觅食(ForagingSystem) → 每60秒
  ├── 启动学习(SelfLearningSystem) → 每5分钟
  └── 启动完成
```

## 关键概念

| 概念 | 说明 |
|:----|:------|
| 能量 (Energy) | 0-100，耗尽会进入节能模式，通过呼吸+行动恢复 |
| 认知负载 | 每段对话增加，回复成功降低，>0.8进入压力状态 |
| 激素 | 肾上腺素/皮质醇/多巴胺/血清素/催产素，影响模型选择和回复风格 |
| 毒素 | 记忆积累产生，泌尿系统定期清理，>0.8触发紧急清理 |
| 成长阶段 | NEWBORN→CHILD→ADOLESCENT→ADULT→MATURE→ELDER→重生 |
| 智慧值 | 通过学习、进化、升级积累，重生保留30% |
