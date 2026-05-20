# Nova v6.0 — 架构方案

> **骨头（框架）先于血肉（代码）**
>
> 编码前阅读 [NOVA_METHODOLOGY.md](./NOVA_METHODOLOGY.md)

---

## 一、现状定位

Nova 当前是 v5.8。功能丰富但架构上有些地方需要硬化：

| 维度 | 现状 | 目标 |
|------|------|------|
| 系统初始化 | `boot()` 里硬编码顺序 | Manifest 声明式注册，自动排序依赖 |
| 工具扩展 | ToolRegistry 已有，但 MCP 工具主对话不可达 | 打通 MCP → 主对话工具链 |
| 记忆检索 | 关键词密度评分 | 向量 Embedding + 语义搜索 |
| 自我进化 | 需要人工触发 | 生殖系统自动触发闭环 |
| 看板组件 | 部分缺少 loading/empty/error 态 | 四态全面覆盖 |

---

## 二、v6.0 目标

| 模块 | 改动 | 优先级 |
|------|------|:------:|
| 🔍 **向量记忆检索** | 引入本地 Embedding，语义搜索 Obsidian 笔记 | P0 |
| 🔌 **MCP 工具打通** | 主对话也能用 MCP 注册的工具 | P0 |
| 🧬 **自动进化闭环** | 生殖系统 readiness > 0.9 时自动触发自修改 | P1 |
| 📊 **看板四态覆盖** | loading/empty/error 态补全 | P1 |
| 🛠 **工具超时动态化** | 根据命令类型调整 shell 超时 | P2 |
| 🗑 **记忆自动清理** | 会话自动归档 | P2 |

---

## 三、详细方案

### P0: 向量记忆检索

**问题：** `searchNotes()` 只做关键词匹配，"Python 异步编程"搜不出"asyncio 协程"。

**方案：**

```
用户提问
  ↓
embedding 模型（本地 @xenova/transformers）
  ↓
向量化 query
  ↓
与 Obsidian 笔记向量库计算余弦相似度
  ↓
返回 Top 3 最相关内容
  ↓
注入 system prompt
```

**实现方式：**
- 安装 `@xenova/transformers`（纯 JS，本地跑，不需要 Python）
- 在 `memory/obsidian.ts` 加 `embedNote()` 和 `semanticSearch()` 两个函数
- 启动时预计算所有笔记的向量
- 新笔记写入时自动更新向量索引

### P0: MCP 工具打通

**问题：** AgentLoop 加载了 MCP 工具并在 ToolRegistry 注册了，但主对话（NervousSystem）用的是 ToolRegistry.find()，理论上已经通了。需要验证 `superbody.mcp.json` 中的 puppeteer 工具是否实际可用。

**方案：**
- 验证 MCP 连接是否成功
- 修改系统提示词，告知 Nova 有浏览器控制工具可用
- 增强 executeToolByName 的错误提示

### P1: 自动进化闭环

**问题：** 现在需要人说了它才去改代码。

**方案：**

```
evolutionReadiness 每 5 分钟 +0.02
  ↓
达到 0.9 时自动触发：
  1. 读错题本（~/.nova-vault/知识/避坑自省_*.md）
  2. 选一个频率最高的缺陷类型
  3. 定位对应的 src/ 文件
  4. 生成修复补丁
  5. write 覆写
  6. npm run build
  7. 热重启
```

### P1: 看板四态覆盖

**问题：** 任务/升级/工具面板在无数据时白屏。

**方案：** 给每个面板加 loading/empty/error 状态渲染，模板已在 `renderUpgrade()` 中实现了 empty 态，tasks 和 tools 面板同理。

---

## 四、不要做的事

1. ❌ 加新的大系统——8 个够了，再多就是负担
2. ❌ 换框架——当前 Express-like 的 http server + SSE 够用
3. ❌ 加数据库——SQLite 太重，Obsidian + JSON 正合适
