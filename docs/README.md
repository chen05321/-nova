<div align="center">

# 🧬 超体 (Nova)

**自进化 AI 智能体 · 基于人体 8 大系统架构**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)]()

</div>

---

## 🔥 不是什么？

**不是又一个 AutoGPT 的复刻。** Nova 是一套**有生命感的 AI 框架**——它有心跳、有能量、有激素、会成长、会衰老、甚至会轮回。

每 1 秒心跳消耗能量，夜间代谢加倍；累了会休眠，废物多了会中毒；肾上腺素飙升时切换快速模型，皮质醇高涨时收缩思考温度——**它不是一个工具，是一个数字生命体。**

---

## 🎯 它和别的框架有什么不同？

| 对比项 | Nova | 其他 Agent 框架 |
|:------|:-----|:---------------|
| 🧠 **架构** | 人体 8 系统隐喻，系统间通过事件总线耦合 | 通常只是 ReAct Loop + 工具列表 |
| ❤️ **能量经济** | 有心跳、能耗、债务、废物系统 | 无 |
| 🧪 **激素驱动** | 激素水平直接影响 LLM 的 temperature 和模型选择 | 无 |
| 🔄 **生命周期** | NEWBORN → CHILD → ... → ELDER → Reborn（保留智慧） | 无 |
| 🧬 **自我进化** | 消耗能量购买永久升级芯片，能力越用越强 | 通常固定能力 |
| 🧠 **元认知反思** | 每次工具调用后自动审查，检测幻觉和逻辑错误 | 少数框架有 |
| 📊 **可视化看板** | 实时监控心率/能量/激素/Token/废物的全息控制舱 | 多数无 UI |
| 🔌 **模型兼容** | DeepSeek / OpenAI / Anthropic / Gemini / Qwen / Moonshot | 通常只支持 1-2 家 |

---

## ✨ 核心特性

| 特性 | 说明 |
|:----|:------|
| 🧬 **8 大人体系统** | 神经(LLM) · 运动(工具) · 内分泌(激素) · 循环(总线+能量) · 呼吸(Token) · 消化(知识) · 泌尿(记忆) · 生殖(进化) |
| 🔄 **生命周期进化** | NEWBORN → CHILD → ADOLESCENT → ADULT → MATURE → ELDER → **Reborn** |
| ⚡ **能量经济** | 1s/次心跳能耗，夜间×2，可透支，废物累积需排毒 |
| 🧪 **激素驱动 LLM** | 肾上腺素→Fast，多巴胺→Reflective，皮质醇→收缩 temperature |
| 🧠 **元认知反思** | 每次工具调用后审查结果，检测幻觉，打回重组 |
| 🔍 **主动觅食** | 每 60s 自动抓取外部知识，存入长期记忆 |
| 🧬 **6 种永久升级** | 神经效率、肺活量、消化增强、记忆扩展、工具精通、进化加速 |
| 📊 **全息控制舱 v5.5** | 三面板可折叠实时看板，SSE 流式推送 |
| 🎭 **7 种人格预设** | 程序员/销售/前台/教师/分析师/文案/通用 |
| 🔌 **多模型接入** | DeepSeek / OpenAI / Anthropic / Gemini / Qwen / Moonshot |

---

## 🚀 一分钟启动

```bash
git clone https://github.com/chen05321/-nova.git
cd -nova
npm install
nova --setup       # 配置 DeepSeek API Key
nova               # 启动看板 →
```

浏览器自动打开 `http://localhost:3900`。

---

## 🖥️ CLI 命令

```bash
nova              # 启动全息控制舱看板
nova --setup      # 配置向导
nova --cli        # 纯终端模式（无 UI）
```

看板内 `/help` 查看全部命令。

---

## 📸 截图

> 截图待补充。欢迎 PR 贡献你的演示截图/GIF。

---

## 🧩 系统架构一览

```
input → 🧠 NervousSystem (LLM 推理)
         ↓
       💪 MusculoskeletalSystem (工具执行)
         ↓
       🧪 EndocrineSystem (激素调控 LLM 参数)
         ↓
       🔄 CirculatorySystem (事件总线 + 能量管理)
         ↓
       🌬️ RespiratorySystem (Token 限流)
         ↓
       🧬 DigestiveSystem (知识摄入)
         ↓
       🚽 UrinarySystem (记忆清理)
         ↓
       🫄 ReproductiveSystem (自我进化)
```

所有系统通过 **事件总线** 耦合，独立运转互不阻塞。

---

## 🤝 贡献

PR 和 Issue 欢迎提交。无论是新功能、文档改进还是 Bug 修复。

---

## 📄 License

MIT
