import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, exec } from 'child_process';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  execute(args: Record<string, string>): Promise<ToolResult>;
}

const isWindows = process.platform === 'win32';

// ─── Safety check ───────────────────────────────────────────
const dangerousPatterns = [
  { pattern: /rm\s+-rf\s+\//, msg: '⚠ 危险命令: rm -rf / 会删除整个系统' },
  { pattern: /mkfs/, msg: '⚠ 危险命令: 格式化磁盘操作' },
  { pattern: /dd\s+if=/, msg: '⚠ 危险命令: dd 磁盘写入操作' },
  { pattern: />\s*\/dev\//, msg: '⚠ 危险命令: 写入设备文件' },
  { pattern: /:\(\)\s*\{/, msg: '⚠ 危险命令: fork 炸弹' },
  { pattern: /chmod\s+777\s+\//, msg: '⚠ 危险命令: 修改根目录权限' },
  { pattern: /wget.*\|\s*sh/, msg: '⚠ 危险命令: 下载并执行未知脚本' },
  { pattern: /curl.*\|\s*bash/, msg: '⚠ 危险命令: 下载并执行未知脚本' },
  { pattern: /sudo\s+rm/, msg: '⚠ 危险: 需要确认的 sudo 删除操作' },
];

function safetyCheck(command: string): string | null {
  for (const d of dangerousPatterns) {
    if (d.pattern.test(command)) return d.msg;
  }
  return null;
}

// ─── Shell Tool ───────────────────────────────────────────────
const shellTool: Tool = {
  name: 'shell',
  description: 'Execute shell commands. Use for file ops, git, npm, etc.',
  async execute(args: Record<string, string>): Promise<ToolResult> {
    const command = args.command;
    if (!command) return { success: false, output: '', error: 'No command provided' };

    const danger = safetyCheck(command);
    if (danger) return { success: false, output: '', error: danger };

    try {
      // Windows needs cmd.exe /c, Unix needs sh -c
      const finalCmd = isWindows
        ? `cmd.exe /c "${command.replace(/"/g, '\\"')}"`
        : command;

      const output = execSync(finalCmd, {
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        shell: isWindows ? 'cmd.exe' : '/bin/bash'
      });
      return { success: true, output: output.trim() || '(empty output)' };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'stdout' in err && 'stderr' in err) {
        const e = err as { stdout: string; stderr: string; message: string };
        return {
          success: false,
          output: e.stdout?.trim() || '',
          error: e.stderr?.trim() || e.message
        };
      }
      return { success: false, output: '', error: String(err) };
    }
  }
};

// ─── Read File Tool ───────────────────────────────────────────
const readTool: Tool = {
  name: 'read',
  description: 'Read a file from the filesystem. Provide the file path.',
  async execute(args: Record<string, string>): Promise<ToolResult> {
    const filePath = args.path;
    if (!filePath) return { success: false, output: '', error: 'No path provided' };

    try {
      const content = fs.readFileSync(path.resolve(filePath), 'utf-8');
      return { success: true, output: content };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  }
};

// ─── Write File Tool ──────────────────────────────────────────
const writeTool: Tool = {
  name: 'write',
  description: 'Write content to a file. Provide path and content.',
  async execute(args: Record<string, string>): Promise<ToolResult> {
    const filePath = args.path;
    const content = args.content;
    if (!filePath) return { success: false, output: '', error: 'No path provided' };
    if (content === undefined) return { success: false, output: '', error: 'No content provided' };

    try {
      const resolved = path.resolve(filePath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content, 'utf-8');
      return { success: true, output: `Written ${content.length} bytes to ${filePath}` };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  }
};

// ─── List Directory Tool ──────────────────────────────────────
const lsTool: Tool = {
  name: 'ls',
  description: `List files in a directory. ${isWindows ? 'Use forward slashes in paths.' : ''}`,
  async execute(args: Record<string, string>): Promise<ToolResult> {
    const dirPath = args.path || '.';
    try {
      const resolved = path.resolve(dirPath);
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const output = entries.map(e => {
        const fullPath = path.join(resolved, e.name);
        let info = `${e.isDirectory() ? '📁' : '📄'} ${e.name}`;
        if (e.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            info += ` ${formatSize(stat.size)}`;
          } catch {}
        }
        return info;
      }).join('\n');
      return { success: true, output: output || '(empty directory)' };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  }
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Web Fetch Tool ────────────────────────────────────────────
const webTool: Tool = {
  name: 'web',
  description: 'Fetch content from a URL. Provide the URL.',
  async execute(args: Record<string, string>): Promise<ToolResult> {
    const url = args.url;
    if (!url) return { success: false, output: '', error: 'No URL provided' };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      const text = await response.text();
      return {
        success: true,
        output: text.substring(0, 10000) + (text.length > 10000 ? '\n...[truncated]' : '')
      };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  }
};

// ─── Grep Tool (search text in files) ──────────────────────────
const grepTool: Tool = {
  name: 'grep',
  description: 'Search for text patterns inside files. Provide pattern and optional path.',
  async execute(args: Record<string, string>): Promise<ToolResult> {
    const pattern = args.pattern;
    const filePath = args.path || '.';
    if (!pattern) return { success: false, output: '', error: 'No pattern provided' };

    try {
      const result = execSync(
        isWindows
          ? `findstr /s /n /c:"${pattern}" "${filePath}\\*"`
          : `grep -rn "${pattern}" "${filePath}" 2>/dev/null | head -50`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      return { success: true, output: result.trim() || '(no matches)' };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      if (e.stdout) return { success: true, output: e.stdout.trim() };
      return { success: false, output: '', error: e.stderr || e.message || 'grep failed' };
    }
  }
};

// ─── Tool Registry ────────────────────────────────────────────
const builtinTools: Tool[] = [shellTool, readTool, writeTool, lsTool, webTool, grepTool];

export function getBuiltinTools(): Tool[] {
  return builtinTools;
}

export { shellTool, readTool, writeTool, lsTool, webTool, grepTool };
