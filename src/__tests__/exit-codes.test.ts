// SPDX-License-Identifier: MIT
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import pc from "picocolors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiErrorFor, EXIT_CODES, exitCodeFor, reportError } from "../api.js";
import { IdResolutionError } from "../util/resolve-id.js";

const URL = "https://api.test/x";
const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

afterEach(() => {
  process.exitCode = undefined;
});

describe("EXIT_CODES", () => {
  it("is the documented table (a script branches on these numbers)", () => {
    expect(EXIT_CODES).toEqual({
      ok: 0,
      error: 1,
      usage: 2,
      auth: 3,
      forbidden: 4,
      notFound: 5,
      invalid: 6,
      rateLimited: 7,
      server: 8,
    });
  });
});

describe("exitCodeFor: one documented category per failure class", () => {
  it.each([
    [401, EXIT_CODES.auth],
    [403, EXIT_CODES.forbidden],
    [404, EXIT_CODES.notFound],
    [409, EXIT_CODES.invalid],
    [400, EXIT_CODES.invalid],
    [422, EXIT_CODES.invalid],
    [429, EXIT_CODES.rateLimited],
    [500, EXIT_CODES.server],
    [503, EXIT_CODES.server],
    [418, EXIT_CODES.error],
    [451, EXIT_CODES.error],
  ])("HTTP %i -> %i", (status, code) => {
    expect(exitCodeFor(apiErrorFor(status, URL, null))).toBe(code);
  });

  it("classifies by class, not by status: a bare ApiError stays in the catch-all", () => {
    // Every construction site goes through apiErrorFor (api-errors.test.ts scans for it), so a
    // base-class ApiError only ever means "a status with no category".
    expect(exitCodeFor(new ApiError(404, URL, null))).toBe(EXIT_CODES.error);
  });

  it("classifies the CLI's own failures by their envelope code", () => {
    for (const code of [
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
    ]) {
      expect(exitCodeFor(new Error("x"), code), code).toBe(EXIT_CODES.usage);
    }
    expect(exitCodeFor(new Error("x"), "unauthenticated")).toBe(EXIT_CODES.auth);
    expect(exitCodeFor(new Error("x"), "client_error")).toBe(EXIT_CODES.error);
    expect(exitCodeFor(new TypeError("fetch failed"))).toBe(EXIT_CODES.error);
    expect(exitCodeFor(new Error("x"))).toBe(EXIT_CODES.error);
    expect(exitCodeFor("a thrown string")).toBe(EXIT_CODES.error);
  });

  it("an id that cannot be settled: not found -> 5, ambiguous or missing -> 2", () => {
    // What an agent does next differs: another id (like a 404), or more of the same id /
    // an explicit --project (a usage error). client_error and 1 would say neither.
    expect(exitCodeFor(new IdResolutionError('No file matches "zz".', "id_not_found"))).toBe(
      EXIT_CODES.notFound
    );
    expect(exitCodeFor(new IdResolutionError("prefix is ambiguous", "ambiguous_id"))).toBe(
      EXIT_CODES.usage
    );
    expect(exitCodeFor(new IdResolutionError("No project selected.", "no_project_selected"))).toBe(
      EXIT_CODES.usage
    );
  });

  it("an HTTP class wins over an overriding code", () => {
    expect(exitCodeFor(apiErrorFor(404, URL, null), "some_server_code")).toBe(EXIT_CODES.notFound);
    expect(exitCodeFor(apiErrorFor(401, URL, null), "invalid_name")).toBe(EXIT_CODES.auth);
  });

  it("except a failed storage PUT: its status is the storage host's, not the API's", () => {
    // A 403 there is nearly always an expired or mismatched presigned signature: the fix is to
    // upload again, not to change a permission, which is what exit 4 would say. A 5xx from the
    // storage host is not the Synchain server failing either.
    expect(exitCodeFor(apiErrorFor(403, URL, null), "storage_put_failed")).toBe(EXIT_CODES.error);
    expect(exitCodeFor(apiErrorFor(503, URL, null), "storage_put_failed")).toBe(EXIT_CODES.error);
  });

  it("reportError sets the category, so a call site cannot forget to", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const saved = process.env.SYNCHAIN_ERROR_FORMAT;
    process.env.SYNCHAIN_ERROR_FORMAT = "text";
    try {
      reportError(apiErrorFor(403, URL, { error: "scope_denied" }));
      expect(process.exitCode).toBe(EXIT_CODES.forbidden);
      reportError(new Error("New name cannot be empty."), { code: "invalid_name" });
      expect(process.exitCode).toBe(EXIT_CODES.usage);
      reportError(new Error("Not logged in."), { code: "unauthenticated" });
      expect(process.exitCode).toBe(EXIT_CODES.auth);
    } finally {
      err.mockRestore();
      if (saved === undefined) delete process.env.SYNCHAIN_ERROR_FORMAT;
      else process.env.SYNCHAIN_ERROR_FORMAT = saved;
    }
  });
});

/**
 * main() end to end, in process: parse errors are commander's own, raised before any command
 * code runs, so they are the part a command's catch block can never cover.
 */
