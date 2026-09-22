import { env } from '../../config/env.js';
import { LocalProvider } from './localProvider.js';
import { OpenAIProvider } from './openaiProvider.js';
import type { AIProvider } from './types.js';

export * from './types.js';

/** Factory — swap providers here without touching routes or the client. */
export function getAIProvider(): AIProvider {
  switch (env.ai.provider) {
    case 'openai':
      return new OpenAIProvider();
    case 'local':
    default:
      return new LocalProvider();
  }
}
