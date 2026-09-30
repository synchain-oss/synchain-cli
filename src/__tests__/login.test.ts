// SPDX-License-Identifier: MIT
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `synchain login` with and without a terminal on stdin.
 *
 * The bug these cases pin: with stdin not a terminal (CI, an agent harness, `</dev/null`),
 * `SYNCHAIN_TOKEN=… synchain login` without `--base-url` still opened the base-URL prompt. Nobody
 * could answer it, so the process printed the prompt, exited 0 and saved nothing -- a scripted
 * login that reported success and left the machine logged out. Without a terminal, `login` now
 * never prompts: the base URL is the answer the prompt would have defaulted to, and a missing key
 * is a usage error (exit 2) rather than a prompt nobody sees.
 *
 * Only the prompts and the global `fetch` are swapped out: `apiFetch`, `reportError` and the
 * config file are the real ones, pointed at a temp directory, so what is asserted is what a real
 * run sends, prints and writes.
 */

const { promptText, promptPassword } = vi.hoisted(() => ({
  promptText: vi.fn(),
  promptPassword: vi.fn(),
}));

vi.mock("../util/prompt.js", () => ({
  promptText,
  promptPassword,
  promptConfirm: vi.fn(),
}));

import { DEFAULT_BASE_URL, getConfigPath } from "../config.js";
import { runHelp } from "../commands/help.js";
import { runLogin, TOKEN_ENV_VAR } from "../commands/login.js";
import { buildProgram } from "../program.js";

// Assembled at runtime: a full-form key literal in the repository is what secret scanning
// rejects, fake or not.
const TOKEN = ["synch", "live", "sk", "0123456789abcdef".repeat(3)].join("_");

const ME = {
  user: {
    id: "u-1",
    email: "ada@example.test",
    username: "ada",
    displayName: "Ada",
    avatarUrl: null,
  },
  projects: [{ id: "11111111-2222-3333-4444-555555555555", name: "Album X", role: "owner" }],
};

/** The colour codes picocolors adds (it colours on Windows and in CI even without a TTY). */
// eslint-disable-next-line no-control-regex
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const ENV_KEYS = [
  "HOME",
  "APPDATA",
  "XDG_CONFIG_HOME",
  TOKEN_ENV_VAR,
  "SYNCHAIN_ERROR_FORMAT",
] as const;

let tmpDir: string;
let savedEnv: Record<string, string | undefined>;
let stdinTty: PropertyDescriptor | undefined;
let stdout: string[];
let stderr: string[];
let fetchMock: ReturnType<typeof vi.fn>;

