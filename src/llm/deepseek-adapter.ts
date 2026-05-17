import { LLMAdapter, LLMMessage, LLMResponse, StreamCallback } from './adapter';
import { LLMProviderConfig } from '../config';

export class DeepSeekAdapter extends LLMAdapter {
  private baseUrl: string;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl || 'https://api.deepseek.com';
  }

  buildMessages(messages: LLMMessage[], systemPrompt?: string): { role: string; content: string }[] {
    const msgs: { role: string; content: string }[] = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    for (const m of messages) {
      msgs.push({ role: m.role, content: m.content });
    }
    return msgs;
  }

  async chat(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse> {
    const msgs = this.buildMessages(messages, systemPrompt);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: msgs,
        max_tokens: this.config.maxTokens || 2048,
        temperature: this.config.temperature || 0.7
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`DeepSeek API error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model: string;
    };

    return {
      content: data.choices[0]?.message?.content || '',
      model: data.model || this.config.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined
    };
  }

  async chatStream(
    messages: LLMMessage[],
    onChunk: StreamCallback,
    systemPrompt?: string
  ): Promise<void> {
    const msgs = this.buildMessages(messages, systemPrompt);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: msgs,
        max_tokens: this.config.maxTokens || 2048,
        temperature: this.config.temperature || 0.7,
        stream: true
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
      const err = await response.text();
      onChunk(`[API错误] ${err}`, true);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onChunk('', true);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) onChunk(content, false);
          } catch {}
        }
      }
    } catch (err) {
      const errMsg = String(err);
      if (!errMsg.includes('JSON') && !errMsg.includes('parse')) {
        onChunk(`[stream error]`, true);
      } else {
        onChunk('', true);
      }
      return;
    }

    onChunk('', true);
  }
}
