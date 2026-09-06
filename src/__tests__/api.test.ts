// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  apiFetch,
  ApiError,
  formatApiError,
  withErrorBody,
  resolveActiveProject,
  wantsJson,
  type ApiFetchOptions,
} from "../api.js";

// api.ts had zero implementation-level coverage.
// These pin apiFetch's networked contract with a stubbed fetch — the Authorization
// injection, joinUrl's absolute-URL branch (incl. its https guard), ApiError parsing,
// and the 204 / non-JSON body paths — the CLI's most regression-prone surface.

const BASE = "https://api.test";

let tmpDir: string;
let origHome: string | undefined;
let origAppData: string | undefined;
let origXdg: string | undefined;

beforeEach(async () => {
  // Isolate config lookup so apiFetch's internal loadConfig() finds no file and
  // returns null — every test drives baseUrl/token explicitly via opts, never a
  // real config on the host running the suite.
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "synchain-api-test-"));
  origHome = process.env.HOME;
  origAppData = process.env.APPDATA;
  origXdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = tmpDir;
  process.env.APPDATA = tmpDir;
  process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = origAppData;
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = origXdg;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

/** Stub the global fetch with a canned Response factory; returns the spy for arg assertions. */
function stubFetch(makeRes: () => Response) {
  const spy = vi.fn((_url: string, _init?: FetchInit) => Promise.resolve(makeRes()));
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** Base opts with a non-aborting signal so no default 30s timeout timer is created. */
function opts(extra: Partial<ApiFetchOptions> = {}): ApiFetchOptions {
  return { baseUrl: BASE, signal: new AbortController().signal, ...extra };
}

describe("apiFetch", () => {
  it("joins a relative path onto the base URL, injects Bearer, and parses JSON", async () => {
    const spy = stubFetch(
      () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    const res = await apiFetch<{ ok: boolean }>("/api/thing", opts({ token: "synch_live_sk_x" }));
    expect(res).toEqual({ ok: true });

    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://api.test/api/thing");
    expect(init?.headers?.["Authorization"]).toBe("Bearer synch_live_sk_x");
  });

  it("omits Authorization when no token is available", async () => {
    const spy = stubFetch(() => new Response(null, { status: 204 }));
    await apiFetch("/api/thing", opts({ token: null }));
    const headers = spy.mock.calls[0]![1]?.headers ?? {};
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["authorization"]).toBeUndefined();
  });

  it("returns undefined for a 204 No Content", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    const res = await apiFetch("/api/thing", opts({ token: null }));
    expect(res).toBeUndefined();
  });

  it("returns the raw text for a non-JSON 200 response", async () => {
    stubFetch(
      () => new Response("plain body", { status: 200, headers: { "content-type": "text/plain" } })
    );
    const res = await apiFetch<string>("/api/thing", opts({ token: null }));
    expect(res).toBe("plain body");
  });

  it("throws ApiError with status, url, and parsed JSON body on non-2xx", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: "invalid_query" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })
    );
    const err = (await apiFetch("/api/thing", opts({ token: "t" })).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.url).toBe("https://api.test/api/thing");
    expect(err.body).toEqual({ error: "invalid_query" });
  });

  it("captures a plain-text error body on a non-2xx non-JSON response", async () => {
    stubFetch(
      () => new Response("boom", { status: 500, headers: { "content-type": "text/plain" } })
    );
    const err = (await apiFetch("/api/x", opts({ token: "t" })).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.body).toBe("boom");
  });

  it("uses an absolute https URL verbatim (joinUrl absolute branch), ignoring baseUrl", async () => {
    const spy = stubFetch(() => new Response(null, { status: 204 }));
    await apiFetch("https://other.test/signed/path?x=1", opts({ token: null }));
    expect(spy.mock.calls[0]![0]).toBe("https://other.test/signed/path?x=1");
  });

  it("rejects an absolute cleartext-http URL before any fetch, so the bearer can't leak", async () => {
    const spy = stubFetch(() => new Response(null, { status: 200 }));
    await expect(apiFetch("http://evil.test/x", opts({ token: "secret" }))).rejects.toThrow(
      /insecure http/i
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("apiFetch body + header handling", () => {
  it("JSON-encodes a body and sets Content-Type on POST", async () => {
    const spy = stubFetch(() => new Response(null, { status: 204 }));
    await apiFetch("/api/thing", opts({ method: "POST", body: { a: 1 }, token: null }));
    const init = spy.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.headers?.["Content-Type"]).toBe("application/json");
  });

  it("passes rawBody through verbatim without JSON encoding", async () => {
    const spy = stubFetch(() => new Response(null, { status: 204 }));
    await apiFetch(
      "/api/thing",
      opts({ method: "PUT", rawBody: true, body: "raw-bytes", token: null })
    );
    const init = spy.mock.calls[0]![1]!;
    expect(init.body).toBe("raw-bytes");
    expect(init.headers?.["Content-Type"]).toBeUndefined();
  });

  it("does not override a caller-supplied Content-Type header", async () => {
    const spy = stubFetch(() => new Response(null, { status: 204 }));
    await apiFetch(
      "/api/thing",
      opts({ method: "POST", body: { a: 1 }, headers: { "Content-Type": "application/custom" }, token: null })
    );
    const init = spy.mock.calls[0]![1]!;
    expect(init.headers?.["Content-Type"]).toBe("application/custom");
  });

  it("does not override a caller-supplied Authorization header", async () => {
    const spy = stubFetch(() => new Response(null, { status: 204 }));
    await apiFetch(
      "/api/thing",
      opts({ token: "synch_live_sk_x", headers: { Authorization: "Bearer custom" } })
    );
    const init = spy.mock.calls[0]![1]!;
    expect(init.headers?.["Authorization"]).toBe("Bearer custom");
  });

  it("attaches a default AbortSignal when none is provided", async () => {
    const spy = stubFetch(() => new Response(null, { status: 204 }));
    await apiFetch("/api/thing", { baseUrl: BASE, token: null });
    const init = spy.mock.calls[0]![1]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("treats a non-2xx response with unparseable JSON as a null body", async () => {
    stubFetch(
      () => new Response("{not-json", { status: 502, headers: { "content-type": "application/json" } })
    );
    const err = (await apiFetch("/api/x", opts({ token: "t" })).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.body).toBeNull();
  });

  it("allows an absolute http loopback URL (local dev)", async () => {
    const spy = stubFetch(() => new Response(null, { status: 204 }));
    await apiFetch("http://localhost:3000/x", opts({ token: null }));
    expect(spy.mock.calls[0]![0]).toBe("http://localhost:3000/x");
  });
});

describe("resolveActiveProject", () => {
  it("prefers the --project flag", () => {
    expect(resolveActiveProject({ activeProject: { id: "cfg-id" } }, "flag-id")).toBe("flag-id");
  });

  it("falls back to config.activeProject.id", () => {
    expect(resolveActiveProject({ activeProject: { id: "cfg-id" } }, undefined)).toBe("cfg-id");
  });

  it("throws when no project is selected", () => {
    expect(() => resolveActiveProject(null, undefined)).toThrow(/No project selected/);
    expect(() => resolveActiveProject({}, "")).toThrow(/No project selected/);
  });
});

describe("formatApiError", () => {
  it("formats an ApiError with a string body", () => {
    expect(formatApiError(new ApiError(404, "https://x", "not found"))).toBe(
      "API error 404 https://x\n  not found"
    );
  });

  it("formats an ApiError with an object body as JSON", () => {
    expect(formatApiError(new ApiError(422, "https://x", { error: "bad" }))).toBe(
      'API error 422 https://x\n  {"error":"bad"}'
    );
  });

  it("formats an ApiError with no body", () => {
    expect(formatApiError(new ApiError(500, "https://x", undefined))).toBe(
      "API error 500 https://x"
    );
  });

  it("strips ANSI escapes from a text/plain error body", () => {
    // `readJsonOrText` falls back to `res.text()` whenever the content-type is not JSON, so
    // this branch carries raw server text — and it is the *failure* path, reachable without
    // ever getting past authentication (a `--base-url` pointed at a hostile server is enough).
    const body = "\u001b[2K\rforbidden\u001b]0;pwned\u0007";
    const out = formatApiError(new ApiError(403, "https://x", body));
    expect(out).not.toContain("\u001b");
    expect(out).toContain("forbidden");
  });

  it("keeps newlines in a multi-line body but indents every continuation line", () => {
    // sanitizeBlock, not sanitizeInline: an error body is legitimately multi-line, and folding
    // its newlines into spaces would mangle a stack trace. Keeping them makes line structure
    // its own question — an unindented second line is indistinguishable from the CLI's own
    // output, and colour is no defence under NO_COLOR or a non-TTY, which is exactly where an
    // agent parses stderr.
    expect(formatApiError(new ApiError(500, "https://x", "line one\nline two"))).toBe(
      "API error 500 https://x\n  line one\n  line two"
    );
  });

  it("caps a runaway error body and marks the cut", () => {
    // Diagnostic, not a payload: an unbounded body buries whatever the user needed to read.
    // The marker matters too — a truncated JSON body is syntactically broken, and unlabelled
    // it reads as the server having returned malformed data.
    const out = formatApiError(new ApiError(500, "https://x", "a".repeat(5000)));
    expect(out.length).toBeLessThan(2200);
    expect(out).toContain("aaaa");
    expect(out).toContain("[truncated]");
  });

  it("caps line count, not just characters", () => {
    // The two caps defend different things and are not interchangeable. 2000 characters of
    // newlines is still ~666 lines — more than enough to scroll the `API error <status> <url>`
    // line, printed *first*, out of the reader's scroll-back, which is the very outcome the cap
    // exists to prevent. Characters bound how much stderr is flooded; lines bound how much of
    // what came before survives.
    const out = formatApiError(new ApiError(500, "https://x", "line\n".repeat(500)));
    expect(out.split("\n").length).toBeLessThan(45);
    expect(out).toContain("[truncated]");
  });

  it("counts the indent it adds when measuring against the character cap", () => {
    // Deliberately sized to be *discriminating*: 20 lines of 99 characters is 1999 characters
    // raw — just under the 2000 cap — but 2037 once each continuation line gains its two-space
    // prefix. Measure before indenting and this body passes through whole; measure after and it
    // is cut. (An earlier version of this test used 2000 newlines, which tripped the line cap
    // first and so proved nothing about the character path.)
    const body = Array.from({ length: 20 }, () => "a".repeat(99)).join("\n");
    const out = formatApiError(new ApiError(500, "https://x", body));
    expect(out).toContain("[truncated]");
    // And the cap actually bounds the output — the discriminating assertion above says *that*
    // truncation happened; this one says it was worth doing.
    expect(out.length).toBeLessThan(2200);
  });

  it("withErrorBody omits the body block entirely when there is nothing to show", () => {
    // The storage-PUT call site composes through this too, so the shape has one owner. A copy
    // that lost the two-space prefix would silently reopen the line-spoofing the indent guards.
    expect(withErrorBody("Storage PUT failed: 500", "")).toBe("Storage PUT failed: 500");
    expect(withErrorBody("Storage PUT failed: 500", "boom")).toBe(
      "Storage PUT failed: 500\n  boom"
    );
  });

  it("returns the message for a generic Error", () => {
    expect(formatApiError(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error values", () => {
    expect(formatApiError("oops")).toBe("oops");
  });
});

describe("wantsJson", () => {
  it("returns true only when the json flag is set", () => {
    expect(wantsJson({ json: true })).toBe(true);
    expect(wantsJson({})).toBe(false);
    expect(wantsJson(undefined)).toBe(false);
  });
});