function setStdinTty(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readSavedConfig(): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(getConfigPath(), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Every line written to stderr (envelopes are one line each). */
function stderrLines(): string[] {
  return stderr
    .join("")
    .split("\n")
    .filter((line) => line.trim() !== "");
}

/** The note a script sees when the key is about to go to a stored, non-default host. */
const STORED_NOTE = "Using stored base URL";

async function writeStoredConfig(cfg: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(getConfigPath()), { recursive: true });
  await fs.writeFile(getConfigPath(), JSON.stringify(cfg));
}

/** The request `login` sent to verify the key: [url, Authorization header]. */
function verifyRequest(): [string, string | undefined] {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, { headers?: Record<string, string> }];
  return [url, init.headers?.["Authorization"]];
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "synchain-login-test-"));
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = tmpDir;
  process.env.APPDATA = tmpDir;
  process.env.XDG_CONFIG_HOME = tmpDir;
  delete process.env[TOKEN_ENV_VAR];
  // The envelope cases rely on the stream deciding (stderr is not a terminal under vitest); an
  // ambient override in the developer's shell would flip them.
  delete process.env.SYNCHAIN_ERROR_FORMAT;

  stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  process.exitCode = undefined;
  stdout = [];
  stderr = [];
  promptText.mockReset();
  promptPassword.mockReset();
  fetchMock = vi.fn(async () => jsonResponse(200, ME));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(`${args.map(String).join(" ")}\n`);
  });
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // `process.exitCode` is process-wide: a case that leaves it at 2 makes vitest itself exit 2
  // with every test green.
  process.exitCode = undefined;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("login without a terminal on stdin", () => {
  beforeEach(() => {
    setStdinTty(false);
  });

  it("with SYNCHAIN_TOKEN and no --base-url: verifies against the default host and saves, no prompt", async () => {
    process.env[TOKEN_ENV_VAR] = TOKEN;

    await runLogin({});

    expect(promptText).not.toHaveBeenCalled();
    expect(promptPassword).not.toHaveBeenCalled();
    const [url, auth] = verifyRequest();
    expect(url).toBe(`${DEFAULT_BASE_URL}/api/user/me`);
    expect(auth).toBe(`Bearer ${TOKEN}`);
    expect(await readSavedConfig()).toEqual({ baseUrl: DEFAULT_BASE_URL, token: TOKEN });
    expect(process.exitCode ?? 0).toBe(0);
    expect(plain(stdout.join("\n"))).toContain("Logged in as Ada (ada@example.test).");
    // The default host is the documented one; nothing to point out.
    expect(plain(stdout.join("\n"))).not.toContain(STORED_NOTE);
    expect(stderrLines()).toEqual([]);
    // The key goes into the request header and the config file, nowhere else.
    expect(stdout.join("\n") + stderr.join("")).not.toContain(TOKEN);
  });

  it("keeps a stored base URL -- the answer the prompt would have defaulted to", async () => {
    // A terminal user pressing Enter gets `existing.baseUrl`; a script must get the same host,
    // not be silently re-pointed at the default (config.ts: the stored value keeps winning).
    const project = { id: "11111111-2222-3333-4444-555555555555", name: "Album X" };
    await writeStoredConfig({ baseUrl: "https://api.test", token: "old", activeProject: project });
    process.env[TOKEN_ENV_VAR] = TOKEN;

    await runLogin({});

    expect(promptText).not.toHaveBeenCalled();
    expect(verifyRequest()[0]).toBe("https://api.test/api/user/me");
    expect(await readSavedConfig()).toEqual({
      baseUrl: "https://api.test",
      token: TOKEN,
      activeProject: project,
    });
    expect(process.exitCode ?? 0).toBe(0);
    // No prompt showed the host, so the log names it: first line, before the result.
    const lines = stdout.map(plain);
    expect(lines[0]).toBe("Using stored base URL https://api.test (pass --base-url to override).");
    expect(lines[1]).toContain("Logged in as Ada");
    expect(stderrLines()).toEqual([]);
  });

  it("a stored base URL that is the default (trailing slash and all) is not pointed out", async () => {
    await writeStoredConfig({ baseUrl: `${DEFAULT_BASE_URL}/`, token: "old" });
    process.env[TOKEN_ENV_VAR] = TOKEN;

    await runLogin({});

    expect(verifyRequest()[0]).toBe(`${DEFAULT_BASE_URL}/api/user/me`);
    expect(plain(stdout.join("\n"))).not.toContain(STORED_NOTE);
  });

  it("a key rejected by a stored host: host named on stdout, stderr stays one envelope line", async () => {
    // The case the note exists for: a stale host left over from testing another deployment
    // receives the injected key. The note must not break the one-line stderr contract.
    await writeStoredConfig({ baseUrl: "https://api.test", token: "old" });
    process.env[TOKEN_ENV_VAR] = TOKEN;
    fetchMock.mockImplementation(async () => new Response("Unauthorized", { status: 401 }));

    await runLogin({});

    expect(process.exitCode).toBe(3);
    expect(stdout.map(plain)).toEqual([
      "Using stored base URL https://api.test (pass --base-url to override).",
    ]);
    const lines = stderrLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).error.url).toContain("https://api.test/");
    expect(stdout.join("\n") + stderr.join("")).not.toContain(TOKEN);
  });

  it("the note strips control characters from a stored base URL", async () => {
    // config.json is replayed on every run, so a sequence that got into it must not reach the
    // terminal (the same output-boundary rule as whoami's active-project line).
    await writeStoredConfig({ baseUrl: "https://api.test/x\x1b[2K", token: "old" });
    process.env[TOKEN_ENV_VAR] = TOKEN;

    await runLogin({});

    const note = stdout.map(plain).find((line) => line.startsWith(STORED_NOTE));
    expect(note).toBeDefined();
    expect(note).not.toContain("\x1b");
    expect(note).toContain("https://api.test/x");
  });

  it("--base-url still wins over the default", async () => {
    process.env[TOKEN_ENV_VAR] = TOKEN;

    await runLogin({ baseUrl: "https://api.test/" });

    expect(promptText).not.toHaveBeenCalled();
    expect(verifyRequest()[0]).toBe("https://api.test/api/user/me");
    expect((await readSavedConfig())?.baseUrl).toBe("https://api.test");
    // The host was on the command line: nothing to point out.
    expect(plain(stdout.join("\n"))).not.toContain(STORED_NOTE);
  });

  it.each([
    ["unset", undefined],
    ["blank", "   "],
  ])(
    "SYNCHAIN_TOKEN %s: exit 2 with one JSON envelope line, no prompt, no request, nothing saved",
    async (_label, value) => {
      if (value !== undefined) process.env[TOKEN_ENV_VAR] = value;

      await runLogin({});

      expect(promptText).not.toHaveBeenCalled();
      expect(promptPassword).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await readSavedConfig()).toBeNull();
      expect(process.exitCode).toBe(2);
      expect(stdout).toEqual([]);
      const lines = stderrLines();
      expect(lines).toHaveLength(1);
      const envelope = JSON.parse(lines[0]!) as {
        error: { code: string; status: number; url: string; detail: string };
      };
      expect(envelope.error.code).toBe("missing_argument");
      expect(envelope.error.status).toBe(0);
      expect(envelope.error.url).toBe("");
      expect(envelope.error.detail).toContain(TOKEN_ENV_VAR);
      expect(envelope.error.detail).toMatch(/not a terminal/);
    }
  );

  it("with --base-url but no SYNCHAIN_TOKEN: still a usage error, not a key prompt", async () => {
    await runLogin({ baseUrl: "https://api.test" });

    expect(promptPassword).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    expect(JSON.parse(stderrLines()[0]!).error.code).toBe("missing_argument");
  });

  it("SYNCHAIN_ERROR_FORMAT=text: the same sentence as a prose line", async () => {
    process.env.SYNCHAIN_ERROR_FORMAT = "text";

    await runLogin({});

    expect(process.exitCode).toBe(2);
    const lines = stderrLines().map(plain);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(TOKEN_ENV_VAR);
    expect(() => JSON.parse(lines[0]!)).toThrow();
  });

  it("never echoes the key: a rejected key (401) fails with exit 3 and the key nowhere in the output", async () => {
    process.env[TOKEN_ENV_VAR] = TOKEN;
    fetchMock.mockImplementation(async () => new Response("Unauthorized", { status: 401 }));

    await runLogin({});

    expect(process.exitCode).toBe(3);
    expect(await readSavedConfig()).toBeNull();
    const out = stdout.join("\n") + stderr.join("");
    expect(out).not.toContain(TOKEN);
    const lines = stderrLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).error.detail).toBe("Login failed: invalid CLI key.");
  });
});

