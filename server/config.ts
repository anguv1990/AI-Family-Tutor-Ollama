/**
 * Startup configuration, validated once at boot.
 *
 * A misconfigured tutor should refuse to start rather than fail in front of a
 * four-year-old mid-question. Binding is the sharpest case: plan.md requires
 * loopback by default, so anything wider has to be a deliberate, explicit act.
 * The app holds a child's learning record and has no user accounts, so anything
 * that can reach the port can read it — a LAN bind therefore also has to supply
 * an admin secret, and this module refuses to start without one.
 */

export type ParentAccessMode = 'admin-secret' | 'open-loopback';

export type Config = {
  host: string;
  port: number;
  databasePath: string;
  ollamaUrl: string;
  flashModel: string;
  /** True when bound to anything other than loopback. */
  lanMode: boolean;
  adminSecret: string | null;
  parentAccess: ParentAccessMode;
};

/** Kept as an alias so parent-facing code reads clearly at its call sites. */
export type AppConfig = Config;

/** Addresses that only the local machine can reach. */
const LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  '::1',
  'localhost',
  '0:0:0:0:0:0:0:1',
]);

/**
 * Long enough that a person on the same home network cannot guess it in a few
 * thousand tries. It is typed once into a browser, so length costs the parent
 * almost nothing.
 */
export const MINIMUM_ADMIN_SECRET_LENGTH = 16;

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

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

  const lanMode = !isLoopbackHost(host);
  // An empty or whitespace-only value is a mistake, not a secret.
  const adminSecret = (env.ADMIN_SECRET ?? '').trim() || null;

  if (lanMode && !adminSecret) {
    throw new Error(
      `HOST=${host} exposes this service beyond the local machine. ` +
        'Set ADMIN_SECRET to enable LAN mode, or leave HOST unset to stay ' +
        'loopback-only.',
    );
  }

  if (lanMode && adminSecret && adminSecret.length < MINIMUM_ADMIN_SECRET_LENGTH) {
    throw new Error(
      `ADMIN_SECRET must be at least ${MINIMUM_ADMIN_SECRET_LENGTH} characters ` +
        'to enable LAN mode.',
    );
  }

  return {
    host,
    port,
    databasePath: env.DB_PATH || './data/tutor.sqlite',
    ollamaUrl,
    flashModel,
    lanMode,
    adminSecret,
    // With no secret set on a loopback bind the only caller is someone already
    // sitting at this machine, so parent routes stay open. The privacy summary
    // reports this rather than letting it pass unnoticed.
    parentAccess: adminSecret ? 'admin-secret' : 'open-loopback',
  };
}
