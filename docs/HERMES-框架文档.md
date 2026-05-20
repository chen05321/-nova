# HERMES 框架 — 基于人体8大系统的自进化AI架构

> Hermes 是一个以人类8大系统为隐喻的 TypeScript 框架，让 AI Agent 能够像生命体一样自我成长、自我进化。

---

## 架构总览

```
┌─────────────────────────────────────────────────┐
│                  HermesAgent                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Nervous  │  │ Musculo- │  │ Endocrine│       │
│  │  System  │  │ skeletal │  │  System  │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │             │
│  ┌────┴──────────────┴──────────────┴────┐        │
│  │        CirculatorySystem              │        │
│  │          (Event Bus)                  │        │
│  └────┬──────────────┬──────────────┬────┘        │
│       │              │              │             │
│  ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐       │
│  │Respira-  │  │ Digestive│  │ Urinary  │       │
│  │tory Sys. │  │  System  │  │  System  │       │
│  └──────────┘  └──────────┘  └──────────┘       │
│  ┌──────────────────────────────────────────┐    │
│  │          ReproductiveSystem               │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

---

## 8大系统详解

### 1. 🧠 神经系统 (NervousSystem) — `nervous-system.ts`

**生物映射**：大脑、脊髓、神经元网络
**软件功能**：核心推理、决策、感知处理

- 接收 `input:raw` 事件感知外部输入
- 监听 `hormone:shift` 事件，激素影响推理模式（快速/反思/深度）
- `cognitiveLoad` 追踪认知负载，超阈值进入"压力"状态
- 支持三种模型选择模式：肾上腺素→快速、多巴胺→反思、皮质醇→保守

**事件流**：
```
input:raw → thought:perceived → thought:ready
```

---

### 2. 💪 运动系统 (MusculoskeletalSystem) — `musculoskeletal-system.ts`

**生物映射**：肌肉、骨骼、运动神经元
**软件功能**：工具调用、动作执行

- 管理工具注册表（`Map<string, ToolDefinition>`）
- 监听 `thought:ready` 执行动作
- 追踪每个工具的使用次数和成功率
- `findBestTool()` 算法：相关性权重60% + 成功率权重40%

**事件流**：
```
thought:ready → executeAction → action:completed / action:failed
```

---

### 3. 🧪 内分泌系统 (EndocrineSystem) — `endocrine-system.ts`

**生物映射**：腺体、激素
**软件功能**：状态调控、行为调节

| 激素 | 基线 | 衰减率 | 触发条件 | 效果 |
|------|------|--------|---------|------|
| **肾上腺素** | 0.1 | 0.05 | 系统错误 | 切换到快速模式 |
| **皮质醇** | 0.2 | 0.03 | 资源限制/失败 | 资源保守模式 |
| **多巴胺** | 0.5 | 0.02 | 任务成功 | 反思推理模式 |
| **血清素** | 0.5 | 0.01 | — | 稳定性调节 |
| **催产素** | 0.3 | 0.04 | 新输入 | 信任/协作 |

- 每隔5秒激素自动代谢回归基线
- `hormone:shift` 事件广播给所有系统

---

### 4. 🔄 循环系统 (CirculatorySystem) — `event-bus.ts`

**生物映射**：心脏、血管、血液
**软件功能**：事件总线、系统间通信

- 单例模式（`getInstance()`）
- 每个事件同时发送到特定频道和全局 `*` 频道
- 事件日志保留最近1000条
- 最大监听器数量：50

**API**：
```
pulse(event, payload, origin) → 发布事件
getEventLog() → 获取事件日志
getEventsByOrigin(origin) → 按来源过滤
```

---

### 5. 🌬️ 呼吸系统 (RespiratorySystem) — `respiratory-system.ts`

**生物映射**：肺、横膈膜
**软件功能**：Token/API 限流、能量管理

- Token Bucket 算法（容量10000，补充率100/s）
- 监听所有 `*` 事件消耗 token
- 资源不足时发布 `respiratory:limit` 事件（触发皮质醇分泌）
- 每秒呼吸节律检查，使用率>80%发布预警

---

### 6. 🧬 消化系统 (DigestiveSystem) — `digestive-system.ts`

**生物映射**：胃、肠道、酶
**软件功能**：知识摄入、代谢、检索

- `ingest()` 摄入知识片段
- 每10秒消化周期，未消化队列中提取知识
- `nutrientLevel` 营养水平（<0.2 触发"饥饿"状态）
- 关键词匹配 + 置信度排序的知识检索

---

### 7. 🚽 泌尿系统 (UrinarySystem) — `urinary-system.ts`

**生物映射**：肾脏、膀胱
**软件功能**：记忆清理、信息过滤

- 短期记忆容量上限100条
- 每30秒过滤周期：清除低重要性/过期的记忆
- `toxinLevel` 毒素水平 >0.8 触发紧急修剪（删除30%）
- 每次新记忆存储增加毒素水平

---

### 8. 🫄 生殖系统 (ReproductiveSystem) — `reproductive-system.ts`

**生物映射**：生殖器官
**软件功能**：自我进化、变异、子代生成

- `evolutionReadiness` 进化就绪度
- 监听失败/错误事件累积就绪度
- 就绪度>0.8触发变异（类型：code/prompt/config/tool）
- `spawnChild()` 生成子 Agent
- `mutationHistory` 追踪所有变异记录

---

## 生命周期 (Growth Stages)

系统从"新生"到"成熟"共5个阶段，自动检测条件并升级：

| 阶段 | 所需动作 | 所需工具 | 所需知识 | 最小营养 | 解锁能力 |
|------|---------|---------|---------|---------|---------|
| 🔵 NEWBORN | 0 | 0 | 0 | 0 | 基础感知与响应 |
| 🟢 CHILD | 5 | 0 | 0 | 0.1 | 工具使用 |
| 🟡 ADOLESCENT | 20 | 3 | 10 | 0.3 | 资源感知、知识构建 |
| 🟠 ADULT | 50 | 5 | 50 | 0.5 | 目标导向、自主运行 |
| 🔴 MATURE | 100 | 8 | 200 | 0.6 | 自我进化、完全自主 |

---

## 反馈循环 (Feedback Loops)

```
代谢压力 (呼吸→内分泌):
  RespiratorySystem 发布 respiratory:limit
  → EndocrineSystem 分泌皮质醇
  → NervousSystem 切换到保守模式

