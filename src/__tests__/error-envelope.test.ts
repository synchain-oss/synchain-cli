// SPDX-License-Identifier: MIT
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import pc from "picocolors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiErrorFor,
  buildErrorEnvelope,
  formatApiError,
  reportError,
  stderrPrefersJson,
  wantsStructuredOutput,
} from "../api.js";
import { DEFAULT_BASE_URL } from "../config.js";
import { IdResolutionError } from "../util/resolve-id.js";

/**
 * The JSON error envelope on stderr.
 *
 * `--json` makes stdout machine-readable, but a failure used to print coloured prose on stderr,
 * which an agent could only pick apart with a regex that breaks the day the wording changes.
 * What these cases hold in place:
 *   1. in structured mode the stderr line parses as JSON, and it is exactly one line;
 *   2. `code` is the server's own snake_case `error` field, not a vocabulary invented here;
 *   3. text mode prints exactly what it printed before (people and old scripts read it);
 *   4. nothing that reaches the envelope carries a terminal escape or a presigned URL's query.
 */

const URL = "https://api.test/api/projects/p/files/f";
const ESC = String.fromCharCode(27);

let stderrChunks: string[];
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
const savedFormat = process.env.SYNCHAIN_ERROR_FORMAT;

beforeEach(() => {
  stderrChunks = [];
  // vitest's stderr is not a TTY, which now means JSON by default; most cases here pin a mode.
  process.env.SYNCHAIN_ERROR_FORMAT = "text";
  // process.exitCode is process-wide: left set, it would make vitest itself exit non-zero.
  process.exitCode = undefined;
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (savedFormat === undefined) delete process.env.SYNCHAIN_ERROR_FORMAT;
  else process.env.SYNCHAIN_ERROR_FORMAT = savedFormat;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

/** Every non-empty stderr line, each parsed as JSON (the parse failing is the assertion). */
function stderrRecords(): Array<Record<string, unknown>> {
  return stderrChunks
    .join("")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      expect(() => JSON.parse(line) as unknown, `not a JSON line: ${line}`).not.toThrow();
      return JSON.parse(line) as Record<string, unknown>;
    });
}

