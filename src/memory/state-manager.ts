import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface NovaState {
  energy: number;
  debt: number;
  generation: number;
  actionCount: number;
  wisdom: number;
  learnedSkills: string[];
  hormones: Record<string, number>;
  lastUptime: number;
}

const STATE_DIR = path.join(os.homedir(), '.nova');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

export class StateManager {
  private static instance: StateManager;
  private stateData: NovaState;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private defaultState: NovaState = {
    energy: 50, debt: 0, generation: 1, actionCount: 0, wisdom: 0,
    learnedSkills: [], lastUptime: 0,
    hormones: { adrenaline: 0.1, cortisol: 0.2, dopamine: 0.4, serotonin: 0.5, oxytocin: 0.3 }
  };

  private constructor() {
    this.ensureDir();
    this.stateData = this.loadState();
  }

  public static getInstance(): StateManager {
    if (!StateManager.instance) StateManager.instance = new StateManager();
    return StateManager.instance;
  }

  private ensureDir(): void {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  }

  private loadState(): NovaState {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf-8');
        return { ...this.defaultState, ...JSON.parse(raw) };
      }
    } catch { console.error('[状态管理器] 快照坏损，重新初始化'); }
    return { ...this.defaultState };
  }

  public getStore(): NovaState {
    const self = this;
    return new Proxy(this.stateData, {
      set(target: any, prop: keyof NovaState, value) {
        target[prop] = value;
        self.triggerLazySave();
        return true;
      }
    });
  }

  private triggerLazySave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.ensureDir();
      const tmpPath = `${STATE_FILE}.tmp`;
      try {
        await fs.promises.writeFile(tmpPath, JSON.stringify(this.stateData, null, 2), 'utf-8');
        await fs.promises.rename(tmpPath, STATE_FILE);
      } catch (err) {
        console.error('[状态管理器] 原子写盘异常:', err);
      } finally {
        this.saveTimer = null;
      }
    }, 1500);
  }
}