饥饿 (消化→神经):
  DigestiveSystem 营养<0.2
  → 发布 'hunger' 信号
  → NervousSystem 触发信息搜索

进化触发 (泌尿→生殖):
  UrinarySystem 毒素>0.8 发布 urinary:toxic
  → ReproductiveSystem 触发变异
  → 生成代码补丁修复底层逻辑

行动奖励 (运动→内分泌):
  MusculoskeletalSystem action:completed
  → EndocrineSystem 分泌多巴胺
  → NervousSystem 进入反思模式
```

---

## 快速开始

```bash
cd /Users/sy/hermes-framework
npm install
npm run build

# 运行 Demo
npm start

# 或开发模式
npx ts-node src/index.ts
```

## 项目结构

```
hermes-framework/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # Demo 入口
    ├── hermes-agent.ts             # 协调器
    ├── types.ts                    # 共享类型定义
    ├── system.ts                   # System 抽象基类
    ├── event-bus.ts                # 循环系统 (EventBus)
    ├── nervous-system.ts           # 神经系统
    ├── musculoskeletal-system.ts   # 运动系统
    ├── endocrine-system.ts         # 内分泌系统
    ├── respiratory-system.ts       # 呼吸系统
    ├── digestive-system.ts         # 消化系统
    ├── urinary-system.ts           # 泌尿系统
    └── reproductive-system.ts      # 生殖系统
```
