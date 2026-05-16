import { System } from './system';
import { Biometrics, HormoneSignal } from './types';

export class NervousSystem extends System {
  private cognitiveLoad = 0;
  private currentModel = 'fast'; // 'fast' | 'reflective' | 'deep'
  private pendingPerceptions: unknown[] = [];

  async init(): Promise<void> {
    this.subscribe('input:raw', (data) => this.processPerception(data));
    this.subscribe('hormone:shift', (data) => this.regulateByHormone(data));
    this.subscribe('memory:recall', (data) => this.integrateMemory(data));
    this.initialized = true;
    this.log('Nervous system initialized');
  }

  private async processPerception(perception: unknown): Promise<void> {
    this.cognitiveLoad += 0.2;

    this.bus.pulse('thought:perceived', {
      perception,
      model: this.currentModel,
      load: this.cognitiveLoad
    }, this.name);

    this.bus.pulse('thought:ready', { decision: 'PROCESS' }, this.name);
    this.log('Perception processed through neural pathway');
  }

  private regulateByHormone(signal: unknown): void {
    const { type, level } = signal as HormoneSignal;

    if (type === 'adrenaline' && level > 0.7) {
      this.currentModel = 'fast';
      this.log('Adrenaline surge: switching to fast reactive mode');
    } else if (type === 'dopamine' && level > 0.7) {
      this.currentModel = 'reflective';
      this.log('Dopamine high: entering reflective reasoning mode');
    } else if (type === 'cortisol' && level > 0.6) {
      this.currentModel = 'fast';
      this.log('Cortisol elevated: conserving cognitive resources');
    }
  }

  private async integrateMemory(_data: unknown): Promise<void> {
    this.log('Integrating recalled memories into current context');
    this.cognitiveLoad = Math.max(0, this.cognitiveLoad - 0.1);
  }

  async think(prompt: string): Promise<string> {
    this.cognitiveLoad += 0.3;
    this.log(`Thinking with ${this.currentModel} model: ${prompt.substring(0, 50)}...`);
    this.bus.pulse('thought:started', { prompt, model: this.currentModel }, this.name);
    return Promise.resolve('[[RESPONSE_SLOT]]');
  }

  getBiometrics(): Biometrics {
    return {
      system: this.name,
      status: this.cognitiveLoad > 0.8 ? 'stressed' : 'healthy',
      load: this.cognitiveLoad,
      metadata: {
        model: this.currentModel,
        pendingPerceptions: this.pendingPerceptions.length
      }
    };
  }
}
