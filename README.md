# 超体 (Nova) — 自进化 AI 智能体

基于人体 8 大系统架构的自进化 AI 框架。内置聊天、模型管理、看板监控、主动学习。

## 一键安装

```bash
# 1. 下载
git clone https://github.com/chen05321/-nova.git
cd -nova

# 2. 安装依赖
npm install
bash install.sh

# 3. 配置 API Key
nova --setup

# 4. 启动（自动打开看板）
nova
```

或直接运行（需要 Node.js 18+）：
```bash
npx github:chen05321/-nova
```

## 功能概览

| 功能 | 说明 |
|:----|:------|
| 🤖 **聊天** | 看板内嵌聊天 + 终端 CLI 双模式 |
| 📊 **看板** | 八大系统实时监控、能量/废物/人格可视化 |
| 🔄 **模型管理** | 支持 26 家厂商，版本切换，OpenCode 导入 |
| 🧠 **主动觅食** | 自动学习新知识，存入长期记忆 |
| ⚡ **升级系统** | 消耗能量永久提升能力 |
| 🎭 **角色预设** | 程序员/销售/教师/分析师等 7 种人格 |
| 🌐 **中英文** | 全界面语言切换 |
| 🔌 **MCP 插件** | 支持浏览器控制、文件系统等 |

## 系统架构

| 系统 | 功能 |
|:----|:------|
| 🧠 神经系统 | LLM 推理、模型切换 |
| 💪 运动系统 | 工具调用、动作执行 |
| 🧪 内分泌系统 | 激素调控、行为调节 |
| 🔄 循环系统 | 事件总线、能量管理 |
| 🌬️ 呼吸系统 | Token 限流、能量恢复 |
| 🧬 消化系统 | 知识摄入、记忆提取 |
| 🚽 泌尿系统 | 记忆清理、信息过滤 |
| 🫄 生殖系统 | 自我进化、升级变异 |

## CLI 命令

```bash
nova              # 启动（打开看板）
nova --setup      # 配置 API Key
nova --cli        # 仅终端模式
```

看板内命令：`/help` 查看全部

## 配置

```bash
# 方式一：运行配置向导
nova --setup

# 方式二：设置环境变量
export DEEPSEEK_API_KEY=sk-...
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

## License

MIT
