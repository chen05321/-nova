import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Tool, ToolResult } from '../tools';

interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

interface MCPConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MCPClient {
  private process: ChildProcess | null = null;
  private config: MCPConfig;
  private serverName: string;
  private buffer = '';
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private toolbox: Map<string, MCPToolDefinition> = new Map();
  private connected = false;

  constructor(name: string, config: MCPConfig) {
    this.serverName = name;
    this.config = config;
  }

  async connect(): Promise<void> {
    const resolvedCmd = this.resolvePath(this.config.command);

    this.process = spawn(resolvedCmd, this.config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.config.env || {}) },
      shell: process.platform === 'win32'
    });

    this.process.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    this.process.stderr?.on('data', (chunk: Buffer) => {
      // MCP servers often log to stderr
    });
    this.process.on('exit', (code) => {
      this.connected = false;
      for (const [, p] of this.pending) {
        p.reject(new Error(`MCP server exited with code ${code}`));
        clearTimeout(p.timer);
      }
      this.pending.clear();
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'nova', version: '0.1.0' }
    });

    const tools = await this.request('tools/list', {});
    for (const t of (tools as { tools: MCPToolDefinition[] }).tools || []) {
      this.toolbox.set(t.name, t);
    }

    this.connected = true;
  }

  getTools(): Tool[] {
    const tools: Tool[] = [];
    for (const [name, def] of this.toolbox) {
      tools.push({
        name: `${this.serverName}_${name}`,
        description: `[MCP/${this.serverName}] ${def.description}`,
        execute: async (args: Record<string, string>): Promise<ToolResult> => {
          try {
            const result = await this.request('tools/call', {
              name,
              arguments: args
            });

            const content = (result as any)?.content || [];
            const text = content
              .map((c: any) => c.text || JSON.stringify(c))
              .join('\n');

            return { success: true, output: text || '(no output)' };
          } catch (err) {
            return { success: false, output: '', error: String(err) };
          }
        }
      });
    }
    return tools;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getName(): string {
    return this.serverName;
  }

  disconnect(): void {
    this.connected = false;
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.toolbox.clear();
  }

  private async request(method: string, params: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      }) + '\n';

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out`));
      }, 30000);

      this.pending.set(id, { resolve, reject, timer });
      this.process?.stdin?.write(request);
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) {
            p.reject(new Error(msg.error.message || 'MCP error'));
          } else {
            p.resolve(msg.result);
          }
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }

  private resolvePath(cmd: string): string {
    // If it's a relative path starting with ./ or ../
    if (cmd.startsWith('./') || cmd.startsWith('../')) {
      return path.resolve(process.cwd(), cmd);
    }
    // If it has a .ts/.js extension, resolve relative to current dir
    if (cmd.endsWith('.ts') || cmd.endsWith('.js')) {
      const resolved = path.resolve(cmd);
      if (fs.existsSync(resolved)) return resolved;
    }
    // Otherwise, assume it's in PATH or an npx command
    return cmd;
  }
}

export function loadMCPConfigs(): Record<string, MCPConfig> {
  const configPath = path.join(process.cwd(), 'nova.mcp.json');
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {}

  // Also check ~/.nova/mcp.json
  const homeConfig = path.join(os.homedir(), '.nova', 'mcp.json');
  try {
    if (fs.existsSync(homeConfig)) {
      const content = fs.readFileSync(homeConfig, 'utf-8');
      return JSON.parse(content);
    }
  } catch {}

  return {};
}
