// SPDX-License-Identifier: MIT
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `--dry-run`: where each command short-circuits, and what it prints.
 *
 * contract.test.ts checks that the flag is declared. These cases check where the rehearsal stops:
 *   1. no write request leaves the process -- otherwise the dry run lies;
 *   2. the read-only lookups still run -- the whole point of a rehearsal is turning an 8-char
 *      prefix into a concrete id and name. Stopping before resolution would only echo the input
 *      back, the most dangerous kind of false comfort;
 *   3. exit code 0 -- a rehearsal that went through is a success, not a failure;
 *   4. both the text and the JSON form.
 *
 * The assertions sit on the method each request went out with, not on an internal flag: a short
 * circuit moved below the write, or a new write path that forgets one, turns these red.
 */

const { apiFetch, promptConfirm } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  promptConfirm: vi.fn(),
}));

const PROJECT = "11111111-2222-3333-4444-555555555555";
const FILE_ID = "a1b2c3d4-0000-4000-8000-000000000001";
const FOLDER_ID = "ffffffff-0000-4000-8000-000000000002";
const NOTIF_ID = "9a8b7c6d-0000-4000-8000-000000000003";
const EVENT_ID = "e1e2e3e4-0000-4000-8000-000000000004";
const POST_ID = "c0ffee00-0000-4000-8000-000000000005";

vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  // reportError / wantsJson / resolveActiveProject stay real: these cases are about the real code
  // path, with only the network layer swapped out.
  return { ...actual, apiFetch };
});

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn(async () => ({
      baseUrl: "https://api.test",
      token: "t",
      activeProject: { id: PROJECT, name: "Album X" },
    })),
  };
});

vi.mock("../util/prompt.js", () => ({
  promptConfirm,
  promptPassword: vi.fn(),
  promptText: vi.fn(),
}));

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Every apiFetch call sent with a write method. Always empty under --dry-run. */
function writeCalls(): unknown[][] {
  return apiFetch.mock.calls.filter((call) => {
    const opts = call[1] as { method?: string } | undefined;
    return WRITE_METHODS.has((opts?.method ?? "GET").toUpperCase());
  });
}

/** The colour codes picocolors adds (it colours on Windows and in CI even without a TTY). */
// eslint-disable-next-line no-control-regex
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

let stdout: string[];
let stderr: string[];
let fetchMock: ReturnType<typeof vi.fn>;

/**
 * `process.exitCode` is process-wide: a case that leaves it at 2 makes vitest itself exit 2 with
 * every test green. Reset before and after each case.
 */
beforeEach(() => {
  stdout = [];
  stderr = [];
  process.exitCode = undefined;
  apiFetch.mockReset();
  promptConfirm.mockReset();
  // The bytes of an upload go out through the global fetch, not apiFetch. A dry run must not
  // reach it at all.
  fetchMock = vi.fn(async () => {
    throw new Error("unexpected fetch");
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  });
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

const FILE = {
  id: FILE_ID,
  name: "mix_v2.wav",
  size: 12_582_912,
  mimeType: "audio/wav",
  storageKey: `${PROJECT}/root/mix_v2.wav`,
  folderId: null,
  uploadedBy: null,
  uploaderName: "Alice",
  uploadedAt: "2026-06-01T09:00:00.000Z",
};

const FOLDER = {
  id: FOLDER_ID,
  name: "stems",
  parentId: null,
  projectId: PROJECT,
  createdAt: "2026-06-01T09:00:00.000Z",
  createdBy: null,
};

const EVENT = {
  id: EVENT_ID,
  projectId: PROJECT,
  title: "Tracking",
  description: null,
  startTime: "2026-06-01T10:00:00.000Z",
  endTime: "2026-06-01T12:00:00.000Z",
  tag: "meeting",
  customTag: null,
  color: null,
  createdBy: "u1",
  createdAt: "2026-05-01T00:00:00.000Z",
  creatorName: "Alice",
};

function notification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: NOTIF_ID,
    projectId: PROJECT,
    projectName: "Album X",
    type: "file_uploaded",
    referenceType: "file",
    referenceId: "r",
    entityTitle: null,
    actorName: null,
    isRead: false,
    createdAt: "2026-06-01T09:00:00.000Z",
    ...overrides,
  };
}

