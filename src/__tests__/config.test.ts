// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let tmpDir: string;
let origHome: string | undefined;
let origAppData: string | undefined;
let origXdg: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "synchain-cli-test-"));
  origHome = process.env.HOME;
  origAppData = process.env.APPDATA;
  origXdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = tmpDir;
  process.env.APPDATA = tmpDir;
  process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(async () => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = origAppData;
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = origXdg;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("config", () => {
  it("round-trips write and read", async () => {
    const mod = await import("../config.js");
    expect(mod.isFirstRun()).toBe(true);
    expect(await mod.loadConfig()).toBeNull();

    await mod.saveConfig({
      baseUrl: "https://example.test",
      token: "synch_live_sk_testtoken",
      activeProject: { id: "11111111-2222-3333-4444-555555555555", name: "Demo" },
    });

    const cfg = await mod.loadConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.baseUrl).toBe("https://example.test");
    expect(cfg!.token).toBe("synch_live_sk_testtoken");
    expect(cfg!.activeProject?.id).toBe("11111111-2222-3333-4444-555555555555");
    expect(cfg!.activeProject?.name).toBe("Demo");
    expect(mod.isFirstRun()).toBe(false);
  });

  it("getConfigDir respects platform conventions (synchain)", async () => {
    const mod = await import("../config.js");
    const dir = mod.getConfigDir();
    expect(dir).toContain("synchain");
    if (process.platform === "win32") {
      expect(dir.toLowerCase()).toContain(tmpDir.toLowerCase());
    } else {
      expect(dir).toContain(tmpDir);
    }
  });

  it("clearConfig removes the file", async () => {
    const mod = await import("../config.js");
    await mod.saveConfig({ baseUrl: "https://x.test", token: "t" });
    await mod.clearConfig();
    expect(await mod.loadConfig()).toBeNull();
  });

  it("getConfigPath and getWelcomeSentinelPath live under the config dir", async () => {
    const mod = await import("../config.js");
    expect(mod.getConfigPath()).toBe(path.join(mod.getConfigDir(), "config.json"));
    expect(mod.getWelcomeSentinelPath()).toBe(path.join(mod.getConfigDir(), ".welcomed"));
  });

  it("markWelcomeSeen writes the sentinel and flips isFirstRun", async () => {
    const mod = await import("../config.js");
    expect(mod.isFirstRun()).toBe(true);
    await mod.markWelcomeSeen();
    expect(mod.isFirstRun()).toBe(false);
    const sentinel = mod.getWelcomeSentinelPath();
    expect((await fs.readFile(sentinel, "utf8")).length).toBeGreaterThan(0);
  });

  it("loadConfig warns and returns null on corrupt JSON", async () => {
    const mod = await import("../config.js");
    const p = mod.getConfigPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, "{not valid json", "utf8");
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await mod.loadConfig()).toBeNull();
      expect(write).toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it("clearConfig rethrows non-ENOENT errors", async () => {
    const mod = await import("../config.js");
    const spy = vi
      .spyOn(fs, "unlink")
      .mockRejectedValue(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    try {
      await expect(mod.clearConfig()).rejects.toThrow("EACCES");
    } finally {
      spy.mockRestore();
    }
  });

  it("saveConfig creates a 0600 file on POSIX", async () => {
    const mod = await import("../config.js");
    if (process.platform === "win32") return; // chmod semantics differ; covered on Linux CI
    await mod.saveConfig({ baseUrl: "https://x.test", token: "t" });
    const stat = await fs.stat(mod.getConfigPath());
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("getConfigDir honors XDG_CONFIG_HOME on POSIX", async () => {
    const mod = await import("../config.js");
    if (process.platform === "win32") return;
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, "xdg");
    try {
      expect(mod.getConfigDir()).toBe(path.join(tmpDir, "xdg", "synchain"));
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });
});
