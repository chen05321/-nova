#!/usr/bin/env bash
set -e

echo "╔═══════════════════════════════════════╗"
echo "║     超体 (Nova) 一键安装        ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 需要 Node.js 18+，请先安装: https://nodejs.org"
    exit 1
fi

NODE_VER=$(node -v | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VER" -lt 18 ]; then
    echo "❌ Node.js 版本过低 ($(node -v))，需要 18+"
    exit 1
fi

echo "✓ Node.js $(node -v)"
echo ""

# Check API key
if [ -z "$OPENAI_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "⚠ 未检测到 API Key"
    echo "  使用前请设置: export OPENAI_API_KEY=sk-..."
    echo ""
fi

# Install dependencies
echo "📦 安装依赖..."
npm install --silent
echo "✓ 依赖安装完成"
echo ""

# Build
echo "🔨 编译..."
npx tsc --silent
echo "✓ 编译完成"
echo ""

echo "╔═══════════════════════════════════════╗"
echo "║  安装成功! 运行:                      ║"
echo "║                                      ║"
echo "║  export OPENAI_API_KEY=sk-...         ║"
echo "║  npm start                            ║"
echo "╚═══════════════════════════════════════╝"