function parsePlan<T = { dryRun: boolean; action: string; target: Record<string, unknown> }>(): T {
  return JSON.parse(stdout.join("\n")) as T;
}

describe("reportDryRun", () => {
  it("text: `[dry-run] would …` on stdout, then how to apply it; nothing on stderr, exit 0", async () => {
    const { reportDryRun } = await import("../dry-run.js");

    reportDryRun(
      {},
      { action: "files.rm", target: { file: { id: FILE_ID } }, summary: "would delete mix.wav." }
    );

    expect(plain(stdout[0]!)).toBe("[dry-run] would delete mix.wav.");
    expect(plain(stdout.join("\n"))).toContain("Re-run without --dry-run");
    expect(stderr).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it("json: exactly `{dryRun: true, action, target}`, dryRun first, and no prose around it", async () => {
    const { reportDryRun } = await import("../dry-run.js");

    reportDryRun(
      { json: true },
      { action: "files.rm", target: { file: { id: FILE_ID } }, summary: "would delete mix.wav." }
    );

    const plan = parsePlan();
    expect(plan).toEqual({ dryRun: true, action: "files.rm", target: { file: { id: FILE_ID } } });
    expect(Object.keys(plan)[0]).toBe("dryRun");
    expect(stdout.join("\n")).not.toContain("would delete");
    expect(process.exitCode).toBeUndefined();
  });

  it("json keeps the raw server value; JSON.stringify escapes the ESC as \\u001b", async () => {
    const { reportDryRun } = await import("../dry-run.js");

    reportDryRun(
      { json: true },
      { action: "files.rm", target: { name: "mix\x1b[2Kevil.wav" }, summary: "" }
    );

    const raw = stdout.join("\n");
    expect(raw).not.toContain("\x1b");
    expect(raw).toContain("\\u001b[2K");
    expect(parsePlan<{ target: { name: string } }>().target.name).toBe("mix\x1b[2Kevil.wav");
  });
});

describe("files rm --dry-run", () => {
  it("resolves the 8-char prefix, prints the plan, and sends no DELETE", async () => {
    apiFetch.mockResolvedValueOnce({ files: [FILE] });
    const { runFilesRm } = await import("../commands/files.js");

    await runFilesRm("a1b2c3d4", { project: PROJECT, dryRun: true });

    // The read-only files listing still goes out (it is how the prefix resolves); no write does.
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(writeCalls()).toEqual([]);
    expect(process.exitCode).toBeUndefined();

    const out = plain(stdout.join("\n"));
    expect(out).toContain("[dry-run] would delete mix_v2.wav (a1b2c3d4, 12.0 MB)");
    expect(out).toContain(PROJECT);
  });

  it("short-circuits before the confirmation prompt: no prompt, no bare `Cancelled.`", async () => {
    apiFetch.mockResolvedValueOnce({ files: [FILE] });
    // What promptConfirm answers without a TTY. Were it reached, a dry run in a script would
    // print only "Cancelled." -- nothing at all in exactly the place a preview is wanted.
    promptConfirm.mockResolvedValue(false);
    const { runFilesRm } = await import("../commands/files.js");

    await runFilesRm("a1b2c3d4", { project: PROJECT, dryRun: true });

    expect(promptConfirm).not.toHaveBeenCalled();
    expect(stdout.join("\n")).not.toContain("Cancelled.");
    expect(plain(stdout.join("\n"))).toContain("[dry-run]");
    expect(writeCalls()).toEqual([]);
  });

  it("--json: a parseable plan carrying the RESOLVED full id and the real name", async () => {
    apiFetch.mockResolvedValueOnce({ files: [FILE] });
    const { runFilesRm } = await import("../commands/files.js");

    await runFilesRm("a1b2c3d4", { project: PROJECT, dryRun: true, json: true });

    const plan = parsePlan<{
      dryRun: boolean;
      action: string;
      target: { project: string; file: { id: string; name: string; size: number } };
    }>();
    expect(plan.dryRun).toBe(true);
    expect(plan.action).toBe("files.rm");
    expect(plan.target.project).toBe(PROJECT);
    // The heart of the feature: the caller passed a prefix, the plan names the full id and the
    // file it landed on -- otherwise the caller cannot tell what it is about to delete.
    expect(plan.target.file).toMatchObject({ id: FILE_ID, name: "mix_v2.wav", size: FILE.size });
  });

  it("--dry-run wins over --yes: still nothing deleted", async () => {
    apiFetch.mockResolvedValueOnce({ files: [FILE] });
    const { runFilesRm } = await import("../commands/files.js");

    await runFilesRm("a1b2c3d4", { project: PROJECT, yes: true, dryRun: true });

    expect(writeCalls()).toEqual([]);
  });

  it("still deletes when --dry-run is absent (the short circuit must not leak)", async () => {
    apiFetch.mockResolvedValueOnce({ files: [FILE] });
    apiFetch.mockResolvedValueOnce(undefined);
    const { runFilesRm } = await import("../commands/files.js");

    await runFilesRm("a1b2c3d4", { project: PROJECT, yes: true });

    expect(writeCalls()).toHaveLength(1);
    expect((writeCalls()[0]![1] as { method: string }).method).toBe("DELETE");
    expect(plain(stdout.join("\n"))).toContain("Deleted mix_v2.wav (a1b2c3d4).");
  });

  it("strips escapes from a server-supplied name in text, escapes them in JSON", async () => {
    const tainted = { ...FILE, name: "mix\x1b[2K\x1b]0;pwned\x07evil.wav" };
    apiFetch.mockResolvedValueOnce({ files: [tainted] });
    const { runFilesRm } = await import("../commands/files.js");

    await runFilesRm("a1b2c3d4", { project: PROJECT, dryRun: true });
    const text = stdout.join("\n");
    expect(text).not.toContain("\x1b[2K");
    expect(text).not.toContain("\x1b]0;");
    expect(plain(text)).toContain("would delete mixevil.wav");

    stdout = [];
    apiFetch.mockResolvedValueOnce({ files: [tainted] });
    await runFilesRm("a1b2c3d4", { project: PROJECT, dryRun: true, json: true });
    const raw = stdout.join("\n");
    expect(raw).not.toContain("\x1b");
    expect(raw).toContain("\\u001b[2K");
  });
});

describe("rm --json success output", () => {
  it("`files rm --json --yes` prints `{deleted: {id, name}}`", async () => {
    apiFetch.mockResolvedValueOnce({ files: [FILE] });
    apiFetch.mockResolvedValueOnce(undefined);
    const { runFilesRm } = await import("../commands/files.js");

    await runFilesRm("a1b2c3d4", { project: PROJECT, yes: true, json: true });

    expect(parsePlan()).toEqual({ deleted: { id: FILE_ID, name: "mix_v2.wav" } });
    expect(process.exitCode).toBeUndefined();
  });

  it("`folders rm --json` prints `{deleted: {id, name}}`", async () => {
    apiFetch.mockResolvedValueOnce({ folders: [FOLDER] });
    apiFetch.mockResolvedValueOnce(undefined);
    const { runFoldersRm } = await import("../commands/folders.js");

    await runFoldersRm("ffffffff", { project: PROJECT, json: true });

    expect(writeCalls()).toHaveLength(1);
    expect(parsePlan()).toEqual({ deleted: { id: FOLDER_ID, name: "stems" } });
  });

  it("`calendar rm <uuid> --json` prints `{deleted: {id}}`", async () => {
    apiFetch.mockResolvedValueOnce(undefined);
    const { runCalendarRm } = await import("../commands/calendar.js");

    await runCalendarRm(EVENT_ID, { project: PROJECT, json: true });

    expect(writeCalls()).toHaveLength(1);
    expect(parsePlan()).toEqual({ deleted: { id: EVENT_ID } });
  });

  it("text mode keeps the green one-liner", async () => {
    apiFetch.mockResolvedValueOnce({ folders: [FOLDER] });
    apiFetch.mockResolvedValueOnce(undefined);
    const { runFoldersRm } = await import("../commands/folders.js");

    await runFoldersRm("ffffffff", { project: PROJECT });

    expect(plain(stdout.join("\n"))).toBe("Deleted folder stems (ffffffff).");
  });
});

describe("files upload --dry-run", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "synchain-dry-run-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("stops after the upload-url GET: no PUT of the bytes, no POST of the file row", async () => {
    const local = path.join(dir, "take.mp3");
    await fs.writeFile(local, Buffer.alloc(2048, 1));
    apiFetch.mockResolvedValueOnce({ folders: [FOLDER] });
    apiFetch.mockResolvedValueOnce({
      uploadUrl: "https://storage.test/bucket/obj?X-Amz-Signature=presigned-credential",
      method: "PUT",
      key: `${PROJECT}/${FOLDER_ID}/take.mp3`,
    });
    const { runFilesUpload } = await import("../commands/files.js");

    await runFilesUpload(local, { project: PROJECT, folder: "ffffffff", dryRun: true, json: true });

    expect(writeCalls()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(apiFetch.mock.calls[1]![0])).toContain("/files/upload-url?");
    expect(process.exitCode).toBeUndefined();

    const plan = parsePlan<{
      action: string;
      target: {
        project: string;
        file: { name: string; size: number; mimeType: string };
        folderId: string | null;
        storageKey: string;
      };
    }>();
    expect(plan.action).toBe("files.upload");
    expect(plan.target).toMatchObject({
      project: PROJECT,
      file: { name: "take.mp3", size: 2048, mimeType: "audio/mpeg" },
      folderId: FOLDER_ID,
      storageKey: `${PROJECT}/${FOLDER_ID}/take.mp3`,
    });
    // The presigned URL is a write credential: it is never printed, in either form.
    expect(stdout.join("\n")).not.toContain("presigned-credential");
  });

  it("text form names the file, its size and the destination", async () => {
    const local = path.join(dir, "take.wav");
    await fs.writeFile(local, Buffer.alloc(2048, 1));
    apiFetch.mockResolvedValueOnce({
      uploadUrl: "https://storage.test/bucket/obj?X-Amz-Signature=presigned-credential",
      method: "PUT",
      key: `${PROJECT}/root/take.wav`,
    });
    const { runFilesUpload } = await import("../commands/files.js");

    await runFilesUpload(local, { project: PROJECT, dryRun: true });

    const out = plain(stdout.join("\n"));
    expect(out).toContain("[dry-run] would upload take.wav (2.00 KB) to the project root");
    expect(out).not.toContain("presigned-credential");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeCalls()).toEqual([]);
  });
});

