/**
 * Startup configuration, validated once at boot.
 *
 * A misconfigured tutor should refuse to start rather than fail in front of a
 * four-year-old mid-question. Binding is the sharpest case: plan.md requires
 * loopback by default, so anything wider has to be a deliberate, explicit act.
 */

export type Config = {
  host: string;
  port: number;
  databasePath: string;
  ollamaUrl: string;
  flashModel: string;
  /** True when bound to anything other than loopback. */
  lanMode: boolean;
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.HOST || '127.0.0.1';
  const port = Number(env.PORT || 3000);
  const ollamaUrl = env.OLLAMA_URL || 'http://127.0.0.1:11434';
  const flashModel = env.FLASH_MODEL || 'qwen2.5:7b';

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  if (!host.trim()) throw new Error('HOST must not be empty');

  try {
    const parsed = new URL(ollamaUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new Error('OLLAMA_URL must be a valid http(s) URL');
  }

  if (!flashModel.trim()) throw new Error('FLASH_MODEL must not be empty');

  return {
    host,
    port,
    databasePath: env.DB_PATH || './data/tutor.sqlite',
    ollamaUrl,
    flashModel,
    lanMode: !LOOPBACK_HOSTS.has(host),
  };
}
