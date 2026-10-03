// SPDX-License-Identifier: MIT
import { Command, CommanderError } from "commander";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BASE_URL } from "../config.js";
import { DOCS_AGENTS, DOCS_README } from "../constants.js";
import {
  AUTH_HELP,
  AUTH_HELP_TEXT,
  ENVIRONMENT_HELP,
  HELP_TEXT_WIDTH,
  KEY_PLACEHOLDER,
  TOKEN_ENV_VAR,
} from "../help-auth.js";
import {
  buildHelpJson,
  serializeCommand,
  type CommandTree,
  type CommandTreeNode,
} from "../help-json.js";

// Stub the discussion handlers (keeping the module's other exports, which `help.ts` reads):
// help must be printed without any handler running.
vi.mock("../commands/discussion.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../commands/discussion.js")>()),
  runDiscussionLs: vi.fn(),
  runDiscussionPost: vi.fn(),
  runDiscussionRead: vi.fn(),
  runDiscussionReply: vi.fn(),
}));

type Mock = ReturnType<typeof vi.fn>;

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/**
 * A small hand-built tree rather than buildProgram(): the real program has dozens of commands,
 * so assertions against it can only say "contains X". Here the structure itself is under test
 * (three levels deep, options in registration order, aliases only where they exist).
 */
function buildFixture(): Command {
  const program = new Command();
  program.name("demo").description("demo root").version("1.2.3");
  const files = program.command("files").description("manage files");
  files
    .command("ls")
    .description("list files")
    .option("--json", "Output JSON")
    .option("--folder <id>", "Folder id");
  program.command("notifications").alias("notif").description("your notifications");
  return program;
}

/** Parse `synchain <args>` with every command's exit and output captured (see output-format.test.ts). */
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

/** Every node, depth first. */
function walk(node: CommandTreeNode): CommandTreeNode[] {
  return [node, ...node.commands.flatMap(walk)];
}

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Source files under `dir` (recursively), tests excluded. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

/**
 * The environment variables one source text reads, on `process.env` or an injected `env` object:
 * `env.NAME` / `env?.NAME`, and `env[...]` / `env?.[...]` whose key is a quoted name or a known
 * constant. Any other key (computed, a template with a placeholder) throws: the list could not be
 * checked against it, so the read has to be rewritten into one of the forms above.
 */
