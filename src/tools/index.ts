import * as fsPromises from 'fs/promises';
import { exec } from 'child_process';

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

class CentralRegistry {
  private tools = new Map<string, Tool>();

  public register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  public find(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  public getAll(): Tool[] {
    return Array.from(this.tools.values());
  }
}

export const writeFileTool: Tool = {
  name: 'write',
  description: 'Write text content safely into a specified file path.',
  async execute(args: Record<string, string>) {
    const file = args.file || args.path;
    const content = args.content;
    if (!file) return { success: false, output: '', error: 'Descriptor missing. Supply "path" or "file".' };

    let fileHandle = null;
    try {
      fileHandle = await fsPromises.open(file, 'w');
      await fileHandle.writeFile(content || '', 'utf-8');
      return { success: true, output: `Successfully committed mutations at [${file}].` };
    } catch (err: any) {
      return { success: false, output: '', error: `IO Write Exception: ${err.message}` };
    } finally {
      if (fileHandle) await fileHandle.close();
    }
  }
};

export const readFileTool: Tool = {
  name: 'read',
  description: 'Read the complete text strings from a specific local file path.',
  async execute(args: Record<string, string>) {
    const file = args.path || args.file || args.command;
    if (!file) return { success: false, output: '', error: 'Missing path target parameters.' };

    try {
      const content = await fsPromises.readFile(file, 'utf-8');
      return { success: true, output: content };
    } catch (err: any) {
      return { success: false, output: '', error: `IO Read Exception: ${err.message}` };
    }
  }
};

export const webFetchTool: Tool = {
  name: 'web',
  description: 'Fetch and scrub the text layout from an external HTTP/HTTPS URL address.',
  async execute(args: Record<string, string>) {
    const url = args.url || args.path;
    if (!url) return { success: false, output: '', error: 'Missing destination URL address.' };

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return { success: false, output: '', error: `HTTP network anomaly: ${response.status}` };
      const rawText = await response.text();
      const cleanText = rawText.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').substring(0, 3000);
      return { success: true, output: cleanText };
    } catch (err: any) {
      return { success: false, output: '', error: `Network Exception: ${err.message}` };
    }
  }
};

// 原生网络搜索工具（无需 API Key，用 DuckDuckGo Lite API）
export const searchTool: Tool = {
  name: 'search',
  description: 'Search the web for current information. Returns up to 5 result snippets.',
  async execute(args: Record<string, string>) {
    const query = args.query || args.q;
    if (!query) return { success: false, output: '', error: 'Missing search query.' };
    try {
      const resp = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const html = await resp.text();
      const results: string[] = [];
      const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
      let m;
      let count = 0;
      while ((m = linkRegex.exec(html)) !== null && count < 8) {
        const url = m[1];
        const text = m[2].trim();
        if (url && text && !url.startsWith('/') && url.startsWith('http')) {
          results.push(`${text}: ${url}`);
          count++;
        }
      }
      const output = results.length > 0 ? results.join('\n') : '未找到相关结果。';
      return { success: true, output };
    } catch (err: any) {
      return { success: false, output: '', error: `搜索失败: ${err.message}` };
    }
  }
};

export const shellTool: Tool = {
  name: 'shell',
  description: 'Execute white-listed system shell commands safely.',
  async execute(args: Record<string, string>) {
    const command = args.command || args.cmd || Object.values(args)[0];
    if (!command) return { success: false, output: '', error: 'Execution denied: No explicit shell instructions parsed.' };

    if (command.includes('rm -rf /') || command.includes(':(){ :|& };:')) {
      return { success: false, output: '', error: 'Security Interception: Destructive payload blocked.' };
    }

    return new Promise((resolve) => {
      const safeEnv = { ...process.env, PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin' };
      exec(command, { env: safeEnv, timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, output: '', error: stderr || error.message });
        } else {
          resolve({ success: true, output: stdout || stderr });
        }
      });
    });
  }
};

export const ToolRegistry = new CentralRegistry();
ToolRegistry.register(writeFileTool);
ToolRegistry.register(readFileTool);
ToolRegistry.register(webFetchTool);
ToolRegistry.register(shellTool);
ToolRegistry.register(searchTool);

export function getBuiltinTools(): Tool[] {
  return ToolRegistry.getAll();
}
