// SPDX-License-Identifier: MIT
import pc from "picocolors";

import { loadConfig, DEFAULT_BASE_URL, type CliConfig } from "./config.js";
import { argvWantsJsonOutput } from "./output-format.js";
import { IdResolutionError } from "./util/resolve-id.js";
import { sanitizeBlock } from "./util/sanitize.js";
import { assertSafeBaseUrl } from "./util/url.js";

/**
 * Typed error thrown by apiFetch on non-2xx responses, and the base of the subclasses below.
 *
 * The subclasses only add: an existing `err instanceof ApiError && err.status === 404` keeps
 * matching unchanged (a subclass instance is an ApiError, and `status` is filled as before).
 * That is the condition for adding them at all; otherwise a patch upgrade would silently stop a
 * caller's catch from matching.
 */
export class ApiError extends Error {
  status: number;
  body: unknown;
  url: string;
  constructor(status: number, url: string, body: unknown, message?: string) {
    super(message ?? `API ${status} from ${url}`);
    // `new.target.name` rather than a string literal per subclass: a hard-coded name is
    // forgotten when a class is renamed, and then the field lies. No output path reads `name`
    // (formatApiError prints status / url / body), so this changes no byte the CLI prints --
    // only a stack trace's first line and `console.log(err)`.
    this.name = new.target.name;
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/*
 * Subclasses by HTTP status.
 *
 * By status, not by the snake_case `error` code in the response body: that code is finer
 * (`folder_not_empty`, `project_scope_denied`, ...) but it is the server's vocabulary and changes
 * with the product. Turning it into class names would tie the CLI's types to a list that can
 * change under it. Status codes are the stable HTTP-level contract. The body's code is not lost:
 * it stays on `err.body` for callers that need the precise reason.
 *
 * One flat level, no ClientError / ServerError layer in between: "4xx or 5xx?" is answered by
 * `err.status < 500`, and each narrow catch that matters (re-authenticate, fix permissions,
 * re-list ids, back off) maps onto exactly one class below.
 */

/**
 * 401: not authenticated -- no key, a mistyped key, or a key revoked server-side. Get a new key
 * (`synchain login`, or `SYNCHAIN_TOKEN` in CI); retrying with the same key cannot succeed.
 */
export class AuthError extends ApiError {}

/**
 * 403: authenticated, but this key / account may not do this (for example the server's
 * `scope_denied` or `project_scope_denied`). Separate from AuthError because logging in again
 * does not help: fix the key's scope or use a project it can reach.
 */
export class ForbiddenError extends ApiError {}

/**
 * 404: the target does not exist, or is not visible to this identity -- most often an id prefix
 * resolved to something since deleted. List again (`files ls`, `calendar ls`) for current ids.
 */
export class NotFoundError extends ApiError {}

/**
 * 409: a valid request that conflicts with current server state (for example
 * `folder_not_empty`). Change the state first and the same request can succeed -- the opposite
 * retry strategy to ValidationError, which is why the two stay apart.
 */
export class ConflictError extends ApiError {}

/**
 * 400 / 422: the request itself is wrong -- a missing or malformed parameter, or a business rule
 * (changing a file extension, an unknown tag, an end before the start). Both statuses share a
 * class because routes do not draw the line between them consistently.
 *
 * The cost of merging them: `instanceof ValidationError` is **not** `status === 422`. A message
 * that is only true for 422 (files rename: "the extension cannot change" -- the same route's 400
 * means a malformed request) must keep testing the status explicitly.
 */
export class ValidationError extends ApiError {}

/**
 * 429: rate limited. Apart from 5xx because the back-off differs: wait the stated time here,
 * versus exponential back-off with jitter for a server fault.
 */
export class RateLimitError extends ApiError {}

/**
 * 5xx: a server or gateway fault, unrelated to the request's content. Only a backed-off retry
 * helps. The body is often a gateway's HTML error page rather than JSON.
 */
export class ServerError extends ApiError {}

/**
 * The ApiError subclass for an HTTP status. **Every construction site goes through here**
 * (today: apiFetch, and the two direct storage requests in `files`: the download fetch and the
 * upload PUT).
 *
 * A stray `new ApiError(...)` produces an error that never satisfies `instanceof NotFoundError`:
 * nothing fails and no output changes, a caller's narrow catch just never matches. The signature
 * is exactly `new ApiError(...)`'s, so a call site changes by one word.
 *
 * Statuses without a dedicated class (402, 418, 451, codes yet to be used) stay on the base
 * class rather than being filed under the nearest one: calling a 451 a ForbiddenError would
 * send the caller off to fix a key scope that has nothing to do with it.
 */
export function apiErrorFor(
  status: number,
  url: string,
  body: unknown,
  message?: string
): ApiError {
  switch (status) {
    case 400:
    case 422:
      return new ValidationError(status, url, body, message);
    case 401:
      return new AuthError(status, url, body, message);
    case 403:
      return new ForbiddenError(status, url, body, message);
    case 404:
      return new NotFoundError(status, url, body, message);
    case 409:
      return new ConflictError(status, url, body, message);
    case 429:
      return new RateLimitError(status, url, body, message);
  }
  if (status >= 500) return new ServerError(status, url, body, message);
  return new ApiError(status, url, body, message);
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  /** If true, the body is sent as-is (Buffer/stream/string). Otherwise JSON-encoded. */
  rawBody?: boolean;
  headers?: Record<string, string>;
  /** Override config base URL (useful in tests / during login). */
  baseUrl?: string;
  /** Override token (e.g. during login before saveConfig). */
  token?: string | null;
  /** Optional AbortSignal. */
  signal?: AbortSignal;
}

/** Default per-request ceiling for metadata calls so a half-open connection or
 *  slow-loris server can't hang an unattended CLI/agent indefinitely (undici's
 *  own default is 300s). Streaming upload/download use their own stall watchdog. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function joinUrl(base: string, p: string): string {
  if (/^https?:\/\//i.test(p)) {
    // An absolute URL bypasses the baseUrl entirely, so re-assert the https/loopback
    // rule on it too — otherwise a caller (or a server-supplied redirect URL) passing
    // an http:// address would leak the bearer over cleartext despite the baseUrl guard.
    assertSafeBaseUrl(p);
    return p;
  }
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = p.startsWith("/") ? p : `/${p}`;
  return `${trimmedBase}${trimmedPath}`;
}

async function readJsonOrText(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  try {
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Fetches a JSON response from the API. Adds an `Authorization: Bearer` header
 * when a token is in config (or passed via opts.token). Throws an ApiError subclass on non-2xx
 * (see {@link apiErrorFor}).
 */
export async function apiFetch<T = unknown>(
  pathOrUrl: string,
  opts: ApiFetchOptions = {}
): Promise<T> {
  const cfg = await loadConfig();
  const baseUrl = opts.baseUrl ?? cfg?.baseUrl ?? DEFAULT_BASE_URL;
  // Never transmit the bearer key over cleartext http to a remote host.
  assertSafeBaseUrl(baseUrl);
  const token = opts.token === null ? null : (opts.token ?? cfg?.token);
  const url = joinUrl(baseUrl, pathOrUrl);

  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (token && !headers["Authorization"] && !headers["authorization"]) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (opts.rawBody) {
      body = opts.body as BodyInit;
    } else {
      body = JSON.stringify(opts.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  // Bound every metadata request: honor a caller-supplied signal, else a 30s
  // timeout so `files ls` etc. can never hang an unattended agent forever.
  const signal = opts.signal ?? AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS);

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body,
    signal,
  });

  if (!res.ok) {
    const parsed = await readJsonOrText(res);
    throw apiErrorFor(res.status, url, parsed);
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return (await res.json()) as T;
  }
  if (res.status === 204) return undefined as T;
  return (await res.text()) as unknown as T;
}

/** Returns the active project id from the --project flag or config.activeProject. */
export function resolveActiveProject(
  cfg: CliConfig | null,
  flagProject: string | undefined
): string {
  if (flagProject && flagProject.length > 0) return flagProject;
  const ap = cfg?.activeProject;
  if (ap?.id) return ap.id;
  throw new IdResolutionError(
    "No project selected. Pass --project <id> or run `synchain project use <id>`.",
    "no_project_selected"
  );
}

/** Cap on the error body that reaches the terminal, measured after indenting. */
const MAX_ERROR_BODY = 2000;
/**
 * Cap on how many lines an error body may occupy.
 *
 * 40, not 20: the bodies worth reading in full are exactly the tall ones -- a 422 listing one
 * line per rejected field, or a stack trace. Cutting those at 20 costs an agent parsing stderr
 * the diagnostic it came for, while 40 still bounds how much of the preceding output can be
 * scrolled away. The character cap remains the backstop for wide bodies.
 */
const MAX_ERROR_BODY_LINES = 40;

/**
 * Renders a raw error body for the terminal: ANSI-sanitized, indented, and capped.
 *
 * This is the **most reachable** sanitizing point in the CLI, not the least. Every command
 * funnels its failure path through here, and unlike the success paths it does not require
 * getting past authentication first: `readJsonOrText` falls back to `res.text()` whenever the
 * content-type is not JSON, so a `text/plain` 4xx from a compromised deployment — or from
 * whatever server a user was talked into pointing `--base-url` at — would otherwise land in the
 * terminal verbatim. (The JSON branch was already safe: `JSON.stringify` escapes control
 * characters.)
 *
 * `sanitizeBlock`, not `sanitizeInline`: an error body is legitimately multi-line, and folding
 * its newlines into spaces would mangle a stack trace or a wrapped message. Blocks keep newlines
 * and tabs, drop CR, and strip every escape sequence — exactly what an error body needs.
 *
 * Keeping newlines then makes **line structure** its own question, and it takes two caps, not
 * one, because they defend different things:
 *   - every continuation line is indented to match the first, so a body cannot emit a line that
 *     reads as the CLI's own output. Colour is no defence — under `NO_COLOR` or a non-TTY,
 *     picocolors emits nothing, and a non-TTY is exactly where an agent parses stderr;
 *   - the **character** cap keeps a body from flooding stderr;
 *   - the **line** cap keeps it from scrolling away what came before. Those are not the same
 *     limit: 2000 characters of newlines is still ~666 lines, more than enough to push the
 *     `API error <status> <url>` line — printed *first* — out of the scroll-back, which is the
 *     very outcome the cap exists to prevent.
 *
 * The cut is marked. A truncated JSON body is syntactically broken, and unlabelled it reads as
 * the server having returned malformed data.
 *
 * Order is sanitize → indent → cap. Capping last is safe precisely because sanitizing has
 * already removed every escape, so a cut can never leave a bare ESC behind.
 */
export function formatErrorBody(raw: unknown): string {
  const text = typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
  if (!text) return "";
  const indented = sanitizeBlock(text).replace(/\n/g, "\n  ");
  const lines = indented.split("\n");
  const tooLong = indented.length > MAX_ERROR_BODY;
  const tooTall = lines.length > MAX_ERROR_BODY_LINES;
  if (!tooLong && !tooTall) return indented;
  const capped = (tooTall ? lines.slice(0, MAX_ERROR_BODY_LINES).join("\n") : indented).slice(
    0,
    MAX_ERROR_BODY
  );
  return `${capped}\n  … [truncated]`;
}

/**
 * A headline with an error body rendered under it, or the headline alone when there is none.
 *
 * One owner for this composition. It was briefly hand-replicated at the storage-PUT call site in
 * `files.ts`, and a hand-replicated copy of an untested wiring is exactly what drifts: the
 * two-space continuation prefix here is what makes {@link formatErrorBody}'s own indentation line
 * up, so a copy that loses it silently reopens the line-spoofing this all guards against.
 */
export function withErrorBody(headline: string, raw: unknown): string {
  const body = formatErrorBody(raw);
  return body ? `${headline}\n  ${body}` : headline;
}

/**
 * Pretty-prints an ApiError (or any error) for console output.
 *
 * The body goes through {@link formatErrorBody} via {@link withErrorBody}; see there for why
 * that matters. `err.url` needs no sanitizing for the cross-tenant case: every id interpolated
 * into a path goes through `encodeURIComponent`, which turns an ESC into `%1B`. It is not
 * escape-proof in general — `joinUrl` concatenates the raw `--base-url` string, and
 * `assertSafeBaseUrl` parses it without writing the parsed form back — but that content comes
 * from the user's own argv, so it is self-inflicted rather than attacker-supplied.
 */
export function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    return withErrorBody(`API error ${err.status} ${err.url}`, err.body);
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Returns true if the --json flag is set. Centralized so commands share a convention. */
export function wantsJson(opts: { json?: boolean } | undefined): boolean {
  return Boolean(opts?.json);
}

/**
 * Whether stderr should carry JSON when the invocation itself did not ask for it.
 *
 * `SYNCHAIN_ERROR_FORMAT=json|text` decides outright. Otherwise the stream decides: a stderr
 * that is not a terminal is a pipe, a file or an agent harness -- something that parses, not a
 * person reading colours. Any other value of the variable is not a decision, so the stream
 * decides then too.
 */
export function stderrPrefersJson(env: NodeJS.ProcessEnv = process.env): boolean {
  const forced = env.SYNCHAIN_ERROR_FORMAT?.trim().toLowerCase();
  if (forced === "json") return true;
  if (forced === "text") return false;
  return process.stderr.isTTY !== true;
}

/**
 * Whether this run's stderr is read by a machine. Then an error is one JSON envelope line, a
 * warning is one `{"warning":{…}}` line, and progress output is not written at all -- so every
 * line on stderr parses as JSON.
 *
 * Precedence: an explicit `--json` / `--format json` wins, then `SYNCHAIN_ERROR_FORMAT`, then
 * whether stderr is a terminal. A flag is a decision about this one invocation; the variable is
 * ambient, so it only replaces the terminal check.
 *
 * Only the JSON side of the flag counts. `--format` picks the format of a command's *result* on
 * stdout, and `text` is its default: passing `--format text` asks for nothing that omitting it
 * does not, so it is no request for prose errors. What decides stderr is
 * `SYNCHAIN_ERROR_FORMAT` (`=text` gets prose on a pipe too); `--format json` is the one case
 * the flag speaks for stderr as well (like `--json`): a caller that parses the result parses the
 * failure.
 *
 * argv is scanned as well as the flags because `login`, `logout`, `project use` and
 * `files download` declare no `--json`: they have no JSON form of their normal output, but they
 * can still fail, and an agent driving everything with `--format json` should not get prose
 * from exactly those.
 *
 * Known limit: before parsing, argv cannot tell an option from an option value that happens to
 * read `--json` (`discussion post --title --json`). Such a run's errors come out as JSON; that
 * changes the shape of an error, never whether the command runs.
 */
export function wantsStructuredOutput(
  flags?: { json?: boolean },
  argv: readonly string[] = process.argv
): boolean {
  return wantsJson(flags) || argvWantsJsonOutput(argv) || stderrPrefersJson();
}

/**
 * The one line written to stderr when a command fails in structured mode.
 *
 * Deliberately not RFC 9457 `application/problem+json`: that is a format for HTTP response
 * bodies, where `type` must be a dereferenceable URI and `instance` names the request. On a CLI's
 * stderr those could only be made up. A caller needs a line that parses and a code to switch on.
 *
 * All four fields are always present, so a caller can read `.error.code` / `.error.status`
 * without checking first.
 */
export interface ErrorEnvelope {
  error: {
    /**
     * The server's snake_case `error` field when the response has one; otherwise
     * `http_<status>`, `network_error` (no response at all) or a code the CLI assigns to its own
     * checks (`unknown_option`, `missing_argument`, `unauthenticated`, `client_error`, ...).
     */
    code: string;
    /** The HTTP status; 0 when no response was received (network, local IO, input checks). */
    status: number;
    /** The request URL; "" when no request was made. A presigned URL appears without its query. */
    url: string;
    /** Human-readable explanation, the same sentence text mode prints. Sanitized, capped. */
    detail: string;
  };
}

/**
 * Cap on `detail`. A 5xx body is often a gateway's full HTML error page, tens of KB. In text mode
 * that only floods the terminal; in JSON mode it can break the reader: a line-oriented consumer
 * may choke on the line length, and a log pipeline may cut it -- and half a JSON line fails to
 * parse with an error that has nothing to do with the real failure.
 */
const ERROR_DETAIL_MAX_CHARS = 2000;

function truncateDetail(detail: string): string {
  return detail.length <= ERROR_DETAIL_MAX_CHARS
    ? detail
    : `${detail.slice(0, ERROR_DETAIL_MAX_CHARS)}… (truncated)`;
}

/**
 * The snake_case `error` field of an API response body, used as the envelope's code.
 *
 * The API's routes already answer `{ "error": "invalid_project_id" }`, so that value is reused
 * rather than a second status-to-code table kept here: such a table would need an update for
 * every new server code, and a code that disagrees with the server's is worse than none.
 *
 * Only `^[a-z][a-z0-9_]*$` counts. Gateways and some older routes put a sentence, even HTML, in
 * the same slot; that is not something a caller can switch on. It still reaches `detail`.
 */
function apiErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = (body as { error?: unknown }).error;
  if (typeof raw !== "string") return null;
  return /^[a-z][a-z0-9_]*$/.test(raw) ? raw : null;
}