describe("files mv --dry-run", () => {
  it("resolves both the file and the destination folder before short-circuiting", async () => {
    apiFetch.mockResolvedValueOnce({ files: [FILE] });
    apiFetch.mockResolvedValueOnce({ folders: [FOLDER] });
    const { runFilesMv } = await import("../commands/files.js");

    await runFilesMv("a1b2c3d4", { project: PROJECT, to: "ffffffff", dryRun: true, json: true });

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(writeCalls()).toEqual([]);
    const plan = parsePlan<{ action: string; target: { file: { id: string }; to: string } }>();
    expect(plan.action).toBe("files.mv");
    expect(plan.target.file.id).toBe(FILE_ID);
    expect(plan.target.to).toBe(FOLDER_ID);
  });

  it("text form: from root to the folder's short id", async () => {
    apiFetch.mockResolvedValueOnce({ files: [FILE] });
    apiFetch.mockResolvedValueOnce({ folders: [FOLDER] });
    const { runFilesMv } = await import("../commands/files.js");

    await runFilesMv("a1b2c3d4", { project: PROJECT, to: "ffffffff", dryRun: true });

    expect(plain(stdout[0]!)).toBe(
      "[dry-run] would move mix_v2.wav (a1b2c3d4) from root to folder ffffffff."
    );
  });
});