describe("login on a terminal (interactive flow unchanged)", () => {
  beforeEach(() => {
    setStdinTty(true);
  });

  it("prompts for the base URL (default offered) and then the key", async () => {
    promptText.mockResolvedValue("https://api.test");
    promptPassword.mockResolvedValue(TOKEN);

    await runLogin({});

    expect(promptText).toHaveBeenCalledWith("Base URL", { initial: DEFAULT_BASE_URL });
    expect(promptPassword).toHaveBeenCalledTimes(1);
    const [url, auth] = verifyRequest();
    expect(url).toBe("https://api.test/api/user/me");
    expect(auth).toBe(`Bearer ${TOKEN}`);
    expect(await readSavedConfig()).toEqual({ baseUrl: "https://api.test", token: TOKEN });
    expect(process.exitCode ?? 0).toBe(0);
    // The prompt already showed the host; the no-terminal note is not repeated here.
    expect(plain(stdout.join("\n"))).not.toContain(STORED_NOTE);
  });

  it("with SYNCHAIN_TOKEN: still asks for the base URL, skips only the key prompt", async () => {
    process.env[TOKEN_ENV_VAR] = TOKEN;
    promptText.mockResolvedValue(DEFAULT_BASE_URL);

    await runLogin({});

    expect(promptText).toHaveBeenCalledTimes(1);
    expect(promptPassword).not.toHaveBeenCalled();
    expect(verifyRequest()[0]).toBe(`${DEFAULT_BASE_URL}/api/user/me`);
  });

  it("an empty base-URL answer cancels (exit 1, nothing sent)", async () => {
    promptText.mockResolvedValue("");

    await runLogin({});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(stderrLines()[0]!).error.code).toBe("login_cancelled");
  });

  it("an empty key answer cancels (exit 1, nothing sent)", async () => {
    promptPassword.mockResolvedValue("");

    await runLogin({ baseUrl: "https://api.test" });

    expect(promptText).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(stderrLines()[0]!).error.code).toBe("login_cancelled");
  });
});

describe("`login` command surface", () => {
  const login = () => buildProgram().commands.find((c) => c.name() === "login")!;

  it("takes no option that could carry the key: --base-url is the only one", () => {
    expect(login().options.map((o) => o.long)).toEqual(["--base-url"]);
  });

  it("describes --base-url as an override of the default host, not a way to self-host", () => {
    // The server cannot be self-hosted (README); the flag exists for testing against another
    // deployment or a loopback mock.
    const option = login().options.find((o) => o.long === "--base-url")!;
    expect(option.description).toContain(DEFAULT_BASE_URL);
    expect(option.description).toMatch(/^Override the API host/);
    expect(option.description).toMatch(/only needed/);
    expect(option.description).not.toMatch(/self-host|instance/i);
  });
});

describe("`synchain help login`", () => {
  it("shows the unattended form without --base-url, and what happens with no terminal", () => {
    runHelp("login");
    const text = plain(stdout.join("\n"));
    // The old CI example carried `--base-url` because a scripted login without it hung on the
    // base-URL prompt; keeping it there would keep teaching that workaround.
    const unattended = text.split("\n").filter((line) => line.includes(`${TOKEN_ENV_VAR}=`));
    expect(unattended.length).toBeGreaterThan(0);
    for (const line of unattended) expect(line).not.toContain("--base-url");
    expect(text).toMatch(/not a terminal/);
    expect(text).toMatch(/exits 2/);
    expect(text).toContain(DEFAULT_BASE_URL);
  });
});