function envNamesIn(text: string, where: string): string[] {
  const constants: Record<string, string> = { TOKEN_ENV_VAR };
  const reads = text.matchAll(/\benv(?:\??\.([A-Z][A-Z0-9_]*)|(?:\?\.)?\[([^\]]*)\])/g);
  return [...reads].map((m) => {
    if (m[1]) return m[1];
    const key = m[2]!.trim();
    const quoted = /^(["'`])([A-Z][A-Z0-9_]*)\1$/.exec(key);
    if (quoted) return quoted[2]!;
    const resolved = constants[key];
    if (resolved === undefined) throw new Error(`env[${key}] in ${where}: unknown key`);
    return resolved;
  });
}

/**
 * Every environment variable the source reads (see `envNamesIn`). help-auth.ts itself is left
 * out -- it is the list being checked, not a reader.
 */
function envReadBySource(): string[] {
  const names = sourceFiles(SRC)
    .filter((file) => path.basename(file) !== "help-auth.ts")
    .flatMap((file) => envNamesIn(readFileSync(file, "utf8"), path.basename(file)));
  return [...new Set(names)].sort();
}

/**
 * The command a help line runs: `SYNCHAIN_TOKEN=… synchain login` (POSIX shells) and
 * `$env:SYNCHAIN_TOKEN = "…"; synchain login` (PowerShell) -> `login`.
 */
function commandOf(line: string): string {
  const m = /^(?:[A-Z_]+=\S+ |\$env:[A-Z_]+ = "[^"]*"; )?synchain ([a-z]+)\b/.exec(line);
  expect(m, `not a synchain command line: ${line}`).not.toBeNull();
  return m![1]!;
}

describe("buildHelpJson (fixture tree)", () => {
  it("recurses three levels deep (root → group → leaf)", () => {
    const tree = buildHelpJson(buildFixture());

    expect(tree.name).toBe("demo");
    expect(tree.version).toBe("1.2.3");
    expect(tree.description).toBe("demo root");

    const files = tree.commands.find((cmd) => cmd.name === "files");
    expect(files?.description).toBe("manage files");
    const ls = files?.commands.find((cmd) => cmd.name === "ls");
    expect(ls?.options).toEqual([
      { flags: "--json", description: "Output JSON" },
      { flags: "--folder <id>", description: "Folder id" },
    ]);
    expect(ls?.commands).toEqual([]);
  });

  it("describes the whole tree whichever command's help was asked for", () => {
    const program = buildFixture();
    const ls = program.commands.find((cmd) => cmd.name() === "files")!.commands[0]!;
    expect(buildHelpJson(ls)).toEqual(buildHelpJson(program));
  });

  it("round-trips through JSON.stringify without losing fields", () => {
    // JSON.stringify drops undefined values and throws on cycles; either would make the printed
    // document differ from this object.
    const tree = buildHelpJson(buildFixture());
    expect(JSON.parse(JSON.stringify(tree)) as unknown).toEqual(tree);
  });

  it("emits aliases only for the commands that have one", () => {
    const tree = buildHelpJson(buildFixture());
    expect(tree.commands.find((cmd) => cmd.name === "notifications")?.aliases).toEqual(["notif"]);
    expect(tree.commands.find((cmd) => cmd.name === "files")).not.toHaveProperty("aliases");
  });

  it("falls back to an empty version string when none was set", () => {
    expect(buildHelpJson(new Command().name("bare")).version).toBe("");
  });

  it("keeps commander's computed usage string (positional arguments included)", () => {
    const upload = new Command()
      .name("demo")
      .command("upload <localPath>")
      .description("upload a file")
      .option("--folder <id>", "Folder id");
    expect(serializeCommand(upload)).toMatchObject({
      name: "upload",
      description: "upload a file",
      usage: "[options] <localPath>",
    });
  });

  it("puts auth and environment on the root only, ahead of the (long) commands list", () => {
    const tree = buildHelpJson(buildFixture());
    expect(Object.keys(tree)).toEqual([
      "name",
      "version",
      "description",
      "usage",
      "options",
      "auth",
      "environment",
      "commands",
    ]);
    expect(tree.auth).toEqual(AUTH_HELP);
    expect(tree.environment).toEqual(ENVIRONMENT_HELP);
    for (const node of walk(tree).slice(1)) {
      expect(node, node.name).not.toHaveProperty("auth");
      expect(node, node.name).not.toHaveProperty("environment");
    }
  });

  it("hands out copies: editing one tree does not change the next", () => {
    const first = buildHelpJson(buildFixture());
    first.auth.env = "EDITED";
    first.auth.envReadBy.push("edited");
    first.environment[0]!.name = "EDITED";
    const second = buildHelpJson(buildFixture());
    expect(second.auth).toEqual(AUTH_HELP);
    expect(second.environment).toEqual(ENVIRONMENT_HELP);
    expect(AUTH_HELP.env).toBe("SYNCHAIN_TOKEN");
  });
});

describe("`--help --format json` on the real program", () => {
  it("prints one parseable command tree on stdout and nothing else", async () => {
    const { out, err, error } = await run(["--help", "--format", "json"]);
    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).exitCode).toBe(0);
    expect(err).toBe("");

    // The whole of stdout must parse: an afterHelp block appended to the document would break it.
    const tree = JSON.parse(out) as ReturnType<typeof buildHelpJson>;
    expect(tree.name).toBe("synchain");
    expect(tree.version).toBe(pkg.version);
    expect(tree.options.map((option) => option.flags)).toContain("--format <fmt>");

    const topLevel = tree.commands.map((cmd) => cmd.name);
    for (const name of [
      "login",
      "logout",
      "whoami",
      "project",
      "files",
      "folders",
      "calendar",
      "discussion",
      "members",
      "notifications",
      "help",
    ]) {
      expect(topLevel).toContain(name);
    }

    for (const node of walk(tree)) {
      expect(typeof node.name).toBe("string");
      expect(typeof node.description).toBe("string");
      expect(typeof node.usage).toBe("string");
      expect(Array.isArray(node.commands)).toBe(true);
      for (const option of node.options) {
        expect(Object.keys(option).sort()).toEqual(["description", "flags"]);
      }
    }

    const filesLs = tree.commands
      .find((cmd) => cmd.name === "files")
      ?.commands.find((cmd) => cmd.name === "ls");
    expect(filesLs?.description).toContain("List files");
    expect(filesLs?.options.map((option) => option.flags)).toContain("--json");
  });

  it("`-h --format=json` (short flag, inline value) also yields JSON", async () => {
    const { out } = await run(["-h", "--format=json"]);
    expect((JSON.parse(out) as { name: string }).name).toBe("synchain");
  });

  it("`files --help --format json` prints the same parseable tree", async () => {
    const root = await run(["--help", "--format", "json"]);
    const { out, error } = await run(["files", "--help", "--format", "json"]);
    expect((error as CommanderError).exitCode).toBe(0);
    expect(JSON.parse(out) as unknown).toEqual(JSON.parse(root.out) as unknown);
  });

  it("`discussion post --help --format json` (leaf command) is parseable too", async () => {
    const { out } = await run(["discussion", "post", "--help", "--format", "json"]);
    expect((JSON.parse(out) as { name: string }).name).toBe("synchain");
  });
});