describe("files rename --dry-run", () => {
  it("resolves the file, then sends no PATCH", async () => {
    apiFetch.mockResolvedValueOnce({ files: [FILE] });
    const { runFilesRename } = await import("../commands/files.js");

    await runFilesRename("a1b2c3d4", "mix_v3.wav", { project: PROJECT, dryRun: true, json: true });

    expect(writeCalls()).toEqual([]);
    const plan = parsePlan<{
      action: string;
      target: { file: { id: string; name: string }; newName: string };
    }>();
    expect(plan.action).toBe("files.rename");
    expect(plan.target).toMatchObject({
      file: { id: FILE_ID, name: "mix_v2.wav" },
      newName: "mix_v3.wav",
    });
  });

  it("still rejects an invalid name locally (exit 2) -- a dry run does not skip validation", async () => {
    const { runFilesRename } = await import("../commands/files.js");

    await runFilesRename("a1b2c3d4", "a/b.wav", { project: PROJECT, dryRun: true });

    expect(apiFetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    expect(stdout.join("\n")).not.toContain("[dry-run]");
  });
});

describe("folders mkdir --dry-run", () => {
  it("resolves --parent, then sends no POST", async () => {
    apiFetch.mockResolvedValueOnce({ folders: [FOLDER] });
    const { runFoldersMkdir } = await import("../commands/folders.js");

    await runFoldersMkdir("vocals", { project: PROJECT, parent: "ffffffff", dryRun: true });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(writeCalls()).toEqual([]);
    expect(process.exitCode).toBeUndefined();
    expect(plain(stdout[0]!)).toBe("[dry-run] would create folder vocals under folder ffffffff.");
  });

  it("--json without --parent: parentId null, and no request at all", async () => {
    const { runFoldersMkdir } = await import("../commands/folders.js");

    await runFoldersMkdir("vocals", { project: PROJECT, dryRun: true, json: true });

    expect(apiFetch).not.toHaveBeenCalled();
    expect(parsePlan()).toEqual({
      dryRun: true,
      action: "folders.mkdir",
      target: { project: PROJECT, name: "vocals", parentId: null },
    });
  });
});

describe("folders rm --dry-run", () => {
  it("resolves the folder, then sends no DELETE", async () => {
    apiFetch.mockResolvedValueOnce({ folders: [FOLDER] });
    const { runFoldersRm } = await import("../commands/folders.js");

    await runFoldersRm("ffffffff", { project: PROJECT, dryRun: true, json: true });

    expect(writeCalls()).toEqual([]);
    const plan = parsePlan<{ action: string; target: { folder: { id: string; name: string } } }>();
    expect(plan.action).toBe("folders.rm");
    expect(plan.target.folder).toEqual({ id: FOLDER_ID, name: "stems" });
  });

  it("text form says a non-empty folder is only caught by the real DELETE", async () => {
    apiFetch.mockResolvedValueOnce({ folders: [FOLDER] });
    const { runFoldersRm } = await import("../commands/folders.js");

    await runFoldersRm("ffffffff", { project: PROJECT, dryRun: true });

    const out = plain(stdout.join("\n"));
    expect(out).toContain("[dry-run] would delete folder stems (ffffffff)");
    expect(out).toContain("folder_not_empty");
  });
});

describe("folders rename --dry-run", () => {
  it("resolves the folder, then sends no PATCH", async () => {
    apiFetch.mockResolvedValueOnce({ folders: [FOLDER] });
    const { runFoldersRename } = await import("../commands/folders.js");

    await runFoldersRename("ffffffff", "drums", { project: PROJECT, dryRun: true, json: true });

    expect(writeCalls()).toEqual([]);
    expect(parsePlan()).toEqual({
      dryRun: true,
      action: "folders.rename",
      target: { project: PROJECT, folder: { id: FOLDER_ID, name: "stems" }, newName: "drums" },
    });
  });
});

describe("calendar add --dry-run", () => {
  it("validates the dates and echoes the exact body that would be POSTed", async () => {
    const { runCalendarAdd } = await import("../commands/calendar.js");

    await runCalendarAdd({
      project: PROJECT,
      title: "Tracking",
      start: "2026-06-01T10:00:00.000Z",
      end: "2026-06-01T12:00:00.000Z",
      dryRun: true,
      json: true,
    });

    // add has no id to resolve, so not a single request goes out.
    expect(apiFetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();

    const plan = parsePlan<{
      action: string;
      target: { event: { title: string; startTime: string; endTime: string; tag: string } };
    }>();
    expect(plan.action).toBe("calendar.add");
    expect(plan.target.event).toEqual({
      title: "Tracking",
      startTime: "2026-06-01T10:00:00.000Z",
      endTime: "2026-06-01T12:00:00.000Z",
      tag: "meeting",
    });
  });

  it("still fails (exit 2, usage) on an invalid range -- dry run does not mean skip validation", async () => {
    const { runCalendarAdd } = await import("../commands/calendar.js");

    await runCalendarAdd({
      project: PROJECT,
      title: "Backwards",
      start: "2026-06-01T12:00:00.000Z",
      end: "2026-06-01T10:00:00.000Z",
      dryRun: true,
    });

    expect(process.exitCode).toBe(2);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(stdout.join("\n")).not.toContain("[dry-run]");
  });
});

describe("calendar edit --dry-run", () => {
  it("resolves the event, merges the change, and shows the body PATCH would send", async () => {
    apiFetch.mockResolvedValueOnce({ events: [EVENT], isAdmin: false });
    const { runCalendarEdit } = await import("../commands/calendar.js");

    await runCalendarEdit("e1e2e3e4", {
      project: PROJECT,
      title: "Overdubs",
      dryRun: true,
      json: true,
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(writeCalls()).toEqual([]);
    const plan = parsePlan<{
      action: string;
      target: { event: { id: string; title: string }; changes: Record<string, unknown> };
    }>();
    expect(plan.action).toBe("calendar.edit");
    expect(plan.target.event).toMatchObject({ id: EVENT_ID, title: "Tracking" });
    expect(plan.target.changes).toEqual({
      title: "Overdubs",
      startTime: EVENT.startTime,
      endTime: EVENT.endTime,
      tag: "meeting",
    });
  });
});

describe("calendar rm --dry-run", () => {
  it("a prefix is resolved through the read-only window fetch; no DELETE", async () => {
    apiFetch.mockResolvedValueOnce({ events: [EVENT], isAdmin: false });
    const { runCalendarRm } = await import("../commands/calendar.js");

    await runCalendarRm("e1e2e3e4", { project: PROJECT, dryRun: true, json: true });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(writeCalls()).toEqual([]);
    const plan = parsePlan<{ action: string; target: { event: { id: string } } }>();
    expect(plan.action).toBe("calendar.rm");
    expect(plan.target.event.id).toBe(EVENT_ID);
  });

  it("a full UUID makes no request at all (same path as the real run, minus the DELETE)", async () => {
    const { runCalendarRm } = await import("../commands/calendar.js");

    await runCalendarRm(EVENT_ID, { project: PROJECT, dryRun: true });

    expect(apiFetch).not.toHaveBeenCalled();
    expect(plain(stdout[0]!)).toBe(`[dry-run] would delete event e1e2e3e4 from project ${PROJECT}.`);
  });
});

describe("discussion post --dry-run", () => {
  it("reports the title, category and body size without posting", async () => {
    const { runDiscussionPost } = await import("../commands/discussion.js");

    await runDiscussionPost({
      project: PROJECT,
      title: "Nightly mix report",
      content: "all good",
      category: "mix",
      dryRun: true,
      json: true,
    });

    expect(apiFetch).not.toHaveBeenCalled();
    const plan = parsePlan<{
      action: string;
      target: { title: string; category: string; contentChars: number; contentPreview: string };
    }>();
    expect(plan.action).toBe("discussion.post");
    expect(plan.target).toMatchObject({
      title: "Nightly mix report",
      category: "mix",
      contentChars: 8,
      contentPreview: "all good",
    });
  });

  it("caps the echoed body: a rehearsal confirms the body arrived, it does not reprint it", async () => {
    const { runDiscussionPost } = await import("../commands/discussion.js");

    await runDiscussionPost({
      project: PROJECT,
      title: "Long",
      content: "x".repeat(500),
      dryRun: true,
      json: true,
    });

    const plan = parsePlan<{ target: { contentChars: number; contentPreview: string } }>();
    expect(plan.target.contentChars).toBe(500);
    expect(plan.target.contentPreview.length).toBeLessThan(200);
  });
});

describe("discussion reply --dry-run", () => {
  it("resolves the parent prefix, then sends no POST", async () => {
    apiFetch.mockResolvedValueOnce({ posts: [{ id: POST_ID, parentId: null }] });
    const { runDiscussionReply } = await import("../commands/discussion.js");

    await runDiscussionReply("c0ffee00", {
      project: PROJECT,
      content: "+1",
      dryRun: true,
      json: true,
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(writeCalls()).toEqual([]);
    const plan = parsePlan<{ action: string; target: { parentId: string; contentChars: number } }>();
    expect(plan.action).toBe("discussion.reply");
    expect(plan.target).toMatchObject({ parentId: POST_ID, contentChars: 2 });
  });
});

describe("notifications read --dry-run", () => {
  it("resolves the id prefix but sends no POST", async () => {
    apiFetch.mockResolvedValueOnce({ items: [notification()], unreadCount: 1 });
    const { runNotificationsRead } = await import("../commands/notifications.js");

    await runNotificationsRead("9a8b7c6d", { dryRun: true, json: true });

    expect(writeCalls()).toEqual([]);
    const plan = parsePlan<{ action: string; target: { notification: { id: string } } }>();
    expect(plan.action).toBe("notifications.read");
    expect(plan.target.notification.id).toBe(NOTIF_ID);
  });

  it("--all previews the unread count through a read-only GET instead of POSTing read-all", async () => {
    apiFetch.mockResolvedValueOnce({ items: [], unreadCount: 12 });
    const { runNotificationsRead } = await import("../commands/notifications.js");

    await runNotificationsRead(undefined, { all: true, dryRun: true, json: true });

    expect(writeCalls()).toEqual([]);
    const plan = parsePlan<{ target: { scope: string; unreadCount: number } }>();
    expect(plan.target).toMatchObject({ scope: "all", unreadCount: 12 });
  });

  it("--all text form: a count that is not a number is sanitized, not printed raw", async () => {
    apiFetch.mockResolvedValueOnce({ items: [], unreadCount: "3\x1b[2K" });
    const { runNotificationsRead } = await import("../commands/notifications.js");

    await runNotificationsRead(undefined, { all: true, dryRun: true });

    const text = stdout.join("\n");
    expect(text).not.toContain("\x1b[2K");
    expect(plain(text)).toContain("[dry-run] would mark all 3 unread notifications read.");
  });

  it("--all text form agrees in number with the count it prints", async () => {
    apiFetch.mockResolvedValueOnce({ items: [], unreadCount: 1 });
    const { runNotificationsRead } = await import("../commands/notifications.js");

    await runNotificationsRead(undefined, { all: true, dryRun: true });

    expect(plain(stdout[0]!)).toBe("[dry-run] would mark all 1 unread notification read.");
  });

  it("--all text form pluralizes off safeNumber's output, not off the raw count", async () => {
    // The only input that tells the two apart: once safeNumber strips the escape the count reads
    // "1", so the noun is singular. Pluralizing off the raw string gives "notifications", and
    // reportDryRun's own sanitizing would then hide which one ran -- the digits alone look right.
    apiFetch.mockResolvedValueOnce({ items: [], unreadCount: "1\x1b[2K" });
    const { runNotificationsRead } = await import("../commands/notifications.js");

    await runNotificationsRead(undefined, { all: true, dryRun: true });

    expect(stdout.join("\n")).not.toContain("\x1b[2K");
    expect(plain(stdout[0]!)).toBe("[dry-run] would mark all 1 unread notification read.");
  });
});
