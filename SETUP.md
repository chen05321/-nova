# 超体 (Nova) — 快速上手

## 环境要求
- Node.js 18+
- DeepSeek API Key（免费: https://platform.deepseek.com）

## 安装运行

```bash
cd nova
npm install
nova --setup    # 配置 API Key
nova            # 启动（自动打开看板 http://localhost:3900）
```

## CLI 命令

| 命令 | 功能 |
|:----|:----|
| `nova` | 启动看板 |
| `nova --setup` | 配置向导 |
| `nova --cli` | 纯终端模式 |
| 直接打字 | 普通对话 |
| `/task <目标>` | 自主执行任务 |
| `/status` | 查看八大系统状态 |
| `/hormones` | 查看激素水平 |
| `/help` | 全部命令 |

## 加 MCP 插件

创建 `nova.mcp.json`:

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
