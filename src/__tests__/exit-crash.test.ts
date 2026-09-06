// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runMembersLs } from "../commands/members.js";
import { runProjectLs } from "../commands/project.js";

// exit-crash 回归:API 错误路径(400/401)后不得调用 process.exit()——那会在 Windows 上
// 跳过事件循环排水、触发 undici/uv handle 关闭竞态断言崩溃(exit -1073740791)。正确行为是
// 设 process.exitCode = 1 后 return,让事件循环排空后按码自然退出。

let tmpDir: string;
let origHome: string | undefined;
let origAppData: string | undefined;
let origXdg: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "synchain-exit-test-"));
  origHome = process.env.HOME;
  origAppData = process.env.APPDATA;
  origXdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = tmpDir;
  process.env.APPDATA = tmpDir;
  process.env.XDG_CONFIG_HOME = tmpDir;
  process.exitCode = 0;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = 0;
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = origAppData;
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = origXdg;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function stubFetch(status: number): ReturnType<typeof vi.fn> {
  const spy = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: "boom" }), {
        status,
        headers: { "content-type": "application/json" },
      })
    )
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("API 错误路径不再 process.exit(exit-crash 回归)", () => {
  it("members ls 收到 API 400 时设 exitCode=1 且不调用 process.exit", async () => {
    stubFetch(400);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runMembersLs({ project: "p1" });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalled();
  });

  it("project ls 收到 API 401 时设 exitCode=1 且不调用 process.exit", async () => {
    stubFetch(401);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runProjectLs({});

    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalled();
  });
});
