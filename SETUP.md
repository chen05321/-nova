# 超体 (Nova) — 内测指南

## 环境要求
- Node.js 18+
- OpenAI API Key（或 Anthropic API Key）

## 安装运行

```bash
# 1. 进入目录
cd nova

# 2. 安装依赖
npm install

# 3. 设置 API Key
export OPENAI_API_KEY=sk-你的key

# 4. 启动
npm start
```

## 命令

| 命令 | 功能 |
|:----|:----|
| 直接打字 | 普通对话 |
| `/task <目标>` | 自主执行任务 |
| `/status` | 看八大系统状态 |
| `/hormones` | 看激素水平 |
| `/help` | 全部命令 |

## 加插件 (可选)

创建 `nova.mcp.json` 可加载 MCP 插件，示例：

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
  }
}
```

## 反馈

有任何问题直接告诉我！
