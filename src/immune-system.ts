import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { System } from './system';
import { Biometrics } from './types';

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//, /mkfs/, /dd\s+if=/, />\s*\/dev\//,
  /:\(\)\s*\{/, /chmod\s+777\s+\//, /sudo\s+rm/,
];

export class ImmuneSystem extends System {
  private blockedAttacks = 0;
  private failedCritiques = 0;
  private lastScanTime = 0;

  async init(): Promise<void> {
    this.subscribe('tool:register', (data) => this.scanToolRegistration(data));
    this.subscribe('evolution:mutation', (data) => this.reviewMutation(data));
    this.subscribe('system:error', () => { this.failedCritiques++; });
    this.initialized = true;
    this.log('Immune system ready — 10 shields active');
  }

  // 检查工具注册时的安全性
  private scanToolRegistration(data: unknown): void {
    const tool = (data as any)?.payload;
    if (!tool?.name || !tool?.handler) return;
    if (tool.name === 'shell' || tool.name === 'bash') {
      this.log(`🔒 监控 shell 工具: ${tool.name}`);
    }
  }

  // 审查进化产生的代码突变
  private reviewMutation(data: unknown): void {
    const mutation = (data as any)?.payload?.mutation;
    if (!mutation?.patch) return;

    // 检查生成的代码有没有注入恶意模式
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(mutation.patch)) {
        this.blockedAttacks++;
        this.bus.pulse('immune:blocked', {
          type: 'dangerous_pattern',
          pattern: pattern.source,
          target: mutation.target
        }, this.name);
        this.log(`🚨 免疫系统拦截: 检测到危险模式 ${pattern.source}`);
      }
    }
  }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: this.blockedAttacks > 3 ? 'stressed' : 'healthy',
      load: Math.min(1, (this.blockedAttacks + this.failedCritiques) / 20),
      metadata: {
        blockedAttacks: this.blockedAttacks,
        failedCritiques: this.failedCritiques,
        lastScan: this.lastScanTime,
        shieldsActive: 10
      }
    };
  }
}
