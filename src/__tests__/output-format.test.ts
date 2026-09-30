// SPDX-License-Identifier: MIT
import { Command, CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";

import { argvWantsJsonOutput, OUTPUT_FORMATS, resolveOutputFormat } from "../output-format.js";

// Stub the command modules: these tests only care about how argv reaches the handlers.
vi.mock("../commands/files.js", () => ({
  runFilesLs: vi.fn(),
  runFilesUpload: vi.fn(),
  runFilesDownload: vi.fn(),
  runFilesMv: vi.fn(),
  runFilesRename: vi.fn(),
  runFilesRm: vi.fn(),
}));
vi.mock("../commands/project.js", () => ({ runProjectLs: vi.fn(), runProjectUse: vi.fn() }));
vi.mock("../commands/whoami.js", () => ({ runWhoami: vi.fn() }));

type Mock = ReturnType<typeof vi.fn>;

function lastCall(fn: unknown): unknown[] {
  const calls = (fn as Mock).mock.calls;
  return calls[calls.length - 1]!;
}

/**
 * Parse `synchain <args>` with every command's exit and output captured.
 *
 * exitOverride is copied onto a subcommand when it is created, so setting it on the root
 * afterwards does not reach `files ls`; walk the tree instead.
 */
async function run(args: string[]): Promise<{ out: string; err: string; error: unknown }> {
  const { buildProgram } = await import("../program.js");
  const program = buildProgram();
  let out = "";
  let err = "";
  const visit = (cmd: Command): void => {
    cmd.exitOverride();
    cmd.configureOutput({
      writeOut: (str) => {
        out += str;
      },
      writeErr: (str) => {
        err += str;
      },
    });
    cmd.commands.forEach(visit);
  };
  visit(program);
  let error: unknown;
  try {
    await program.parseAsync(["node", "synchain", ...args]);
  } catch (e) {
    error = e;
  }
  return { out, err, error };
}

describe("OUTPUT_FORMATS", () => {
  it("is the single list fed to commander's .choices()", () => {
    expect([...OUTPUT_FORMATS]).toEqual(["text", "json"]);
  });
});

describe("argvWantsJsonOutput", () => {
  it("accepts --json, `--format json` and `--format=json` alike", () => {
    expect(argvWantsJsonOutput(["node", "synchain", "files", "ls", "--json"])).toBe(true);
    expect(argvWantsJsonOutput(["node", "synchain", "--format", "json", "files", "ls"])).toBe(true);
    expect(argvWantsJsonOutput(["node", "synchain", "files", "ls", "--format=json"])).toBe(true);
  });

  it("stays false for text output", () => {
    expect(argvWantsJsonOutput(["node", "synchain", "files", "ls"])).toBe(false);
    expect(argvWantsJsonOutput(["node", "synchain", "--format", "text"])).toBe(false);
    expect(argvWantsJsonOutput(["node", "synchain", "--format=text"])).toBe(false);
    // A dangling `--format` is commander's error to report; it must not read as json here.
    expect(argvWantsJsonOutput(["node", "synchain", "--format"])).toBe(false);
  });
});

describe("resolveOutputFormat", () => {
  it("finds --format on an ancestor, since commander does not pass parent options down", () => {
    const program = new Command().name("demo").option("--format <fmt>", "Output format", "text");
    const ls = program.command("files").command("ls");

    expect(resolveOutputFormat(ls)).toBe("text");

    program.setOptionValue("format", "json");
    expect(resolveOutputFormat(ls)).toBe("json");
    expect(resolveOutputFormat(program)).toBe("json");
  });

  it("defaults to text when nothing in the chain declares --format", () => {
    const program = new Command().name("demo");
    expect(resolveOutputFormat(program.command("whoami"))).toBe("text");
  });

  it("lets json anywhere in the chain win over a text default lower down", () => {
    const program = new Command().name("demo").option("--format <fmt>", "Output format", "text");
    const child = program.command("child").option("--format <fmt>", "Output format", "text");
    program.setOptionValue("format", "json");
    expect(resolveOutputFormat(child)).toBe("json");
  });
});

describe("global --format on the real program", () => {
  it("declares `--format <fmt>` on the root, defaulting to text", async () => {
    const { buildProgram } = await import("../program.js");
    const program = buildProgram();
    const format = program.options.find((option) => option.long === "--format");
    expect(format?.flags).toBe("--format <fmt>");
    expect(format?.defaultValue).toBe("text");
    expect(format?.argChoices).toEqual(["text", "json"]);
  });

  it("`--format json` before the subcommand turns on --json for a command that has it", async () => {
    const filesMod = await import("../commands/files.js");
    const { error } = await run(["--format", "json", "files", "ls"]);
    expect(error).toBeUndefined();
    expect(lastCall(filesMod.runFilesLs)[0]).toMatchObject({ json: true });
  });

  it("`--format json` after the subcommand works the same way", async () => {
    const projectMod = await import("../commands/project.js");
    const { error } = await run(["project", "ls", "--format", "json"]);
    expect(error).toBeUndefined();
    expect(lastCall(projectMod.runProjectLs)[0]).toEqual({ json: true });
  });

  it("`--format=json` (inline value) is accepted too", async () => {
    const whoamiMod = await import("../commands/whoami.js");
    const { error } = await run(["whoami", "--format=json"]);
    expect(error).toBeUndefined();
    expect(lastCall(whoamiMod.runWhoami)[0]).toEqual({ json: true });
  });

  it("`--format text` (and the default) leave --json off", async () => {
    const filesMod = await import("../commands/files.js");
    await run(["--format", "text", "files", "ls"]);
    expect(lastCall(filesMod.runFilesLs)[0]).not.toHaveProperty("json");
    await run(["files", "ls"]);
    expect(lastCall(filesMod.runFilesLs)[0]).not.toHaveProperty("json");
  });

  it("does not invent a json option on a command that never declared --json", async () => {
    // `files rm` has no JSON output of its own: `--format json` must neither fail it as an
    // unknown option nor slip a `json` key into its options.
    const filesMod = await import("../commands/files.js");
    const { error } = await run(["--format", "json", "files", "rm", "abcd1234", "--yes"]);
    expect(error).toBeUndefined();
    const [fileId, opts] = lastCall(filesMod.runFilesRm);
    expect(fileId).toBe("abcd1234");
    expect(opts).toMatchObject({ yes: true });
    expect(opts).not.toHaveProperty("json");
  });

  it("rejects a value outside OUTPUT_FORMATS through commander's choices check", async () => {
    const filesMod = await import("../commands/files.js");
    const before = (filesMod.runFilesLs as Mock).mock.calls.length;
    const { err, error } = await run(["--format", "yaml", "files", "ls"]);
    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.invalidArgument");
    expect(err).toMatch(/Allowed choices are text, json/);
    expect((filesMod.runFilesLs as Mock).mock.calls.length).toBe(before);
  });
});
