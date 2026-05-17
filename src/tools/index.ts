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

export const writeFileTool: Tool = {
  name: 'write',
  description: 'Write text content safely into a specified file path.',
  async execute(args: Record<string, string>) {
    const file = args.file || args.path;
    const content = args.content;

    if (!file) {
      return { success: false, output: '', error: 'Missing target file descriptor. Supply "path" or "file".' };
    }

    let fileHandle = null;
    try {
      fileHandle = await fsPromises.open(file, 'w');
      await fileHandle.writeFile(content || '', 'utf-8');
      return { success: true, output: `Successfully committed file mutation at [${file}].` };
    } catch (err: any) {
      return { success: false, output: '', error: `IO Exception: ${err.message}` };
    } finally {
      if (fileHandle) {
        await fileHandle.close();
      }
    }
  }
};

export const shellTool: Tool = {
  name: 'shell',
  description: 'Execute white-listed system shell commands safely.',
  async execute(args: Record<string, string>) {
    const command = args.command;
    if (!command) return { success: false, output: '', error: 'Missing shell command sequence.' };

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

export function getBuiltinTools(): Tool[] {
  return [writeFileTool, shellTool];
}
