import { ProviderType } from '@prisma/client';
import { UpstreamAdapter } from '../types';
import { OpenAiAdapter } from './openai.adapter';
import { AnthropicAdapter } from './anthropic.adapter';
import { GeminiAdapter } from './gemini.adapter';

export class AdapterFactory {
  static create(type: ProviderType): UpstreamAdapter {
    switch (type) {
      case ProviderType.ANTHROPIC:
        return new AnthropicAdapter();
      case ProviderType.GEMINI:
        return new GeminiAdapter();
      case ProviderType.OPENAI:
      case ProviderType.AZURE_OPENAI:
      default:
        return new OpenAiAdapter();
    }
  }
}
