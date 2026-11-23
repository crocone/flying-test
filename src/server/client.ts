// Клиент ИИ для сервера и скриптов проверки.
// - Создаётся только при ключе, заданном явно (переменная или .env): иначе SDK сам ищет учётные
//   данные в профиле пользователя, а сервер не должен тратить чужой доступ незаметно.
// - Если задан HTTPS_PROXY / HTTP_PROXY, запросы идут через прокси (fetch в Node сам его не читает):
//   так работает за корпоративным прокси и в изолированной среде, где прямой выход закрыт.
import Anthropic from '@anthropic-ai/sdk';
import { EnvHttpProxyAgent } from 'undici';

export const hasKey = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const proxyUrl = (): string | undefined =>
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || undefined;

export function makeClient(): Anthropic | null {
  if (!hasKey()) return null;
  const opts: ConstructorParameters<typeof Anthropic>[0] = {};
  // EnvHttpProxyAgent учитывает и NO_PROXY.
  if (proxyUrl()) opts.fetchOptions = { dispatcher: new EnvHttpProxyAgent() } as NonNullable<typeof opts.fetchOptions>;
  return new Anthropic(opts);
}