/** The server's `message` when there is one, else the raw body, else the Error message. */
function apiErrorDetail(err: ApiError): string {
  const { body } = err;
  if (typeof body === "string" && body.trim()) return body.trim();
  if (body && typeof body === "object") {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
    return JSON.stringify(body);
  }
  return err.message;
}

/**
 * A request that never got a response: DNS, a refused or reset connection, TLS (undici reports
 * all of them as `TypeError: fetch failed`), or apiFetch's timeout (`TimeoutError`).
 */
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  return err instanceof TypeError && err.message === "fetch failed";
}

/** The code a CLI-side error carries itself (today: an id that could not be resolved). */
function ownCode(err: unknown): string | undefined {
  return err instanceof IdResolutionError ? err.code : undefined;
}

/**
 * Wraps any failure in an ErrorEnvelope.
 *
 * `override.detail` lets a command put its own sentence ("Folder is not empty. …") in the
 * envelope, so text and JSON say the same thing; `override.code` replaces the code (a failed
 * storage PUT is `storage_put_failed`, not whatever the storage host's body says).
 */
export function buildErrorEnvelope(
  err: unknown,
  override: { code?: string; detail?: string } = {}
): ErrorEnvelope {
  if (err instanceof ApiError) {
    return {
      error: {
        // The fallback deliberately does not guess the server's vocabulary (403 -> `forbidden`,
        // 404 -> `not_found`): those are codes the server really sends, and a guessed one would be
        // indistinguishable from a real one. `http_` says "this is only the HTTP status".
        code: override.code ?? apiErrorCode(err.body) ?? `http_${err.status}`,
        status: err.status,
        url: err.url,
        // Sanitized although JSON.stringify escapes ESC as \u001b: a caller that parses the
        // envelope and echoes `detail` to a terminal or a log gets the raw byte back.
        detail: truncateDetail(sanitizeBlock(override.detail ?? apiErrorDetail(err))),
      },
    };
  }
  // No HTTP response: network failures, local IO, an ambiguous or unmatched id prefix, the CLI's
  // own input checks. Status 0 rather than a missing field keeps all four fields present.
  const detail = override.detail ?? (err instanceof Error ? err.message : String(err));
  return {
    error: {
      code:
        override.code ??
        ownCode(err) ??
        (isNetworkError(err) ? "network_error" : "client_error"),
      status: 0,
      url: "",
      detail: truncateDetail(sanitizeBlock(detail)),
    },
  };
}