describe("`--help --format json`: how to authenticate", () => {
  it("carries `auth` and `environment` at the root; stdout is still one JSON document", async () => {
    const { out, err } = await run(["--help", "--format", "json"]);
    expect(err).toBe("");
    const tree = JSON.parse(out) as CommandTree;

    expect(tree.auth).toEqual(AUTH_HELP);
    expect(tree.auth.scheme).toBe("Bearer");
    expect(tree.auth.env).toBe("SYNCHAIN_TOKEN");
    expect(tree.auth.envReadBy).toEqual(["login"]);
    expect(tree.auth.credential).toContain("synch_live_sk_…");
    expect(tree.auth.login).toEqual({
      interactive: "synchain login",
      nonInteractive: "SYNCHAIN_TOKEN=synch_live_sk_… synchain login",
      nonInteractivePowerShell: '$env:SYNCHAIN_TOKEN = "synch_live_sk_…"; synchain login',
    });
    expect(tree.auth.obtain.url).toBe(`${DEFAULT_BASE_URL}/settings`);
    expect(tree.auth.obtain.steps).toContain("Settings → CLI Access → Generate");
    expect(tree.auth.verify).toEqual({ offline: "synchain doctor", online: "synchain whoami" });

    expect(tree.environment).toEqual(ENVIRONMENT_HELP);
    for (const entry of tree.environment) {
      expect(Object.keys(entry).sort()).toEqual(["description", "name"]);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("names only commands that exist", async () => {
    // A renamed command would otherwise leave the help telling agents to run an unknown command
    // (exit 2).
    const tree = JSON.parse((await run(["--help", "--format", "json"])).out) as CommandTree;
    const topLevel = tree.commands.map((cmd) => cmd.name);
    const { login, verify, envReadBy } = tree.auth;
    const lines = [
      login.interactive,
      login.nonInteractive,
      login.nonInteractivePowerShell,
      verify.offline,
      verify.online,
    ];
    for (const line of lines) expect(topLevel).toContain(commandOf(line));
    for (const command of envReadBy) expect(topLevel).toContain(command);
    expect(commandOf(login.nonInteractive)).toBe("login");
    expect(login.nonInteractive.startsWith(`${tree.auth.env}=`)).toBe(true);
    expect(commandOf(login.nonInteractivePowerShell)).toBe("login");
    expect(login.nonInteractivePowerShell.startsWith(`$env:${tree.auth.env} = `)).toBe(true);
  });

  it("gives the non-interactive login for both shells, with the same key placeholder", async () => {
    // `NAME=value command` is POSIX-only: PowerShell rejects it, so Windows needs its own line.
    const { login } = (JSON.parse((await run(["--help", "--format", "json"])).out) as CommandTree)
      .auth;
    expect(login.nonInteractive).toContain(KEY_PLACEHOLDER);
    expect(login.nonInteractivePowerShell).toContain(`"${KEY_PLACEHOLDER}"`);
    expect(login.nonInteractive).not.toContain("$env:");
  });

  it("lists exactly the environment variables the source reads", () => {
    const read = envReadBySource();
    // Guards against a vacuous pass: each of these is read somewhere today.
    expect(read).toEqual(
      expect.arrayContaining(["APPDATA", "SYNCHAIN_ERROR_FORMAT", "SYNCHAIN_TOKEN", "XDG_CONFIG_HOME"])
    );
    expect(ENVIRONMENT_HELP.map((entry) => entry.name).sort()).toEqual(read);
  });

  it("the source scan sees every naming form and rejects keys it cannot resolve", () => {
    const sample = [
      "process.env.PLAIN",
      "input.env?.OPTIONAL",
      'process.env["DOUBLE"]',
      "env['SINGLE']",
      "env?.[`BACKTICK`]",
      "process.env[TOKEN_ENV_VAR]",
    ].join("\n");
    expect(envNamesIn(sample, "sample")).toEqual([
      "PLAIN",
      "OPTIONAL",
      "DOUBLE",
      "SINGLE",
      "BACKTICK",
      "SYNCHAIN_TOKEN",
    ]);
    expect(() => envNamesIn("process.env[name]", "sample")).toThrow(/unknown key/);
    expect(() => envNamesIn("env[`${prefix}_TOKEN`]", "sample")).toThrow(/unknown key/);
  });

  it("reads process.env by name only, or hands it on whole as an object called `env`", () => {
    // Anything else -- `const { X } = process.env`, `const e = process.env; e.X` -- would read a
    // variable without the scan above seeing it.
    const handedOnAsEnv = /\benv(?::[^=,()]*)?\s*[:=]\s*$/;
    const stray = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          [...line.matchAll(/\bprocess\.env\b(?!\s*(?:\??\.|\[))/g)]
            .filter((m) => !handedOnAsEnv.test(line.slice(0, m.index)))
            .map(() => `${path.basename(file)}:${i + 1}: ${line.trim()}`)
        )
    );
    expect(stray).toEqual([]);
  });

  it("never prints anything shaped like a real key, in either format", async () => {
    for (const args of [["--help"], ["--help", "--format", "json"]]) {
      const { out } = await run(args);
      expect(out).toContain("synch_live_sk_…");
      expect(out).not.toMatch(/synch_live_sk_[0-9a-f]/i);
    }
  });
});

describe("text `--help`", () => {
  it("still prints commander's text help plus the documentation links", async () => {
    const { out, error } = await run(["--help"]);
    expect((error as CommanderError).exitCode).toBe(0);
    expect(() => JSON.parse(out) as unknown).toThrow();
    expect(out).toMatch(/^Usage: synchain \[options\] \[command\]/);
    expect(out).toContain("--format <fmt>");
    expect(out).toContain(`AI agents: install + usage guide at\n  ${DOCS_AGENTS}\n`);
    expect(out).toContain(`Humans: full reference at\n  ${DOCS_README}\n`);
  });

  it("says how to authenticate, what the environment does, and gives examples", async () => {
    const { out } = await run(["--help"]);
    expect(out).toContain(AUTH_HELP_TEXT);
    expect(out).toContain("SYNCHAIN_TOKEN");
    expect(out).toContain("Settings → CLI Access");
    expect(out).toContain(`${DEFAULT_BASE_URL}/settings`);
    expect(out).toContain("Examples:");
    expect(out).toContain("synchain help safety");
    // The key is injected from a CI secret, not typed where shell history keeps it.
    expect(out.replace(/\s+/g, " ")).toContain(`the key in ${TOKEN_ENV_VAR}, set from a CI secret`);
    // After commander's lists, before the documentation links.
    const at = (text: string): number => out.indexOf(text);
    expect(at("Commands:")).toBeLessThan(at("Authentication:"));
    expect(at("Authentication:")).toBeLessThan(at("Environment:"));
    expect(at("Environment:")).toBeLessThan(at("Examples:"));
    expect(at("Examples:")).toBeLessThan(at("AI agents:"));
  });

  it("says what the JSON `auth` / `environment` say", async () => {
    const { out } = await run(["--help"]);
    for (const line of [
      AUTH_HELP.credential,
      AUTH_HELP.login.interactive,
      AUTH_HELP.login.nonInteractive,
      AUTH_HELP.login.nonInteractivePowerShell,
      AUTH_HELP.obtain.url,
      AUTH_HELP.obtain.steps,
      AUTH_HELP.verify.offline,
      AUTH_HELP.verify.online,
    ]) {
      expect(out).toContain(line);
    }
    // Descriptions are wrapped in the text: compare with whitespace runs folded.
    const flat = out.replace(/\s+/g, " ");
    for (const { name, description } of ENVIRONMENT_HELP) {
      expect(flat).toContain(`${name} ${description}`);
    }
  });

  it("keeps the added blocks within the 80 columns commander wraps to off a terminal", () => {
    const lines = AUTH_HELP_TEXT.split("\n");
    expect(lines.filter((line) => line.length > HELP_TEXT_WIDTH)).toEqual([]);
    // A wrapped description continues under itself, not under the variable names.
    const first = lines.findIndex((line) => line.startsWith(`  ${TOKEN_ENV_VAR} `));
    const column = lines[first]!.indexOf(ENVIRONMENT_HELP[0]!.description.split(" ")[0]!);
    expect(lines[first + 1]!.slice(0, column).trim()).toBe("");
    expect(lines[first + 1]!.length).toBeGreaterThan(column);
  });

  it("shows --dry-run only as an example command line", async () => {
    const { out } = await run(["--help"]);
    const lines = out.split("\n").filter((line) => line.includes("--dry-run"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^ {2}synchain \S.* --dry-run$/);
  });

  it("`--format text --help` is the same text", async () => {
    const plain = await run(["--help"]);
    const explicit = await run(["--format", "text", "--help"]);
    expect(explicit.out).toBe(plain.out);
  });

  it("a subcommand's text help stays commander's own", async () => {
    const { out } = await run(["files", "--help"]);
    expect(out).toMatch(/^Usage: synchain files \[options\] \[command\]/);
    expect(out).toContain("upload [options] <localPath>");
    expect(out).not.toContain("Authentication:");
    expect(out).not.toContain("Examples:");
  });
});

describe("`-h` as an option value is a value, not a help request", () => {
  it("`discussion post --title -h --content x` runs the command and prints no help", async () => {
    const discMod = await import("../commands/discussion.js");
    const before = (discMod.runDiscussionPost as Mock).mock.calls.length;
    const { out, err, error } = await run([
      "discussion",
      "post",
      "--title",
      "-h",
      "--content",
      "x",
    ]);

    expect(error).toBeUndefined();
    expect(out).toBe("");
    expect(err).toBe("");
    const calls = (discMod.runDiscussionPost as Mock).mock.calls;
    expect(calls.length).toBe(before + 1);
    expect(calls[calls.length - 1]![0]).toMatchObject({ title: "-h", content: "x" });
  });

  it("the same holds with --format json in play", async () => {
    const discMod = await import("../commands/discussion.js");
    const { out, error } = await run([
      "--format",
      "json",
      "discussion",
      "post",
      "--title",
      "--help",
      "--content",
      "x",
    ]);
    expect(error).toBeUndefined();
    expect(out).toBe("");
    const calls = (discMod.runDiscussionPost as Mock).mock.calls;
    expect(calls[calls.length - 1]![0]).toMatchObject({
      title: "--help",
      content: "x",
      json: true,
    });
  });
});