describe("main(): parse errors, --help and --version", () => {
  let tmpDir: string;
  let stdout: string[];
  let stderr: string[];
  const savedEnv: Record<string, string | undefined> = {};
  const isTTY = process.stderr.isTTY;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "synchain-exit-codes-test-"));
    for (const key of ["HOME", "APPDATA", "XDG_CONFIG_HOME", "SYNCHAIN_ERROR_FORMAT"]) {
      savedEnv[key] = process.env[key];
    }
    process.env.HOME = tmpDir;
    process.env.APPDATA = tmpDir;
    process.env.XDG_CONFIG_HOME = tmpDir;
    delete process.env.SYNCHAIN_ERROR_FORMAT;
    // Pin "not a terminal" (the agent / CI case) rather than inherit whatever the runner has.
    Object.defineProperty(process.stderr, "isTTY", { value: undefined, configurable: true });
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderr.push(`${args.map(String).join(" ")}\n`);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no request may be made by a parse error");
      })
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(process.stderr, "isTTY", { value: isTTY, configurable: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<void> {
    const { main } = await import("../program.js");
    await main(["node", "synchain", ...args]);
  }

  /** stderr must be exactly one line, and that line an envelope. */
  function envelope(): { error: { code: string; status: number; url: string; detail: string } } {
    const text = stderr.join("");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trim().split("\n")).toHaveLength(1);
    return JSON.parse(text) as ReturnType<typeof envelope>;
  }

  it.each([
    [["bogus"], "unknown_command", "unknown command 'bogus'"],
    [["files", "ls", "--bogus"], "unknown_option", "unknown option '--bogus'"],
    [["--format", "yaml", "files", "ls"], "invalid_argument", "Allowed choices are text, json"],
    [["project", "use"], "missing_argument", "missing required argument 'id'"],
    [["calendar", "add", "--title", "x"], "missing_mandatory_option_value", "--start <date>"],
    [["files", "ls", "--project"], "option_missing_argument", "--project <p>"],
  ])("`synchain %s` -> exit 2 and one `%s` envelope", async (args, code, detail) => {
    await run(...args);
    expect(process.exitCode).toBe(EXIT_CODES.usage);
    const { error } = envelope();
    expect(error).toMatchObject({ code, status: 0, url: "" });
    expect(error.detail).toContain(detail);
    // commander's own "error: …" prefix is not part of the detail.
    expect(error.detail.startsWith("error:")).toBe(false);
    expect(stdout).toEqual([]);
  });

  it("text mode keeps commander's own message and adds no JSON", async () => {
    process.env.SYNCHAIN_ERROR_FORMAT = "text";
    await run("bogus");
    expect(process.exitCode).toBe(EXIT_CODES.usage);
    const text = stderr.join("");
    // commander may append a "(Did you mean …?)" line; the message itself is its own.
    expect(text).toMatch(/^error: unknown command 'bogus'\n/);
    expect(text).not.toContain("{");
  });

  it("an explicit --json gets the envelope even under SYNCHAIN_ERROR_FORMAT=text", async () => {
    process.env.SYNCHAIN_ERROR_FORMAT = "text";
    await run("files", "ls", "--bogus", "--json");
    expect(envelope().error.code).toBe("unknown_option");
  });

  it("an unknown help topic is a usage error too", async () => {
    await run("help", "nosuchtopic");
    expect(process.exitCode).toBe(EXIT_CODES.usage);
    const { error } = envelope();
    expect(error.code).toBe("unknown_topic");
    expect(error.detail).toContain("Unknown help topic: nosuchtopic");
    expect(error.detail).toContain("Available topics: login");
  });

  it("an unknown help topic in text mode prints as before: red complaint, plain topic list", async () => {
    process.env.SYNCHAIN_ERROR_FORMAT = "text";
    await run("help", "nosuchtopic");
    expect(process.exitCode).toBe(EXIT_CODES.usage);
    // Two writes, only the first through pc.red: one red block over both lines would change
    // what a terminal shows, which text mode promises not to do.
    expect(vi.mocked(console.error).mock.calls).toEqual([
      [pc.red("Unknown help topic: nosuchtopic")],
      [expect.stringMatching(/^Available topics: login, /)],
    ]);
  });

  it("--help exits 0 with the help on stdout and nothing on stderr", async () => {
    await run("--help");
    expect(process.exitCode ?? 0).toBe(0);
    expect(stdout.join("")).toMatch(/^Usage: synchain/);
    expect(stderr).toEqual([]);
  });

  it("--version exits 0 with the version on stdout", async () => {
    await run("--version");
    expect(process.exitCode ?? 0).toBe(0);
    expect(stdout.join("")).toBe(`${pkg.version}\n`);
    expect(stderr).toEqual([]);
  });

  it.each([[[] as string[]], [["files"]]])(
    "`synchain %s` without a subcommand prints help and no envelope, exit 2",
    async (args) => {
      await run(...args);
      expect(process.exitCode).toBe(EXIT_CODES.usage);
      const text = stderr.join("");
      expect(text).toMatch(/Usage: synchain/);
      // The help *is* the error report here; a JSON record on top would be a second one.
      expect(text).not.toContain('{"error"');
      expect(stdout).toEqual([]);
    }
  );
});
