# 超体 (Nova) Agent

Self-evolving AI agent inspired by the human body's 8 major systems.

## Quick Start

```bash
# Set API key
export OPENAI_API_KEY=sk-...

# Run
npx nova

# Or install globally
npm install -g nova
nova
```

## Configuration

Create `nova.config.json`:

```json
{
  "llm": {
    "fast": { "provider": "openai", "model": "gpt-4o-mini" },
    "reflective": { "provider": "openai", "model": "gpt-4o" },
    "deep": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" }
  }
}
```

Or use env vars:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## MCP Plugins

超体支持 MCP (Model Context Protocol)，可以直接使用 GitHub 上数百个现成的 MCP 服务器作为插件。

创建 `nova.mcp.json`:

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
  },
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_TOKEN": "your_token" }
  }
}
```

启动时自动加载并注册所有 MCP 工具。

## Architecture

| System | File | Function |
|--------|------|----------|
| 🧠 Nervous | `nervous-system.ts` | LLM reasoning, model switching |
| 💪 Musculoskeletal | `musculoskeletal-system.ts` | Tool execution |
| 🧪 Endocrine | `endocrine-system.ts` | Hormone regulation |
| 🔄 Circulatory | `event-bus.ts` | Event bus, communication |
| 🌬️ Respiratory | `respiratory-system.ts` | Token bucket, rate limiting |
| 🧬 Digestive | `digestive-system.ts` | Knowledge ingestion |
| 🚽 Urinary | `urinary-system.ts` | Memory pruning |
| 🫄 Reproductive | `reproductive-system.ts` | Self-evolution |

## Built-in Tools

- `shell` — Execute shell commands
- `read` — Read files
- `write` — Write files
- `ls` — List directory
- `web` — Fetch URLs

## CLI Commands

```
/status            System biometrics
/hormones          Hormone levels
/task <desc>       Run autonomously
/conv              List conversations
/facts             Stored facts
/help              All commands
/quit              Exit
```

## License

MIT
