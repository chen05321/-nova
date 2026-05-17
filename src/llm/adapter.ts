import { LLMProviderConfig } from '../config';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface DynamicOptions {
  temperature?: number;
  top_p?: number;
}

export type StreamCallback = (chunk: string, done: boolean, isReasoning?: boolean) => void;

export abstract class LLMAdapter {
  protected config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  abstract chat(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse>;

  abstract chatStream(
    messages: LLMMessage[],
    onChunk: StreamCallback,
    systemPrompt?: string,
    dynamicOptions?: DynamicOptions
  ): Promise<void>;

  getModelName(): string {
    return this.config.model;
  }
}
