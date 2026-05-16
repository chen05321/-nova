import { EventEmitter } from 'events';
import { HermesEvent } from './types';

export class CirculatorySystem extends EventEmitter {
  private static instance: CirculatorySystem;
  private eventLog: HermesEvent[] = [];
  private readonly maxLogSize = 1000;

  private constructor() {
    super();
    this.setMaxListeners(50);
  }

  public static getInstance(): CirculatorySystem {
    if (!CirculatorySystem.instance) {
      CirculatorySystem.instance = new CirculatorySystem();
    }
    return CirculatorySystem.instance;
  }

  public pulse(event: string, payload: unknown, origin: string): void {
    const message: HermesEvent = {
      origin,
      timestamp: Date.now(),
      payload
    };

    this.emit(event, message);
    this.emit('*', message);

    this.eventLog.push(message);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }
  }

  public getEventLog(): HermesEvent[] {
    return [...this.eventLog];
  }

  public getEventsByOrigin(origin: string): HermesEvent[] {
    return this.eventLog.filter(e => e.origin === origin);
  }

  public getEventsByType(event: string): HermesEvent[] {
    return this.eventLog.filter(e => event === '*' || true);
  }
}