/**
 * Exit-code categories. 1 stays the catch-all, so "non-zero means failure" keeps working for a
 * script that never looks at the number.
 */
export const EXIT_CODES = {
  ok: 0,
  error: 1,
  usage: 2,
  auth: 3,
  forbidden: 4,
  notFound: 5,
  invalid: 6,
  rateLimited: 7,
  server: 8,
} as const;

/**
 * Codes of failures the CLI detects in the command line itself, before or instead of a request:
 * commander's parse errors (named after its own error codes) and the commands' input checks.
 */
const USAGE_CODES = new Set([
  "unknown_command",
  "unknown_option",
  "invalid_argument",
  "missing_argument",
  "missing_mandatory_option_value",
  "option_missing_argument",
  "excess_arguments",
  "conflicting_option",
  "missing_option",
  "invalid_option",
  "invalid_name",
  "invalid_time_range",
  "nothing_to_update",
  "unknown_topic",
  "insecure_base_url",
  "ambiguous_id",
  "no_project_selected",
]);

/**
 * The exit code for a failure: by ApiError class first (never by comparing status numbers here --
 * the classes are the one mapping from status to category), then by the envelope code for the
 * CLI's own failures.
 *
 * One exception comes before the classes: a failed storage PUT. Its status is the storage host's,
 * not the Synchain API's -- a 403 there is an expired or mismatched presigned signature, fixed by
 * uploading again, not by changing a permission (exit 4) -- so it stays in the catch-all.
 */
