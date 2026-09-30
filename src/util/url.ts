// SPDX-License-Identifier: MIT
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

  // Checked before the scheme, and the message never quotes the input: `rawUrl` holds the
  // password here, and this message is printed, put in a JSON envelope, and shown by
  // `synchain doctor` -- the output most often pasted into a log. Nothing is lost by refusing:
  // fetch() will not send a request to a URL with credentials in it anyway.
  if (url.username || url.password) {
    throw new Error(
      `Refusing a base URL with credentials in it (user:pass@${url.host}). ` +
        `Remove them: the CLI authenticates with its key only.`
    );
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
