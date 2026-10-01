// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs, readdirSync, readFileSync, statSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ApiError,
  apiErrorFor,
  apiFetch,
  AuthError,
  buildErrorEnvelope,
  ConflictError,
  ForbiddenError,
  formatApiError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "../api.js";

/**
 * The ApiError subclass hierarchy. Three properties hold each other in check; losing any one
 * turns the change into a breaking one:
 *   1. each status lands in the subclass meant for it (a wrong mapping is worse than none: a
 *      narrow catch would catch the wrong thing);
 *   2. every subclass is still `instanceof ApiError` (every existing catch depends on it);
 *   3. formatApiError and buildErrorEnvelope print a subclass exactly as they print the base
 *      class (adding classes must not change a byte of output, text or JSON).
 */

const URL = "https://api.test/api/projects/p/files/f";

const SUBCLASSES = [
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  ServerError,
];

describe("apiErrorFor: status → subclass", () => {
  const cases: Array<[number, string, typeof ApiError]> = [
    [400, "ValidationError", ValidationError],
    [401, "AuthError", AuthError],
    [403, "ForbiddenError", ForbiddenError],
    [404, "NotFoundError", NotFoundError],
    [409, "ConflictError", ConflictError],
    [422, "ValidationError", ValidationError],
    [429, "RateLimitError", RateLimitError],
    [500, "ServerError", ServerError],
    [502, "ServerError", ServerError],
    [503, "ServerError", ServerError],
    [599, "ServerError", ServerError],
  ];

  it.each(cases)("%i → %s", (status, name, Cls) => {
    const err = apiErrorFor(status, URL, { error: "x" });
    expect(err).toBeInstanceOf(Cls);
    expect(err.constructor).toBe(Cls);
    expect(err.status).toBe(status);
    expect(err.url).toBe(URL);
    expect(err.body).toEqual({ error: "x" });
    // `name` follows the class, so a stack trace or console.log says which kind it was.
    expect(err.name).toBe(name);
  });

  it("leaves statuses without a dedicated subclass on the base class", () => {
    // 402 (payment required) and 451 (legal takedown) are not "forbidden": filing them under
    // ForbiddenError would send the caller off to fix a key scope that has nothing to do with it.
    for (const status of [402, 405, 410, 418, 451]) {
      const err = apiErrorFor(status, URL, null);
      expect(err.constructor).toBe(ApiError);
      expect(err.name).toBe("ApiError");
      expect(err.status).toBe(status);
    }
  });

  it("keeps the `new ApiError(...)` signature, including the optional message", () => {
    expect(apiErrorFor(404, URL, null).message).toBe(`API 404 from ${URL}`);
    expect(apiErrorFor(404, URL, null, "custom").message).toBe("custom");
  });
});

describe("backward compatibility", () => {
  it("every subclass is instanceof ApiError and Error", () => {
    for (const Cls of SUBCLASSES) {
      const err = new Cls(500, URL, null);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe(Cls.name);
    }
  });

  it("the base class still reports its own name", () => {
    expect(new ApiError(404, URL, null).name).toBe("ApiError");
  });

  it("the existing `instanceof ApiError && status === NNN` checks still match", () => {
    // The shape of every catch in src/commands. files rename keeps an explicit `status === 422`
    // (ValidationError also covers 400, where its hint would be wrong), so this must stay true.
    const err: unknown = apiErrorFor(422, URL, { error: "extension_change" });
    expect(err instanceof ApiError && err.status === 422).toBe(true);
    expect(err instanceof ValidationError).toBe(true);
  });

  it("formatApiError prints a subclass exactly as it prints the base class", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 502]) {
      const body = { error: "some_code", message: "human words" };
      expect(formatApiError(apiErrorFor(status, URL, body))).toBe(
        formatApiError(new ApiError(status, URL, body))
      );
    }
  });

  it("buildErrorEnvelope prints a subclass exactly as it prints the base class", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 502]) {
      const body = { error: "some_code", message: "human words" };
      expect(JSON.stringify(buildErrorEnvelope(apiErrorFor(status, URL, body)))).toBe(
        JSON.stringify(buildErrorEnvelope(new ApiError(status, URL, body)))
      );
    }
  });

  it("the envelope's code still comes from the response body, never from the class name", () => {
    // The class is the CLI's grouping by status; the code is the server's own judgement. A code
    // derived from the class (`forbidden_error`) would no longer match the HTTP API's error table.
    expect(
      buildErrorEnvelope(apiErrorFor(403, URL, { error: "project_scope_denied" })).error.code
    ).toBe("project_scope_denied");
    // No usable code in the body: http_<status>, not a guessed word such as `not_found`.
    expect(buildErrorEnvelope(apiErrorFor(404, URL, "<html/>")).error.code).toBe("http_404");
  });
});

describe("apiFetch throws the subclass for the response status", () => {
  let tmpDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    // Isolate config lookup so apiFetch's loadConfig() never reads a real login.
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "synchain-api-errors-test-"));
    for (const key of ["HOME", "APPDATA", "XDG_CONFIG_HOME"]) {
      saved[key] = process.env[key];
      process.env[key] = tmpDir;
    }
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it.each([
    [401, "AuthError", AuthError],
    [403, "ForbiddenError", ForbiddenError],
    [404, "NotFoundError", NotFoundError],
    [409, "ConflictError", ConflictError],
    [422, "ValidationError", ValidationError],
    [429, "RateLimitError", RateLimitError],
    [503, "ServerError", ServerError],
  ] as const)("%i → %s", async (status, name, Cls) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "boom" }), {
            status,
            headers: { "content-type": "application/json" },
          })
        )
      )
    );
    const err = (await apiFetch("/api/x", { baseUrl: "https://api.test", token: "t" }).catch(
      (e: unknown) => e
    )) as ApiError;
    expect(err).toBeInstanceOf(Cls);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe(name);
    expect(err.status).toBe(status);
    expect(err.url).toBe("https://api.test/api/x");
    expect(err.body).toEqual({ error: "boom" });
  });
});

describe("every construction site goes through apiErrorFor", () => {
  /**
   * A stray `new ApiError(...)` produces an error that never satisfies `instanceof NotFoundError`.
   * Nothing fails and no output changes; a caller's narrow catch just never matches. Only a
   * source scan catches that.
   */
  it("no module other than api.ts constructs an ApiError (or subclass) directly", () => {
    const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const sources: string[] = [];
    const collect = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== "__tests__") collect(full);
        } else if (entry.endsWith(".ts") && full !== path.join(srcDir, "api.ts")) {
          sources.push(full);
        }
      }
    };
    collect(srcDir);
    expect(sources.length).toBeGreaterThan(10);

    const pattern =
      /new\s+(ApiError|AuthError|ForbiddenError|NotFoundError|ConflictError|ValidationError|RateLimitError|ServerError)\s*\(/;
    const offenders = sources.filter((file) => pattern.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => path.relative(srcDir, file))).toEqual([]);
  });
});
