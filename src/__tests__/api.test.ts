import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { apiFetch, ApiError, type ApiFetchOptions } from "../api.js";

// (内部编号) (内部编号) item10 / (内部编号): api.ts had zero implementation-level coverage.
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
    const err = await apiFetch("/api/thing", opts({ token: "t" })).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.url).toBe("https://api.test/api/thing");
    expect(err.body).toEqual({ error: "invalid_query" });
  });

  it("captures a plain-text error body on a non-2xx non-JSON response", async () => {
    stubFetch(
      () => new Response("boom", { status: 500, headers: { "content-type": "text/plain" } })
    );
    const err = await apiFetch("/api/x", opts({ token: "t" })).catch((e) => e);
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
