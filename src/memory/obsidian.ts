import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { semanticSearch, rebuildCache, noteChanged } from './vector';

const VAULT_DIR = path.join(os.homedir(), '.nova-vault');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function vaultPath(...segments: string[]): string {
  return path.join(VAULT_DIR, ...segments);
}

// 写一篇 markdown 笔记
export function writeNote(category: string, title: string, tags: string[], content: string, links: string[] = []): string {
  ensureDir(path.join(VAULT_DIR, category));

  const date = new Date().toISOString().split('T')[0];
  const linkBlock = links.length > 0 ? '\n\n## 关联\n\n' + links.map(l => `- [[${l}]]`).join('\n') : '';
  const tagBlock = tags.length > 0 ? '\n' + tags.map(t => `\n- #${t}`).join('') : '';

  const md = `---
created: ${date}
tags: [${tags.join(', ')}]
---

# ${title}

${content}${linkBlock}${tagBlock}
`;

  // 文件名：去除特殊字符
  const safeName = title.replace(/[\/\\?*:<>|]/g, '_').substring(0, 60);
  const filePath = path.join(VAULT_DIR, category, `${safeName}.md`);

  fs.writeFileSync(filePath, md, 'utf-8');
  console.log(`  📝 笔记已写: ${category}/${safeName}.md`);
  return filePath;
}

// 搜索笔记（按文件名或内容关键词模糊匹配）
export function searchNotes(query: string, maxResults = 5): { file: string; title: string; snippet: string }[] {
  const results: { file: string; title: string; snippet: string; score: number }[] = [];
  const keywords = query.toLowerCase().split(/[\s,.-]+/).filter(Boolean);

  if (keywords.length === 0) return [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        const content = fs.readFileSync(full, 'utf-8');
        const lowerContent = content.toLowerCase();
        const lowerName = entry.name.toLowerCase();

        let score = 0;
        keywords.forEach(kw => {
          if (lowerName.includes(kw)) score += 50;
          const matches = lowerContent.split(kw).length - 1;
          score += matches * 2;
        });

        if (score > 0) {
          const lines = content.split('\n');
          const title = lines.find(l => l.startsWith('# '))?.replace('# ', '').trim() || entry.name.replace('.md', '');
          let bestLine = lines.find(l => keywords.some(k => l.toLowerCase().includes(k)) && !l.startsWith('#')) || lines[1] || '';
          const snippet = bestLine.substring(0, 200) || content.substring(0, 200);

          results.push({
            file: path.relative(VAULT_DIR, full),
            title,
            snippet: snippet.replace(/[#*\[\]`]/g, '').trim(),
            score
          });
        }
      }
    }
  }

  walk(VAULT_DIR);
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ file, title, snippet }) => ({ file, title, snippet }));
}

// 获取所有笔记标题（用于构建图谱）
export function getAllNoteTitles(): string[] {
  const titles: string[] = [];
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        const content = fs.readFileSync(full, 'utf-8');
        const title = content.split('\n').find(l => l.startsWith('# '))?.replace('# ', '').trim() || entry.name.replace('.md', '');
        titles.push(title);
      }
    }
  }
  walk(VAULT_DIR);
  return titles;
}

// 语义搜索（向量 + 关键词混合）
export async function hybridSearch(query: string, maxResults = 3): Promise<{ file: string; title: string; snippet: string }[]> {
  const vectorResults = await semanticSearch(query, maxResults);
  if (vectorResults.length > 0) {
    return vectorResults.map(r => {
      const filePath = vaultPath(r.file);
      let snippet = '';
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        snippet = lines.find(l => l.toLowerCase().includes(query.toLowerCase()) && !l.startsWith('#'))?.substring(0, 150)
          || lines[1]?.substring(0, 150) || content.substring(0, 150);
      } catch {}
      return { file: r.file, title: r.title, snippet: snippet.replace(/[#*\[\]`]/g, '').trim() };
    });
  }
  return searchNotes(query, maxResults);
}

// 重建向量缓存
export async function rebuildVectorCache(): Promise<void> {
  await rebuildCache();
}

// 笔记变更时更新向量
export async function onNoteChanged(filename: string): Promise<void> {
  await noteChanged(filename);
}

// 初始化仓库 — 如果空的就写个欢迎页
export function ensureVault(): void {
  ensureDir(VAULT_DIR);
  ensureDir(path.join(VAULT_DIR, '技能'));
  ensureDir(path.join(VAULT_DIR, '知识'));
  ensureDir(path.join(VAULT_DIR, '用户'));
  ensureDir(path.join(VAULT_DIR, '会话'));
  ensureDir(path.join(VAULT_DIR, '项目'));

  const welcomePath = path.join(VAULT_DIR, '欢迎.md');
  if (!fs.existsSync(welcomePath)) {
    fs.writeFileSync(welcomePath, `---
created: ${new Date().toISOString().split('T')[0]}
tags: [nova, 欢迎]
---

# 🧬 Nova 的超体记忆库

这里是 Nova 的知识仓库，所有学到的东西以 markdown 笔记形式存储。

## 目录结构

- \`技能/\` — 已掌握的技能
- \`知识/\` — 从外部学到的知识
- \`用户/\` — 关于用户的信息
- \`会话/\` — 重要对话记录
- \`项目/\` — 项目相关笔记

## 链接规范

用 \`[[双向链接]]\` 关联相关知识，构建知识图谱。
`, 'utf-8');
  }
}
