import { describe, expect, it, vi } from "vitest";

import { REPO_URL } from "../constants.js";

// Stub the command modules whose side effects we don't want during parsing.
vi.mock("../commands/files.js", () => ({
  runFilesLs: vi.fn(),
  runFilesUpload: vi.fn(),
  runFilesDownload: vi.fn(),
  runFilesMv: vi.fn(),
  runFilesRename: vi.fn(),
  runFilesRm: vi.fn(),
}));
vi.mock("../commands/folders.js", () => ({
  runFoldersLs: vi.fn(),
  runFoldersMkdir: vi.fn(),
  runFoldersRename: vi.fn(),
  runFoldersRm: vi.fn(),
}));
vi.mock("../commands/calendar.js", () => ({
  runCalendarAdd: vi.fn(),
  runCalendarEdit: vi.fn(),
  runCalendarLs: vi.fn(),
  runCalendarRm: vi.fn(),
}));
vi.mock("../commands/discussion.js", () => ({
  runDiscussionLs: vi.fn(),
  runDiscussionPost: vi.fn(),
  runDiscussionRead: vi.fn(),
  runDiscussionReply: vi.fn(),
}));
vi.mock("../commands/notifications.js", () => ({
  runNotificationsLs: vi.fn(),
  runNotificationsRead: vi.fn(),
}));
vi.mock("../commands/login.js", () => ({ runLogin: vi.fn() }));
vi.mock("../commands/logout.js", () => ({ runLogout: vi.fn() }));
vi.mock("../commands/whoami.js", () => ({ runWhoami: vi.fn() }));
vi.mock("../commands/project.js", () => ({ runProjectLs: vi.fn(), runProjectUse: vi.fn() }));
vi.mock("../commands/help.js", () => ({ runHelp: vi.fn() }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mock = ReturnType<typeof vi.fn>;

describe("commander parsing", () => {
  it("parses `files upload ./x.wav --folder abc`", async () => {
    const filesMod = await import("../commands/files.js");
    const { buildProgram } = await import("../index.js");
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "synchain", "files", "upload", "./x.wav", "--folder", "abc"]);
    expect(filesMod.runFilesUpload).toHaveBeenCalledTimes(1);
    const call = (filesMod.runFilesUpload as Mock).mock.calls[0]!;
    expect(call[0]).toBe("./x.wav");
    expect(call[1]).toMatchObject({ folder: "abc" });
  });

  it("parses `files mv <id> --to root --project p1`", async () => {
    const filesMod = await import("../commands/files.js");
    const { buildProgram } = await import("../index.js");
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync([
      "node",
      "synchain",
      "files",
      "mv",
      "file-abc",
      "--to",
      "root",
      "--project",
      "p1",
    ]);
    const calls = (filesMod.runFilesMv as Mock).mock.calls;
    const call = calls[calls.length - 1]!;
    expect(call[0]).toBe("file-abc");
    expect(call[1]).toMatchObject({ to: "root", project: "p1" });
  });

  it("`login` accepts SYNCHAIN_TOKEN env var instead of a --token flag", async () => {
    const loginMod = await import("../commands/login.js");
    const { buildProgram } = await import("../index.js");
    const program = buildProgram();
    program.exitOverride();
    const prev = process.env.SYNCHAIN_TOKEN;
    process.env.SYNCHAIN_TOKEN = "synch_live_sk_envtoken";
    try {
      await program.parseAsync(["node", "synchain", "login", "--base-url", "https://example.test"]);
    } finally {
      if (prev === undefined) delete process.env.SYNCHAIN_TOKEN;
      else process.env.SYNCHAIN_TOKEN = prev;
    }
    const calls = (loginMod.runLogin as Mock).mock.calls;
    const call = calls[calls.length - 1]!;
    expect(call[0]).toMatchObject({ baseUrl: "https://example.test" });
    expect(call[0]).not.toHaveProperty("token");
  });

  it("`login --token <t>` is rejected (flag removed for security)", async () => {
    const { buildProgram } = await import("../index.js");
    const program = buildProgram();
    program.exitOverride();
    program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
    await expect(
      program.parseAsync(["node", "synchain", "login", "--token", "synch_live_sk_nope"])
    ).rejects.toThrow();
  });

  it("parses `discussion post --title T --content C --category mix`", async () => {
    const discMod = await import("../commands/discussion.js");
    const { buildProgram } = await import("../index.js");
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync([
      "node",
      "synchain",
      "discussion",
      "post",
      "--title",
      "T",
      "--content",
      "C",
      "--category",
      "mix",
    ]);
    const calls = (discMod.runDiscussionPost as Mock).mock.calls;
    const call = calls[calls.length - 1]!;
    expect(call[0]).toMatchObject({ title: "T", content: "C", category: "mix" });
  });

  it("parses `notif ls --all --limit 5` (alias + flags)", async () => {
    const notifMod = await import("../commands/notifications.js");
    const { buildProgram } = await import("../index.js");
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "synchain", "notif", "ls", "--all", "--limit", "5"]);
    const calls = (notifMod.runNotificationsLs as Mock).mock.calls;
    const call = calls[calls.length - 1]!;
    expect(call[0]).toMatchObject({ all: true, limit: "5" });
  });

  it("parses `notifications read --all`", async () => {
    const notifMod = await import("../commands/notifications.js");
    const { buildProgram } = await import("../index.js");
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "synchain", "notifications", "read", "--all"]);
    const calls = (notifMod.runNotificationsRead as Mock).mock.calls;
    const call = calls[calls.length - 1]!;
    expect(call[0]).toBeUndefined(); // no positional id
    expect(call[1]).toMatchObject({ all: true });
  });

  it("parses `calendar add` with --tag custom --custom-tag", async () => {
    const calMod = await import("../commands/calendar.js");
    const { buildProgram } = await import("../index.js");
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync([
      "node",
      "synchain",
      "calendar",
      "add",
      "--title",
      "Session",
      "--start",
      "2026-06-01 10:00",
      "--end",
      "2026-06-01 12:00",
      "--tag",
      "custom",
      "--custom-tag",
      "Tracking",
    ]);
    const calls = (calMod.runCalendarAdd as Mock).mock.calls;
    const call = calls[calls.length - 1]!;
    expect(call[0]).toMatchObject({ tag: "custom", customTag: "Tracking", title: "Session" });
  });

  it("--help output points at the new repo (REPO_URL)", async () => {
    const { buildProgram } = await import("../index.js");
    const program = buildProgram();
    program.exitOverride();
    let out = "";
    program.configureOutput({
      writeOut: (str: string) => {
        out += str;
      },
      writeErr: () => {},
    });
    await expect(program.parseAsync(["node", "synchain", "--help"])).rejects.toThrow();
    expect(out).toContain(REPO_URL);
  });
});
