import { env } from '../../config/env.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';
import type { AIProvider, AIRequestContext, AIResult } from './types.js';
import { AIUnavailableError } from './types.js';

/**
 * Provider for any OpenAI-compatible chat-completions API
 * (OpenAI, OpenRouter, Azure OpenAI, LM Studio, Ollama's OpenAI shim, ...).
 * The API key lives only in server-side environment variables and is
 * never exposed to the frontend.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai-compatible';

  isActionAvailable(): boolean {
    return Boolean(env.ai.openai.apiKey);
  }

  async run(ctx: AIRequestContext): Promise<AIResult> {
    const { apiKey, baseUrl, model, timeoutMs } = env.ai.openai;
    if (!apiKey) throw new AIUnavailableError('کلید OPENAI_API_KEY در .env تنظیم نشده است.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: ctx.action === 'continue' ? 0.7 : 0.2,
          messages: [
            { role: 'system', content: buildSystemPrompt(ctx.action) },
            { role: 'user', content: buildUserPrompt(ctx) },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `سرویس هوش مصنوعی خطا برگرداند (کد ${res.status}). ${body.slice(0, 200)}`
        );
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const output = data.choices?.[0]?.message?.content?.trim();
      if (!output) throw new Error('پاسخ خالی از سرویس هوش مصنوعی دریافت شد.');
      return { action: ctx.action, output, provider: `${this.name}:${model}` };
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error('پاسخ سرویس هوش مصنوعی بیش از حد طول کشید (Timeout).');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