export function exitCodeFor(err: unknown, code?: string): number {
  if (code === "storage_put_failed") return EXIT_CODES.error;
  if (err instanceof AuthError) return EXIT_CODES.auth;
  if (err instanceof ForbiddenError) return EXIT_CODES.forbidden;
  if (err instanceof NotFoundError) return EXIT_CODES.notFound;
  if (err instanceof ConflictError || err instanceof ValidationError) return EXIT_CODES.invalid;
  if (err instanceof RateLimitError) return EXIT_CODES.rateLimited;
  if (err instanceof ServerError) return EXIT_CODES.server;
  const own = code ?? ownCode(err);
  if (own === "unauthenticated") return EXIT_CODES.auth;
  // No record behind an id the user typed: the same next step as a 404, another id.
  if (own === "id_not_found") return EXIT_CODES.notFound;
  if (own !== undefined && USAGE_CODES.has(own)) return EXIT_CODES.usage;
  return EXIT_CODES.error;
}

/**
 * The one exit for every command's failure path: sets `process.exitCode` by category, then
 * writes the envelope (structured mode) or the red prose line (text mode, unchanged from before).
 *
 * `message` is the command's own sentence ("Folder is not empty. …"): the text line and the
 * envelope's `detail` both use it. `code` names a failure the CLI detected itself, or replaces
 * the server's code.
 *
 * ⚠ A call site is `reportError(...); return;` -- never `process.exit()`. Exiting right after a
 * `fetch()` makes libuv assert on Windows while undici's socket is still closing
 * (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`), printed to stderr with exit code
 * 127: a non-JSON line and a wrong exit code at once. Setting `process.exitCode` lets the event
 * loop drain and the process end with the right code. The `return` matters for the same reason:
 * unlike `process.exit()`, setting a code does not stop the function.
 *
 * The envelope goes to stderr, not stdout: stdout carries only a command's result, so a `--json`
 * consumer never has to tell a result from an error in the same stream.
 *
 * The argv part of the structured-mode check reads `process.argv`, not the argv handed to
 * `main()`: a command handler has no other copy. The two are the same in a real run; a test that
 * drives `main()` with its own argv and relies on `--format json` for a *command's* failure has
 * to set `process.argv` (or pass `--json` / `SYNCHAIN_ERROR_FORMAT`) as well.
 */
export function reportError(
  err: unknown,
  opts: { json?: boolean; message?: string; code?: string } = {}
): void {
  process.exitCode = exitCodeFor(err, opts.code);
  if (wantsStructuredOutput(opts)) {
    const envelope = buildErrorEnvelope(err, { code: opts.code, detail: opts.message });
    // One line, not indented: an envelope is read line by line or forwarded into a log, and a
    // single line is always a complete record.
    process.stderr.write(`${JSON.stringify(envelope)}\n`);
    return;
  }
  console.error(pc.red(opts.message ?? formatApiError(err)));
}
