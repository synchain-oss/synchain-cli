// SPDX-License-Identifier: MIT
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateDoctor, maskKey, type DoctorInput, type DoctorReport } from "../doctor.js";

// Built at run time: a complete key-shaped literal in the source would trip secret scanning.
const KEY = `synch_live_sk_${"a1".repeat(24)}`;
const OTHER_KEY = `synch_live_sk_${"b2".repeat(24)}`;
const UUID = "3f9a1c2b-0000-4000-8000-000000000000";

function input(over: Partial<DoctorInput> = {}): DoctorInput {
  return {
    configPath: "/home/u/.config/synchain/config.json",
    config: {
      mode: 0o600,
      value: { baseUrl: "https://www.synchain.ca", token: KEY, activeProject: { id: UUID } },
    },
    env: {},
    nodeVersion: "v22.1.0",
    platform: "linux",
    defaultBaseUrl: "https://www.synchain.ca",
    ...over,
  };
}

const check = (r: DoctorReport, id: string) => r.checks.find((c) => c.id === id);
const status = (r: DoctorReport, id: string) => check(r, id)?.status;

describe("evaluateDoctor", () => {
  it("is all ok for a healthy config", () => {
    const r = evaluateDoctor(input());
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual([
      "node_version",
      "config_file",
      "credential",
      "base_url",
      "active_project",
    ]);
    expect(r.checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("never shows more of a key than the first 8 and last 4 characters", () => {
    const text = JSON.stringify(evaluateDoctor(input()));
    expect(text).not.toContain(KEY);
    expect(text).toContain(maskKey(KEY));
    expect(maskKey(KEY)).toBe(`${KEY.slice(0, 8)}…${KEY.slice(-4)}`);
    // Too short to show 12 characters without showing most of it: show none.
    expect(maskKey("short")).toBe("*****");
    expect(maskKey("x".repeat(12))).toBe("*".repeat(12));
  });

  it("fails when nothing is stored and SYNCHAIN_TOKEN is unset", () => {
    const r = evaluateDoctor(input({ config: null }));
    expect(r.ok).toBe(false);
    expect(status(r, "credential")).toBe("fail");
    expect(status(r, "config_file")).toBe("warn");
    expect(check(r, "config_file")!.detail).toContain("synchain login");
  });

  it("explains that SYNCHAIN_TOKEN is read by `synchain login` only", () => {
    const r = evaluateDoctor(input({ config: null, env: { SYNCHAIN_TOKEN: KEY } }));
    expect(status(r, "credential")).toBe("warn");
    expect(check(r, "credential")!.detail).toMatch(/only `synchain login` reads it/);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("warns when SYNCHAIN_TOKEN differs from the stored key (it is not what commands use)", () => {
    const r = evaluateDoctor(input({ env: { SYNCHAIN_TOKEN: OTHER_KEY } }));
    expect(status(r, "credential")).toBe("warn");
    const detail = check(r, "credential")!.detail;
    expect(detail).toContain(maskKey(KEY));
    expect(detail).toContain(maskKey(OTHER_KEY));
    expect(detail).toMatch(/only `synchain login` reads it/);
    expect(JSON.stringify(r)).not.toContain(OTHER_KEY);
    // The same key in both places is simply fine.
    const same = evaluateDoctor(input({ env: { SYNCHAIN_TOKEN: KEY } }));
    expect(status(same, "credential")).toBe("ok");
  });

  it("fails on an unparseable config and on an unsafe base URL", () => {
    const broken = evaluateDoctor(input({ config: { parseError: "Unexpected token" } }));
    expect(status(broken, "config_file")).toBe("fail");
    expect(broken.ok).toBe(false);
    const r = evaluateDoctor(
      input({ config: { mode: 0o600, value: { baseUrl: "http://evil.example", token: KEY } } })
    );
    expect(status(r, "base_url")).toBe("fail");
    expect(check(r, "base_url")!.detail).toContain("insecure http");
  });

  it("fails a base URL with credentials in it and never shows them", () => {
    for (const baseUrl of [
      "https://alice:s3cret@www.synchain.ca",
      "ftp://alice:s3cret@host",
      // Does not parse at all (space in the host): the "Invalid base URL" message quotes it.
      "https://alice:s3cret@exa mple.com",
    ]) {
      const r = evaluateDoctor(input({ config: { mode: 0o600, value: { baseUrl, token: KEY } } }));
      expect(status(r, "base_url"), baseUrl).toBe("fail");
      expect(r.ok).toBe(false);
      const printed = JSON.stringify(r);
      expect(printed, baseUrl).not.toContain("s3cret");
      expect(printed, baseUrl).not.toContain("alice");
    }
  });

  it("checks the default base URL when none is stored, and says so", () => {
    const r = evaluateDoctor(input({ config: { mode: 0o600, value: { token: KEY } } }));
    expect(check(r, "base_url")).toEqual({
      id: "base_url",
      status: "ok",
      detail: "https://www.synchain.ca (default)",
    });
  });

  it("warns on a group/world-readable config on POSIX only", () => {
    const loose = { mode: 0o100644, value: { token: KEY } };
    const r = evaluateDoctor(input({ config: loose }));
    expect(status(r, "config_permissions")).toBe("warn");
    expect(check(r, "config_permissions")!.detail).toContain("mode 644");
    const onWindows = evaluateDoctor(input({ config: loose, platform: "win32" }));
    expect(status(onWindows, "config_permissions")).toBeUndefined();
    // 0600 needs no line at all.
    expect(status(evaluateDoctor(input()), "config_permissions")).toBeUndefined();
  });

  it("flags a malformed key, an old Node, and a non-UUID active project", () => {
    const r = evaluateDoctor(
      input({
        nodeVersion: "v18.0.0",
        config: { mode: 0o600, value: { token: "nope", activeProject: { id: "my-band" } } },
      })
    );
    expect(status(r, "node_version")).toBe("fail");
    expect(status(r, "credential")).toBe("warn");
    expect(check(r, "credential")!.detail).not.toContain("nope");
    expect(status(r, "active_project")).toBe("warn");
  });

  it("warns when no project is selected", () => {
    const r = evaluateDoctor(input({ config: { mode: 0o600, value: { token: KEY } } }));
    expect(status(r, "active_project")).toBe("warn");
    expect(check(r, "active_project")!.detail).toContain("synchain project use");
    // A warning is advice; only a fail makes the report not ok.
    expect(r.ok).toBe(true);
  });

  it("sanitizes terminal escapes that came out of the config file", () => {
    const r = evaluateDoctor(
      input({ configPath: "/x/\u001b[2Kconfig.json", config: { parseError: "bad \u001b[31mred" } })
    );
    expect(JSON.stringify(r)).not.toContain("\\u001b");
  });
});

/**
 * The command itself: reads the real config file (in a temp dir), never touches the network.
 */
describe("synchain doctor", () => {
  let tmpDir: string;
  let stdout: string[];
  let fetchSpy: ReturnType<typeof vi.fn>;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "synchain-doctor-test-"));
    for (const key of ["HOME", "APPDATA", "XDG_CONFIG_HOME", "SYNCHAIN_TOKEN"]) {
      savedEnv[key] = process.env[key];
    }
    process.env.HOME = tmpDir;
    process.env.APPDATA = tmpDir;
    process.env.XDG_CONFIG_HOME = tmpDir;
    delete process.env.SYNCHAIN_TOKEN;
    process.exitCode = undefined;
    stdout = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(" "));
    });
    fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.exitCode = undefined;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeConfig(value: unknown): Promise<void> {
    const { getConfigDir, getConfigPath } = await import("../config.js");
    await fs.mkdir(getConfigDir(), { recursive: true });
    await fs.writeFile(getConfigPath(), typeof value === "string" ? value : JSON.stringify(value), {
      mode: 0o600,
    });
  }

  it("--json prints {ok, checks[{id, status, detail}]} and makes no request", async () => {
    await writeConfig({ token: KEY, activeProject: { id: UUID } });
    const { runDoctor } = await import("../commands/doctor.js");
    await runDoctor({ json: true });

    const report = JSON.parse(stdout.join("\n")) as DoctorReport;
    expect(Object.keys(report).sort()).toEqual(["checks", "ok"]);
    expect(report.ok).toBe(true);
    for (const c of report.checks) {
      expect(Object.keys(c).sort()).toEqual(["detail", "id", "status"]);
    }
    expect(stdout.join("\n")).not.toContain(KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("exits 1 when a check fails", async () => {
    const { runDoctor } = await import("../commands/doctor.js");
    await runDoctor({ json: true });

    const report = JSON.parse(stdout.join("\n")) as DoctorReport;
    expect(report.ok).toBe(false);
    expect(status(report, "credential")).toBe("fail");
    expect(process.exitCode).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a corrupt config file instead of treating it as missing", async () => {
    await writeConfig("{ not json");
    const { runDoctor } = await import("../commands/doctor.js");
    await runDoctor({ json: true });
    const report = JSON.parse(stdout.join("\n")) as DoctorReport;
    expect(status(report, "config_file")).toBe("fail");
    expect(process.exitCode).toBe(1);
  });

  it("text mode lists every check and says no request was made", async () => {
    process.env.SYNCHAIN_TOKEN = KEY;
    const { runDoctor } = await import("../commands/doctor.js");
    await runDoctor({});
    const text = stdout.join("\n");
    for (const id of ["node_version", "config_file", "credential", "base_url", "active_project"]) {
      expect(text).toContain(id);
    }
    expect(text).toContain("only `synchain login` reads it");
    expect(text).toContain("no request was made");
    expect(text).not.toContain(KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is wired into the program: `doctor --json` and `--format json doctor`", async () => {
    await writeConfig({ token: KEY, activeProject: { id: UUID } });
    const { main } = await import("../program.js");
    await main(["node", "synchain", "doctor", "--json"]);
    expect((JSON.parse(stdout.join("\n")) as DoctorReport).ok).toBe(true);

    stdout.length = 0;
    await main(["node", "synchain", "--format", "json", "doctor"]);
    expect((JSON.parse(stdout.join("\n")) as DoctorReport).ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("has a help topic", async () => {
    const { runHelp } = await import("../commands/help.js");
    runHelp("doctor");
    const text = stdout.join("\n");
    expect(text).toContain("synchain doctor [--json]");
    expect(text).toContain("SYNCHAIN_TOKEN");
    stdout.length = 0;
    runHelp(undefined);
    expect(stdout.join("\n")).toContain("synchain doctor");
  });
});
