/**
 * Base-URL safety guard. A Synchain CLI key (`synch_live_sk_…`) is a
 * service-role-grade bearer, so it must never leave the machine over cleartext
 * http to a remote host. `https:` is always allowed; `http:` is allowed only to
 * loopback (local dev). Everything else throws. Call this wherever the base URL
 * is finalized so every request path (login, apiFetch, the raw download fetch)
 * is covered before any token is transmitted.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertSafeBaseUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid base URL: ${rawUrl}`);
  }

  if (url.protocol === "https:") return;
  if (url.protocol === "http:") {
    if (LOOPBACK_HOSTS.has(url.hostname)) return;
    throw new Error(
      `Refusing to send your CLI key over insecure http to ${url.host}. ` +
        `Use https:// (http:// is allowed only for localhost during local dev).`
    );
  }
  throw new Error(`Unsupported base URL scheme "${url.protocol}" in ${rawUrl} — use https://.`);
}