describe("buildErrorEnvelope", () => {
  it("reuses the server's snake_case `error` field as the code", () => {
    const err = apiErrorFor(403, URL, { error: "project_scope_denied" });
    expect(buildErrorEnvelope(err).error).toMatchObject({
      code: "project_scope_denied",
      status: 403,
      url: URL,
    });
  });

  it("falls back to http_<status> when the body carries no usable code", () => {
    // A 502 is often a gateway's HTML page rather than JSON.
    const { error } = buildErrorEnvelope(apiErrorFor(502, URL, "<html>Bad Gateway</html>"));
    // Deliberately not a guessed word like `bad_gateway`: the prefix says "this is the HTTP
    // status", not "this is what the server decided".
    expect(error.code).toBe("http_502");
    expect(error.detail).toContain("Bad Gateway");
  });

  it("rejects a prose sentence in the `error` slot (a code has to be switchable)", () => {
    const { error } = buildErrorEnvelope(
      apiErrorFor(500, URL, { error: "Something went terribly wrong" })
    );
    expect(error.code).toBe("http_500");
    // The sentence is not lost; it moves to detail.
    expect(error.detail).toContain("Something went terribly wrong");
  });

  it("prefers the server's `message` for detail", () => {
    const { error } = buildErrorEnvelope(
      apiErrorFor(422, URL, { error: "invalid_body", message: "name is too long" })
    );
    expect(error).toMatchObject({ code: "invalid_body", detail: "name is too long" });
  });

  it("falls back to the error's own message when the response had no body", () => {
    expect(buildErrorEnvelope(apiErrorFor(404, URL, null)).error).toEqual({
      code: "http_404",
      status: 404,
      url: URL,
      detail: `API 404 from ${URL}`,
    });
    const blank = buildErrorEnvelope(apiErrorFor(503, URL, "  "));
    expect(blank.error.detail).toBe(`API 503 from ${URL}`);
  });

  it("wraps a local failure (IO, anything unclassified) as client_error with status 0", () => {
    const { error } = buildErrorEnvelope(new Error("EACCES: permission denied, open 'take.wav'"));
    expect(error).toMatchObject({ code: "client_error", status: 0, url: "" });
    expect(error.detail).toContain("EACCES");
  });

  it("uses an unresolvable id's own code: id_not_found / ambiguous_id / no_project_selected", () => {
    const ambiguous = new IdResolutionError(
      'file prefix "a1b2" is ambiguous (matches 3).',
      "ambiguous_id"
    );
    expect(buildErrorEnvelope(ambiguous).error).toEqual({
      code: "ambiguous_id",
      status: 0,
      url: "",
      detail: 'file prefix "a1b2" is ambiguous (matches 3).',
    });
    const missing = new IdResolutionError('No folder matches "zz".', "id_not_found");
    expect(buildErrorEnvelope(missing).error.code).toBe("id_not_found");
    // A command's explicit code still wins.
    expect(buildErrorEnvelope(missing, { code: "other" }).error.code).toBe("other");
  });

  it("marks a request that never got a response as network_error", () => {
    // What undici throws for DNS failures, refused connections, resets and TLS errors.
    expect(buildErrorEnvelope(new TypeError("fetch failed")).error).toMatchObject({
      code: "network_error",
      status: 0,
      url: "",
    });
    // What AbortSignal.timeout() (apiFetch's 30 s ceiling) rejects with.
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(buildErrorEnvelope(timeout).error.code).toBe("network_error");
    // Any other TypeError is a bug or bad input, not the network.
    expect(buildErrorEnvelope(new TypeError("x is not a function")).error.code).toBe(
      "client_error"
    );
  });

  it("keeps all four fields present so callers never have to check for existence", () => {
    const { error } = buildErrorEnvelope("a thrown string");
    expect(Object.keys(error).sort()).toEqual(["code", "detail", "status", "url"]);
    expect(error.detail).toBe("a thrown string");
  });

  it("truncates a huge body so the envelope stays one parseable line", () => {
    const err = apiErrorFor(500, URL, "x".repeat(50_000));
    const { error } = buildErrorEnvelope(err);
    expect(error.detail.length).toBeLessThan(2_100);
    expect(error.detail.endsWith("… (truncated)")).toBe(true);
    expect(() => JSON.parse(JSON.stringify(buildErrorEnvelope(err))) as unknown).not.toThrow();
  });

  it("lets a command put its own wording in `detail`, keeping the server's code", () => {
    const err = apiErrorFor(409, URL, { error: "folder_not_empty" });
    const { error } = buildErrorEnvelope(err, {
      detail: "Folder is not empty. Delete its files / sub-folders first.",
    });
    expect(error.code).toBe("folder_not_empty");
    expect(error.detail).toBe("Folder is not empty. Delete its files / sub-folders first.");
  });

  it("lets a command override the code", () => {
    const err = apiErrorFor(403, URL, "<Error><Code>AccessDenied</Code></Error>");
    expect(buildErrorEnvelope(err, { code: "storage_put_failed" }).error).toMatchObject({
      code: "storage_put_failed",
      status: 403,
    });
  });

  it("strips terminal escapes from detail, even though JSON.stringify would escape them", () => {
    // An agent that parses the envelope and echoes `detail` to a terminal or a log gets the raw
    // byte back from the \u001b escape, so escaping alone is not enough.
    const env = buildErrorEnvelope(
      apiErrorFor(401, URL, `${ESC}[2J${ESC}[31mEVIL${ESC}[0m text`)
    );
    expect(env.error.detail).toBe("EVIL text");
    expect((JSON.parse(JSON.stringify(env)) as typeof env).error.detail).not.toContain(ESC);

    const local = buildErrorEnvelope(new Error(`bad ${ESC}]0;title${String.fromCharCode(7)}name`));
    expect(local.error.detail).not.toContain(ESC);
    const override = buildErrorEnvelope(new Error("x"), { detail: `a${ESC}[2Kb` });
    expect(override.error.detail).toBe("ab");
  });
});

