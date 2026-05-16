import OpenAI from 'openai';
import { LLMAdapter, LLMMessage, LLMResponse, StreamCallback } from './adapter';
import { LLMProviderConfig } from '../config';

export class OpenAIAdapter extends LLMAdapter {
  private client: OpenAI;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined
    });
  }

  async chat(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse> {
    const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    for (const m of messages) msgs.push({ role: m.role, content: m.content });

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: msgs,
      max_tokens: this.config.maxTokens || 2048,
      temperature: this.config.temperature || 0.7
    });

    return {
      content: response.choices[0]?.message?.content || '',
      model: response.model,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      } : undefined
    };
  }

  async chatStream(
    messages: LLMMessage[],
    onChunk: StreamCallback,
    systemPrompt?: string
  ): Promise<void> {
    const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    for (const m of messages) msgs.push({ role: m.role, content: m.content });

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: msgs,
      max_tokens: this.config.maxTokens || 2048,
      temperature: this.config.temperature || 0.7,
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) onChunk(content, false);
    }

    onChunk('', true);
  }
}
