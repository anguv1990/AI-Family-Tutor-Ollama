/**
 * Startup configuration and the network posture that depends on it.
 *
 * `plan.md` treats loopback-only as a product requirement, not a default to be
 * casually overridden: the app holds a child's learning record and has no user
 * accounts, so anything that can reach the port can read it. Binding anywhere
 * other than loopback therefore has to be a deliberate act that also supplies
 * an admin secret, and this module refuses to start otherwise.
 */

/** Addresses that only the local machine can reach. */
const LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '0:0:0:0:0:0:0:1',
]);

/**
 * Long enough that a secret cannot be guessed by a person on the same home
 * network in a few thousand tries. It is typed once into a browser, so length
 * costs the parent almost nothing.
 */
export const MINIMUM_ADMIN_SECRET_LENGTH = 16;

export type ParentAccessMode = 'admin-secret' | 'open-loopback';

export type AppConfig = {
  host: string;
  port: number;
  databasePath: string;
  /** True when the bind address is reachable from outside this machine. */
  lanMode: boolean;
  adminSecret: string | null;
  parentAccess: ParentAccessMode;
};

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

/**
 * Throws on invalid configuration. These messages are startup-only and never
 * reach an HTTP response, so they can say exactly what is wrong.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.HOST || '127.0.0.1';
  const port = Number(env.PORT || 3000);
  const databasePath = env.DB_PATH || './data/tutor.sqlite';

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

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
    databasePath,
    lanMode,
    adminSecret,
    // With no secret set on a loopback bind the only caller is someone already
    // sitting at this machine, so parent routes stay open. The privacy summary
    // reports this rather than letting it pass unnoticed.
    parentAccess: adminSecret ? 'admin-secret' : 'open-loopback',
  };
}
