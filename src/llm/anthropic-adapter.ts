import Anthropic from '@anthropic-ai/sdk';
import { LLMAdapter, LLMMessage, LLMResponse, StreamCallback } from './adapter';
import { LLMProviderConfig } from '../config';

export class AnthropicAdapter extends LLMAdapter {
  private client: Anthropic;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async chat(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse> {
    const msgs: Anthropic.Messages.MessageParam[] = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens || 2048,
      system: systemPrompt || undefined,
      messages: msgs
    });

    let content = '';
    for (const block of response.content) {
      if (block.type === 'text') content += block.text;
    }

    return {
      content,
      model: response.model,
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      } : undefined
    };
  }

  async chatStream(
    messages: LLMMessage[],
    onChunk: StreamCallback,
    systemPrompt?: string
  ): Promise<void> {
    const msgs: Anthropic.Messages.MessageParam[] = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

    const stream = this.client.messages.stream({
      model: this.config.model,
      max_tokens: this.config.maxTokens || 2048,
      system: systemPrompt || undefined,
      messages: msgs
    });

    stream.on('text', (text) => onChunk(text, false));
    await stream.finalMessage();
    onChunk('', true);
  }
}
