# 超体 MCP 插件推荐

MCP (Model Context Protocol) 是 AI 智能体的通用"外设"协议。装上对应插件，超体就能"长出手脚"——操作文件、查数据库、控制浏览器。

## 📂 文件系统 — 让超体能读写文件

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/你的用户名/Desktop"]
  }
}
```
> 安装：`npx -y @modelcontextprotocol/server-filesystem`
> 功能：读写文件、创建目录、搜索文件

---

## 🌐 浏览器控制 — 让超体能"看网页"

### 方案A：无头浏览器（截图+点击）
```json
{
  "puppeteer": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
  }
}
```
> 功能：打开网页、截图、点击、填写表单、JavaScript 执行

### 方案B：网页搜索（轻量）
```json
{
  "brave-search": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-brave-search"],
    "env": { "BRAVE_API_KEY": "你的key" }
  }
}
```
> 注册：https://brave.com/search/api/
> 功能：联网搜索最新信息

---

## 💾 数据库 — 让超体能查数据

### SQLite（本地文件数据库）
```json
{
  "sqlite": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sqlite", "./data.db"]
  }
}
```

### PostgreSQL（线上数据库）
```json
{
  "postgres": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@localhost/db"]
  }
}
```

---

## 🔧 开发工具 — 让超体会编程

### GitHub 操作
```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_TOKEN": "你的token" }
  }
}
```
> 功能：创建 Issue、PR、查看代码、管理仓库

### 代码分析（TODO）
- `@modelcontextprotocol/server-sentry` — 错误监控
- `@modelcontextprotocol/server-sequential-thinking` — 分步推理

---

## 📋 办公效率

### Slack 消息
```json
{
  "slack": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-slack"],
    "env": { "SLACK_BOT_TOKEN": "xoxb-...", "SLACK_TEAM_ID": "T..." }
  }
}
```

### 记事本记忆
```json
{
  "memory": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-memory"]
  }
}
```
> 功能：让超体拥有长期记忆，跨会话记住事实

---

## 📦 一行安装所有推荐插件

```bash
npx -y @modelcontextprotocol/server-filesystem /tmp
npx -y @modelcontextprotocol/server-puppeteer
npx -y @modelcontextprotocol/server-memory
```

然后在 `nova.mcp.json` 里启用即可。

## 更多插件

完整 MCP 服务器列表：
- GitHub 官方: https://github.com/modelcontextprotocol/servers
- 社区收集: https://github.com/punkpeye/awesome-mcp-servers

---

## 完整示例 nova.mcp.json

把以下内容保存为 `nova.mcp.json`，放在启动目录下：

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
  },
  "memory": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-memory"]
  },
  "puppeteer": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
  }
}
```
