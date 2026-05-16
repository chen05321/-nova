import { CirculatorySystem } from './event-bus';
import { Biometrics } from './types';

export abstract class System {
  protected bus: CirculatorySystem;
  protected name: string;
  protected initialized = false;

  constructor() {
    this.bus = CirculatorySystem.getInstance();
    this.name = this.constructor.name;
  }

  abstract init(): Promise<void>;

  abstract getBiometrics(): Biometrics;

  protected log(message: string): void {
    this.bus.pulse('system:log', { system: this.name, message }, this.name);
  }

  protected subscribe(event: string, handler: (data: unknown) => void): void {
    this.bus.on(event, handler);
    this.log(`Subscribed to: ${event}`);
  }
}