describe("when stderr is structured", () => {
  const isTTY = process.stderr.isTTY;
  afterEach(() => {
    Object.defineProperty(process.stderr, "isTTY", { value: isTTY, configurable: true });
  });

  it("follows the stream when nothing is forced: JSON unless stderr is a terminal", () => {
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    expect(stderrPrefersJson({})).toBe(false);
    Object.defineProperty(process.stderr, "isTTY", { value: undefined, configurable: true });
    expect(stderrPrefersJson({})).toBe(true);
  });

  it("SYNCHAIN_ERROR_FORMAT overrides the stream either way (case and spaces ignored)", () => {
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    expect(stderrPrefersJson({ SYNCHAIN_ERROR_FORMAT: "json" })).toBe(true);
    expect(stderrPrefersJson({ SYNCHAIN_ERROR_FORMAT: " JSON " })).toBe(true);
    Object.defineProperty(process.stderr, "isTTY", { value: undefined, configurable: true });
    expect(stderrPrefersJson({ SYNCHAIN_ERROR_FORMAT: "text" })).toBe(false);
    // An unknown value is not a decision: the stream decides.
    expect(stderrPrefersJson({ SYNCHAIN_ERROR_FORMAT: "yaml" })).toBe(true);
  });

  it("an explicit --json / --format json wins over SYNCHAIN_ERROR_FORMAT=text", () => {
    process.env.SYNCHAIN_ERROR_FORMAT = "text";
    const plain = ["node", "synchain", "files", "ls"];
    expect(wantsStructuredOutput({}, plain)).toBe(false);
    expect(wantsStructuredOutput({ json: true }, plain)).toBe(true);
    expect(wantsStructuredOutput({}, [...plain, "--json"])).toBe(true);
    expect(wantsStructuredOutput({}, ["node", "synchain", "--format", "json", "login"])).toBe(true);
    expect(wantsStructuredOutput({}, ["node", "synchain", "login", "--format=json"])).toBe(true);
  });

  it("--format text is no request for prose errors: stdout's format, and the default", () => {
    // SYNCHAIN_ERROR_FORMAT is the stderr switch; `--format text` changes nothing on stderr.
    delete process.env.SYNCHAIN_ERROR_FORMAT;
    Object.defineProperty(process.stderr, "isTTY", { value: undefined, configurable: true });
    const argv = ["node", "synchain", "--format", "text", "files", "ls"];
    expect(wantsStructuredOutput({}, argv)).toBe(true);
    process.env.SYNCHAIN_ERROR_FORMAT = "text";
    expect(wantsStructuredOutput({}, argv)).toBe(false);
  });

  it("with nothing set, a non-TTY stderr is structured and a TTY is not", () => {
    delete process.env.SYNCHAIN_ERROR_FORMAT;
    const plain = ["node", "synchain", "files", "ls"];
    Object.defineProperty(process.stderr, "isTTY", { value: undefined, configurable: true });
    expect(wantsStructuredOutput({}, plain)).toBe(true);
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    expect(wantsStructuredOutput({}, plain)).toBe(false);
  });
});

describe("reportError", () => {
  it("writes exactly one JSON.parse-able line to stderr in JSON mode", () => {
    reportError(apiErrorFor(404, URL, { error: "file_not_found" }), { json: true });

    expect(stderrChunks).toHaveLength(1);
    const line = stderrChunks[0]!;
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trim().includes("\n")).toBe(false);
    const parsed = JSON.parse(line) as { error: { code: string; status: number } };
    expect(parsed).toEqual({
      error: {
        code: "file_not_found",
        status: 404,
        url: URL,
        detail: '{"error":"file_not_found"}',
      },
    });
    // Not also through console.error: the same failure must not appear twice in two shapes.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("uses JSON without any flag when SYNCHAIN_ERROR_FORMAT=json", () => {
    process.env.SYNCHAIN_ERROR_FORMAT = "json";
    reportError(new Error("No project selected."));
    expect(stderrRecords()).toEqual([
      { error: { code: "client_error", status: 0, url: "", detail: "No project selected." } },
    ]);
  });

  it("leaves the text-mode output byte-for-byte unchanged", () => {
    const err = apiErrorFor(403, URL, { error: "forbidden" });
    reportError(err);
    // The line every catch block printed before: `console.error(pc.red(formatApiError(err)))`.
    expect(consoleErrorSpy).toHaveBeenCalledWith(pc.red(formatApiError(err)));
    expect(stderrChunks).toEqual([]);
  });

  it("keeps formatApiError's own prose intact", () => {
    const err = apiErrorFor(403, URL, { error: "forbidden" });
    expect(formatApiError(err)).toBe(`API error 403 ${URL}\n  {"error":"forbidden"}`);
  });

  it("uses a command's own message for the text line and for the envelope's detail alike", () => {
    const err = apiErrorFor(422, URL, { error: "extension_change_not_allowed" });
    reportError(err, { message: "Extension cannot be changed." });
    expect(consoleErrorSpy).toHaveBeenCalledWith(pc.red("Extension cannot be changed."));

    consoleErrorSpy.mockClear();
    reportError(err, { json: true, message: "Extension cannot be changed." });
    expect(stderrRecords()[0]).toMatchObject({
      error: { code: "extension_change_not_allowed", detail: "Extension cannot be changed." },
    });
  });
});

