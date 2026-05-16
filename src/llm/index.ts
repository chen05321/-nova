import { LLMAdapter, LLMMessage, LLMResponse } from './adapter';
import { OpenAIAdapter } from './openai-adapter';
import { AnthropicAdapter } from './anthropic-adapter';
import { DeepSeekAdapter } from './deepseek-adapter';
import { LLMProviderConfig } from '../config';

export { LLMAdapter, LLMMessage, LLMResponse } from './adapter';

export function createLLM(config: LLMProviderConfig): LLMAdapter {
  // If no API key provided, default to DeepSeek (works without key for limited usage)
  if (!config.apiKey) {
    return new DeepSeekAdapter({
      provider: 'deepseek',
      apiKey: 'sk-default',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com'
    });
  }

  switch (config.provider) {
    case 'anthropic':
      return new AnthropicAdapter(config);
    case 'deepseek':
      return new DeepSeekAdapter(config);
    default:
      // Most APIs are OpenAI-compatible (Groq, Together, Ollama, GitHub, Azure, etc.)
      return new OpenAIAdapter(config);
  }
}