/**
 * End to end through real command handlers: the catch block delivers the envelope to stderr and
 * stdout stays clean. Testing reportError alone is not enough -- what this change touched is the
 * one line in every catch block, and missing one of them is the likeliest regression.
 *
 * `fetch` is stubbed globally and the config dir points at an empty temp dir, so apiFetch runs
 * for real (default base URL, no token) without any request leaving the process.
 */
describe("command handlers", () => {
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};
  let stdout: string[];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "synchain-envelope-test-"));
    for (const key of ["HOME", "APPDATA", "XDG_CONFIG_HOME"]) {
      savedEnv[key] = process.env[key];
      process.env[key] = tmpDir;
    }
    stdout = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(" "));
    });
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("members ls --json: envelope on stderr, nothing on stdout, exit code by class", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(403, { error: "scope_denied" }))
    );
    const { runMembersLs } = await import("../commands/members.js");
    await runMembersLs({ project: "p", json: true });

    expect(stdout).toEqual([]);
    const [record] = stderrRecords();
    expect(record).toMatchObject({ error: { code: "scope_denied", status: 403 } });
    expect(process.exitCode).toBe(4);
  });

  it("whoami without a stored key reports `unauthenticated` (exit 3)", async () => {
    const { runWhoami } = await import("../commands/whoami.js");
    await runWhoami({ json: true });
    expect(stderrRecords()).toEqual([
      {
        error: {
          code: "unauthenticated",
          status: 0,
          url: "",
          detail: "Not logged in. Run `synchain login`.",
        },
      },
    ]);
    expect(process.exitCode).toBe(3);
  });

  it("a command without --json still gets the envelope when stderr is machine-read", async () => {
    // Called without --json: the stream decides.
    const FOLDER_ID = "a1b2c3d4-0000-4000-8000-000000000000";
    delete process.env.SYNCHAIN_ERROR_FORMAT;
    const isTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: undefined, configurable: true });
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          if ((init?.method ?? "GET") === "GET") {
            return json(200, { folders: [{ id: FOLDER_ID, name: "Stems" }] });
          }
          return json(409, { error: "folder_not_empty" });
        })
      );
      const { runFoldersRm } = await import("../commands/folders.js");
      await runFoldersRm("a1b2c3d4", { project: "p" });
    } finally {
      Object.defineProperty(process.stderr, "isTTY", { value: isTTY, configurable: true });
    }

    expect(stderrRecords()).toEqual([
      {
        error: {
          code: "folder_not_empty",
          status: 409,
          url: `${DEFAULT_BASE_URL}/api/projects/p/folders/${FOLDER_ID}`,
          detail: "Folder is not empty. Delete its files / sub-folders first.",
        },
      },
    ]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(6);
  });

  it("an id prefix that matches nothing: id_not_found, exit 5, only the lookup GET", async () => {
    const fetchMock = vi.fn(async () =>
      json(200, { folders: [{ id: "a1b2c3d4-0000-4000-8000-000000000000", name: "Stems" }] })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { runFoldersRm } = await import("../commands/folders.js");
    await runFoldersRm("ffff", { project: "p", json: true });

    expect(stderrRecords()).toEqual([
      { error: { code: "id_not_found", status: 0, url: "", detail: 'No folder matches "ffff".' } },
    ]);
    expect(process.exitCode).toBe(5);
    const methods = fetchMock.mock.calls.map(
      (call) => (call as unknown[])[1] as RequestInit | undefined
    );
    expect(methods.every((init) => (init?.method ?? "GET") === "GET")).toBe(true);
  });

  it("no active project: no_project_selected, exit 2", async () => {
    const { runMembersLs } = await import("../commands/members.js");
    await runMembersLs({ json: true });
    const [record] = stderrRecords();
    expect(record).toMatchObject({ error: { code: "no_project_selected", status: 0 } });
    expect(process.exitCode).toBe(2);
  });

  /** A real file for `files upload` to stat and stream; mocking fs would skip the path checks. */
  async function fixture(name: string, body = "RIFF....WAVE"): Promise<string> {
    const file = path.join(tmpDir, name);
    await fs.writeFile(file, body);
    return file;
  }

  /**
   * Routes the three requests of `files upload`: presign (GET), the storage PUT to the presigned
   * URL, and registering the file row (POST).
   */
  function stubUpload(opts: { key: string; put: () => Response; register: () => Response }) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        calls.push(`${method} ${url}`);
        if (url.includes("/upload-url?")) {
          return json(200, {
            method: "PUT",
            key: opts.key,
            uploadUrl: "https://storage.test/bucket/obj?X-Amz-Signature=presigned-sig&X-Amz-Expires=60",
          });
        }
        if (method === "PUT") {
          // Drain the streamed body so the file handle closes before the temp dir is removed.
          await new Response(init?.body as BodyInit).arrayBuffer();
          return opts.put();
        }
        return opts.register();
      })
    );
    return calls;
  }

  it("files upload: a failed storage PUT reports the storage URL without its query", async () => {
    stubUpload({
      key: "u/p/take.wav",
      put: () => new Response("<Error><Code>SignatureDoesNotMatch</Code></Error>", { status: 403 }),
      register: () => json(201, {}),
    });
    const { runFilesUpload } = await import("../commands/files.js");
    await runFilesUpload(await fixture("take.wav"), { project: "p", json: true });

    const records = stderrRecords();
    // One record: the progress completion line ("upload failed: HTTP 403") is quiet here.
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      error: {
        code: "storage_put_failed",
        status: 403,
        url: "https://storage.test/bucket/obj",
      },
    });
    expect((records[0] as { error: { detail: string } }).error.detail).toContain(
      "Storage PUT failed: 403"
    );
    // The presigned query is a write credential: it must not reach any log.
    expect(stderrChunks.join("")).not.toContain("presigned-sig");
    expect(stderrChunks.join("")).not.toContain("X-Amz");
    expect(stdout).toEqual([]);
    // The storage host's 403 is an expired or mismatched signature, not a permission to fix.
    expect(process.exitCode).toBe(1);
  });

  it("files upload: the orphaned-key note is its own JSON line, key sanitized", async () => {
    const key = `u/p/2026/take${ESC}[2K-03.wav`;
    stubUpload({
      key,
      put: () => new Response(null, { status: 200 }),
      register: () => json(403, { error: "scope_denied" }),
    });
    const { runFilesUpload } = await import("../commands/files.js");
    await runFilesUpload(await fixture("take-03.wav"), { project: "p", json: true });

    // Line by line, not just "find the envelope": the promise is that no stderr line is prose.
    const records = stderrRecords();
    expect(records).toHaveLength(2);
    const warning = records[0] as { warning: { code: string; storageKey: string; detail: string } };
    expect(warning.warning.code).toBe("orphaned_upload_key");
    expect(warning.warning.storageKey).toBe("u/p/2026/take-03.wav");
    expect(warning.warning.detail).toContain("Retrying re-uploads the bytes");
    expect(stderrChunks.join("")).not.toContain(ESC);
    expect(records[1]).toMatchObject({ error: { code: "scope_denied", status: 403 } });
    // The "uploaded take-03.wav (12 B)" completion line is not on stderr either.
    expect(stderrChunks.join("")).not.toContain("uploaded take-03.wav");
    expect(process.exitCode).toBe(4);
  });

  it("files upload: text mode keeps the yellow note and the completion line", async () => {
    stubUpload({
      key: "u/p/take.wav",
      put: () => new Response(null, { status: 200 }),
      register: () => json(403, { error: "scope_denied" }),
    });
    const { runFilesUpload } = await import("../commands/files.js");
    await runFilesUpload(await fixture("take.wav"), { project: "p" });

    expect(stderrChunks.join("")).toContain("uploaded take.wav (12 B)");
    // Byte for byte what the note printed before structured output existed.
    expect(stderrChunks).toContain(
      pc.yellow(
        "\nNote: the bytes were uploaded to storage (key: u/p/take.wav) but registering the file " +
          "record failed. Retrying re-uploads the bytes; the orphaned object is reclaimed server-side.\n"
      )
    );
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("files rename: the extension warning is a JSON line in structured mode", async () => {
    const fileId = "f1f2f3f4-0000-4000-8000-000000000000";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return json(200, { files: [{ id: fileId, name: "mix.wav" }] });
        }
        return json(200, { file: { id: fileId, name: "mix.mp3" } });
      })
    );
    const { runFilesRename } = await import("../commands/files.js");
    await runFilesRename("f1f2f3f4", "mix.mp3", { project: "p", json: true });

    expect(stderrRecords()).toEqual([
      {
        warning: {
          code: "extension_mismatch",
          detail: "Warning: extension differs (.wav → .mp3). Server may reject.",
        },
      },
    ]);
    expect(JSON.parse(stdout.join("\n"))).toEqual({ file: { id: fileId, name: "mix.mp3" } });
    expect(process.exitCode).toBeUndefined();
  });
});
