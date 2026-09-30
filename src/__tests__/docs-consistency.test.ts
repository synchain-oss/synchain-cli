// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { apiErrorFor, buildErrorEnvelope, EXIT_CODES, exitCodeFor } from "../api.js";
import { DEFAULT_BASE_URL } from "../config.js";
import { evaluateDoctor, type DoctorInput } from "../doctor.js";
import { reportDryRun } from "../dry-run.js";
import { buildHelpJson, type CommandTreeNode } from "../help-json.js";
import * as entry from "../index.js";
import { buildProgram } from "../program.js";

/**
 * The public docs describe a contract that scripts and agents code against: option names, the
 * error envelope, exit codes, the `--dry-run` command list. Nothing in the build reads those
 * files, so nothing in the build notices when they drift -- and every drift this guards against
 * has already happened once in this repo:
 *
 * - a source comment pointed readers at a docs section that did not exist;
 * - the publishing notes listed a `files` array that no longer matched `package.json`;
 * - the install section still said "once published" long after the package was on npm;
 * - the docs were drafted against a prototype, and the merged code then differed from it in
 *   error codes, exit codes and output wording.
 *
 * So the expected side of each assertion comes from the implementation wherever it can: the
 * command tree `--help --format json` prints, `EXIT_CODES` / `exitCodeFor`, the codes the source
 * passes to `reportError`, `evaluateDoctor`, `reportDryRun`, the package entry's exports. A
 * failure then names the doc and what the code actually does.
 */
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/**
 * The body of the first heading (any level) whose text matches `heading`, up to the next heading
 * of the same or a higher level. Fenced code is skipped when looking for the end, since a `#`
 * comment inside a bash block is not a heading.
 */
function section(md: string, heading: RegExp): string {
  const lines = md.split("\n");
  let start = -1;
  let level = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) continue;
    if (start === -1) {
      if (heading.test(m[2]!)) {
        start = i + 1;
        level = m[1]!.length;
      }
    } else if (m[1]!.length <= level) {
      return lines.slice(start, i).join("\n");
    }
  }
  if (start === -1) throw new Error(`no heading matching ${heading}`);
  return lines.slice(start).join("\n");
}

/** Every fenced block of `lang` in `md`, as raw text. */
function fencedBlocks(md: string, lang: string): string[] {
  const re = new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g");
  return [...md.matchAll(re)].map((m) => m[1]!);
}

/** Every ```json fenced block in `md`, parsed. A block that does not parse fails the test. */
function jsonBlocks(md: string): unknown[] {
  return fencedBlocks(md, "json").map((block) => JSON.parse(block) as unknown);
}

/** The cells of a markdown table row, or null for a line that is not one. `\|` is a literal bar. */
function cells(line: string): string[] | null {
  if (!line.startsWith("|")) return null;
  return line
    .replace(/\\\|/g, "\u0000")
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.replace(/\u0000/g, "|").trim());
}

/** The body rows of the first table in `md` whose first header cell matches `firstHeader`. */
function table(md: string, firstHeader: RegExp): string[][] {
  const lines = md.split("\n");
  for (let i = 0; i + 1 < lines.length; i++) {
    const header = cells(lines[i]!);
    if (!header || !firstHeader.test(header[0]!)) continue;
    if (!/^\|[\s|:-]+$/.test(lines[i + 1]!.trim())) continue;
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length && lines[j]!.startsWith("|"); j++) {
      rows.push(cells(lines[j]!)!);
    }
    return rows;
  }
  throw new Error(`no table whose first column is headed ${firstHeader}`);
}

/** Every `backticked` span in `text`. */
function ticks(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}

/** First-column integers of a markdown table (`| 3 | … |` or `` | `3` | … | ``). */
function tableCodes(md: string): number[] {
  return md
    .split("\n")
    .map((line) => /^\|\s*`?(\d+)`?\s*\|/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
}

/** Terminal colour sequences removed, so printed output compares with the docs' plain text. */
function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Source files under `dir` (recursively), tests excluded. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

const REFERENCE = "docs/reference.md";
const AGENTS = "docs/install-for-agents.md";

// -- the implementation, read the way an agent reads it --------------------------------------

/** What `synchain --help --format json` prints. */
const TREE = buildHelpJson(buildProgram(["node", "synchain"]));

interface Leaf {
  /** `files rm`, `login`, … */
  path: string;
  /** Long option names the command declares (`--json`, `--dry-run`, …). */
  longs: string[];
}

function leaves(node: CommandTreeNode, prefix: string[] = []): Leaf[] {
  return node.commands.flatMap((child) => {
    const at = [...prefix, child.name];
    if (child.commands.length > 0) return leaves(child, at);
    const longs = child.options.flatMap((o) =>
      o.flags.split(/[\s,]+/).filter((f) => f.startsWith("--"))
    );
    return [{ path: at.join(" "), longs }];
  });
}

function allNodes(node: CommandTreeNode): CommandTreeNode[] {
  return [node, ...node.commands.flatMap(allNodes)];
}

const LEAVES = leaves(TREE);
const declaring = (long: string): string[] =>
  LEAVES.filter((l) => l.longs.includes(long))
    .map((l) => l.path)
    .sort();
const DRY_RUN_COMMANDS = declaring("--dry-run");
const WITHOUT_JSON = LEAVES.filter((l) => !l.longs.includes("--json"))
  .map((l) => l.path)
  .sort();

/** Command groups (`files`, `folders`, …), for recognising `group command` spans in prose. */
const GROUPS = TREE.commands.filter((c) => c.commands.length > 0).map((c) => c.name);

/**
 * Every `` `group command` `` span in `md`, with the `files upload|mv|rm` shorthand expanded.
 * Sorted and de-duplicated.
 */
function commandsIn(md: string): string[] {
  const re = new RegExp("`((?:" + GROUPS.join("|") + ")) ([a-z]+(?:\\|[a-z]+)*)`", "g");
  const found = [...md.matchAll(re)].flatMap((m) => m[2]!.split("|").map((c) => `${m[1]} ${c}`));
  return [...new Set(found)].sort();
}

/**
 * `action` -> the top-level keys of `target`, for every `reportDryRun` call in src/commands.
 * A command with two call sites (`notifications read <id>` / `--all`) gets the union.
 */
function dryRunTargetsInSource(): {
  sites: number;
  calls: number;
  targets: Map<string, Set<string>>;
} {
  const targets = new Map<string, Set<string>>();
  let sites = 0;
  let calls = 0;
  for (const file of sourceFiles(path.join(REPO_ROOT, "src", "commands"))) {
    const text = readFileSync(file, "utf8");
    calls += [...text.matchAll(/reportDryRun\(/g)].length;
    const re = /reportDryRun\([^,]+,\s*\{\s*action:\s*"([^"]+)",\s*target:\s*\{/g;
    for (const m of text.matchAll(re)) {
      sites++;
      const start = m.index! + m[0].length;
      let depth = 1;
      let end = start;
      while (depth > 0) {
        const ch = text[end++]!;
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      const parts: string[] = [];
      let nest = 0;
      let current = "";
      for (const ch of text.slice(start, end - 1)) {
        if ("{([".includes(ch)) nest++;
        else if ("})]".includes(ch)) nest--;
        if (ch === "," && nest === 0) {
          parts.push(current);
          current = "";
        } else current += ch;
      }
      parts.push(current);
      const keys = parts
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => /^([A-Za-z_$][\w$]*)/.exec(p)![1]!);
      const set = targets.get(m[1]!) ?? new Set<string>();
      for (const k of keys) set.add(k);
      targets.set(m[1]!, set);
    }
  }
  return { sites, calls, targets };
}

/**
 * Every envelope / warning `code` the implementation can emit on its own: the literals passed as
 * `code:`, the id-resolution codes, the usage codes `exitCodeFor` knows (commander's parse errors
 * among them), and `buildErrorEnvelope`'s own fallbacks. Server codes are the server's business
 * and not listed here.
 */
function emittedCodes(): string[] {
  const source = sourceFiles(path.join(REPO_ROOT, "src"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const literals = [...source.matchAll(/\bcode: "([a-z_]+)"/g)].map((m) => m[1]!);
  const quoted = (text: string | undefined): string[] =>
    [...(text ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
  const idCodes = quoted(
    /type IdResolutionCode =([^;]+);/.exec(read("src/util/resolve-id.ts"))?.[1]
  );
  const usage = quoted(
    /const USAGE_CODES = new Set\(\[([\s\S]*?)\]\)/.exec(read("src/api.ts"))?.[1]
  );
  const fallbacks = [
    buildErrorEnvelope(new Error("x")).error.code,
    buildErrorEnvelope(new TypeError("fetch failed")).error.code,
  ];
  expect(idCodes.length, "IdResolutionCode not found in resolve-id.ts").toBeGreaterThan(0);
  expect(usage.length, "USAGE_CODES not found in api.ts").toBeGreaterThan(0);
  return [...new Set([...literals, ...idCodes, ...usage, ...fallbacks])].sort();
}

function doctorInput(overrides: Partial<DoctorInput>): DoctorInput {
  return {
    configPath: "/home/me/.config/synchain/config.json",
    config: null,
    env: {},
    nodeVersion: "v20.18.0",
    platform: "linux",
    defaultBaseUrl: DEFAULT_BASE_URL,
    ...overrides,
  };
}

/** Every check id `evaluateDoctor` can report, from inputs that between them trigger all. */
function doctorCheckIds(): string[] {
  const inputs = [
    doctorInput({}),
    doctorInput({
      // Group- and world-readable on POSIX: the only case the permissions check appears in.
      config: {
        value: { token: "t", baseUrl: DEFAULT_BASE_URL, activeProject: { id: "x" } },
        mode: 0o100644,
      },
    }),
  ];
  return [...new Set(inputs.flatMap((i) => evaluateDoctor(i).checks.map((c) => c.id)))].sort();
}

/** What `reportDryRun` writes to stdout, one entry per console.log call. */
function printedDryRun(json: boolean): string[] {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    reportDryRun({ json }, { action: "files.rm", target: {}, summary: "would delete x." });
    return log.mock.calls.map((call) => plain(String(call[0])));
  } finally {
    log.mockRestore();
  }
}

// -- the docs ---------------------------------------------------------------------------------

describe("the implementation this test reads (guards against vacuous passes)", () => {
  it("has write commands, groups and dry-run call sites", () => {
    expect(DRY_RUN_COMMANDS.length).toBeGreaterThan(0);
    expect(GROUPS).toContain("files");
    const { sites, calls } = dryRunTargetsInSource();
    // Every reportDryRun call was parsed; a call written another way would otherwise drop out.
    expect(sites).toBe(calls);
    expect(sites).toBeGreaterThanOrEqual(DRY_RUN_COMMANDS.length);
  });
});

describe("docs/reference.md", () => {
  const md = read(REFERENCE);

  it("does not describe the npm package as unpublished", () => {
    expect(md).not.toMatch(/once published/i);
  });

  it("lists exactly what package.json `files` ships", () => {
    const pkg = JSON.parse(read("package.json")) as { files: string[] };
    const line = md.split("\n").find((l) => /`files` ships/.test(l));
    expect(line, "the Publishing section must say what `files` ships").toBeDefined();
    for (const entry of pkg.files) {
      expect(line, `\`files\` ships ${entry} but the docs do not say so`).toContain(`\`${entry}`);
    }
  });

  it.each([
    /^Global options$/,
    /^Machine-readable help$/,
    /^Dry runs$/,
    /^Errors$/,
    /^Exit codes$/,
    /^`synchain doctor`$/,
  ])("has a section matching %s", (heading) => {
    expect(() => section(md, heading)).not.toThrow();
  });

  describe("Global options", () => {
    const rows = table(section(md, /^Global options$/), /^Option$/);
    const row = (flag: string): string[] => {
      const found = rows.find((r) => ticks(r[0]!)[0]?.startsWith(flag));
      expect(found, `no row for ${flag}`).toBeDefined();
      return found!;
    };

    it("--format is declared once, on the root, and so works in any position", () => {
      expect(TREE.options.some((o) => o.flags.startsWith("--format "))).toBe(true);
      expect(declaring("--format")).toEqual([]);
      expect(row("--format")[1]).toMatch(/every command/);
    });

    it.each(["--base-url", "--yes"])("%s names exactly the commands that declare it", (flag) => {
      // These two are per-command options: a doc that calls them global sends a script to pass
      // `--base-url` to `files ls`, which is an unknown option (exit 2).
      const actual = declaring(flag);
      expect(actual.length).toBeGreaterThan(0);
      expect(ticks(row(flag)[1]!).sort()).toEqual(actual);
    });

    it("--json names exactly the commands without it", () => {
      const cell = row("--json")[1]!;
      expect(cell).toMatch(/except/);
      expect(ticks(cell).sort()).toEqual(WITHOUT_JSON);
    });
  });

  describe("Machine-readable help", () => {
    const body = section(md, /^Machine-readable help$/);

    it("documents exactly the fields a node of the command tree has", () => {
      const keys = new Set(allNodes(TREE).flatMap((n) => Object.keys(n)));
      keys.delete("version"); // root-only, described in the prose below the table
      const documented = table(body, /^Field$/).map((r) => ticks(r[0]!)[0]!);
      expect(documented.sort()).toEqual([...keys].sort());
      expect(Object.keys(TREE)).toContain("version");
      expect(body).toContain("`version`");
    });

    it("is right that the help option is left out of `options`", () => {
      const listed = allNodes(TREE).flatMap((n) => n.options.map((o) => o.flags));
      expect(listed.some((flags) => flags.includes("--help"))).toBe(false);
      expect(body).toContain("`-h, --help` is left out");
    });
  });

  describe("Dry runs", () => {
    const body = section(md, /^Dry runs$/);
    const rows = table(body, /^Command$/);

    it("lists every command whose --help declares --dry-run, and only those", () => {
      expect(rows.map((r) => ticks(r[0]!)[0]!).sort()).toEqual(DRY_RUN_COMMANDS);
      expect(commandsIn(body)).toEqual(DRY_RUN_COMMANDS);
    });

    it("gives each command the `action` the source reports, `<group>.<command>`", () => {
      const { targets } = dryRunTargetsInSource();
      for (const [command, action] of rows.map((r) => [ticks(r[0]!)[0]!, ticks(r[1]!)[0]!])) {
        expect(action, command).toBe(command!.replace(" ", "."));
      }
      expect(rows.map((r) => ticks(r[1]!)[0]!).sort()).toEqual([...targets.keys()].sort());
    });

    it("names the top-level `target` fields each action's source builds", () => {
      // Convention in the table: top-level keys are backticked, nested ones are not, and quoted
      // values ("all") are not keys.
      const { targets } = dryRunTargetsInSource();
      for (const r of rows) {
        const action = ticks(r[1]!)[0]!;
        const documented = ticks(r[2]!).filter((t) => /^[A-Za-z]+$/.test(t)).sort();
        expect(documented, action).toEqual([...(targets.get(action) ?? [])].sort());
      }
    });

    it("shows the text form reportDryRun prints", () => {
      const [doc] = fencedBlocks(body, "text");
      const docLines = doc!.trimEnd().split("\n");
      const printed = printedDryRun(false);
      expect(docLines).toHaveLength(printed.length);
      expect(printed[0]).toMatch(/^\[dry-run\] would /);
      expect(docLines[0]).toMatch(/^\[dry-run\] would /);
      expect(docLines.slice(1)).toEqual(printed.slice(1));
    });

    it("shows a JSON plan with reportDryRun's fields, in its order", () => {
      const [plan] = jsonBlocks(body) as Array<Record<string, unknown>>;
      const printed = JSON.parse(printedDryRun(true).join("\n")) as Record<string, unknown>;
      expect(Object.keys(plan!)).toEqual(Object.keys(printed));
      expect(plan!.dryRun).toBe(true);
      expect(typeof plan!.target).toBe("object");
    });
  });

  describe("Errors", () => {
    const body = section(md, /^Errors$/);

    it("shows the envelope buildErrorEnvelope produces for its example", () => {
      const [envelope] = jsonBlocks(body) as Array<{
        error: { code: string; status: number; url: string; detail: string };
      }>;
      const { status, url, detail } = envelope!.error;
      expect(buildErrorEnvelope(apiErrorFor(status, url, JSON.parse(detail)))).toEqual(envelope);
    });

    it("names SYNCHAIN_ERROR_FORMAT where the error format is explained", () => {
      expect(body).toContain("SYNCHAIN_ERROR_FORMAT");
    });

    it("gives every CLI code the exit code exitCodeFor assigns it", () => {
      const fixed = table(body, /^`code`$/).filter((r) => /^`?\d`?$/.test(r[2]!));
      expect(fixed.length).toBeGreaterThan(0);
      for (const [codes, , exit] of fixed) {
        for (const code of ticks(codes!)) {
          expect(exitCodeFor(new Error("x"), code), code).toBe(Number(exit!.replace(/`/g, "")));
        }
      }
    });

    it("mentions every code the CLI emits itself", () => {
      const missing = emittedCodes().filter((code) => !body.includes(`\`${code}\``));
      expect(missing).toEqual([]);
    });

    it("names everything the package entry exports", () => {
      const types = [...read("src/index.ts").matchAll(/export type \{([^}]+)\}/g)].flatMap((m) =>
        m[1]!.split(",").map((s) => s.trim()).filter(Boolean)
      );
      const names = [...Object.keys(entry), ...types];
      expect(names.length).toBeGreaterThan(types.length);
      expect(names.filter((n) => !body.includes(`\`${n}\``))).toEqual([]);
    });
  });

  it("shows a doctor report that parses as {ok, checks[{id,status,detail}]}", () => {
    const [report] = jsonBlocks(section(md, /^`synchain doctor`$/)) as Array<{
      ok: boolean;
      checks: Array<Record<string, unknown>>;
    }>;
    expect(typeof report!.ok).toBe("boolean");
    expect(report!.checks.length).toBeGreaterThan(0);
    const ids = doctorCheckIds();
    for (const check of report!.checks) {
      expect(Object.keys(check).sort()).toEqual(["detail", "id", "status"]);
      expect(ids).toContain(check.id);
      expect(["ok", "warn", "fail"]).toContain(check.status);
    }
  });

  it("documents exactly the check ids evaluateDoctor reports", () => {
    const rows = table(section(md, /^`synchain doctor`$/), /^Check `id`$/);
    expect(rows.map((r) => ticks(r[0]!)[0]!).sort()).toEqual(doctorCheckIds());
  });
});

describe("exit codes", () => {
  const reference = section(read(REFERENCE), /^Exit codes$/);
  const agents = section(read(AGENTS), /Exit codes/);

  it("are EXIT_CODES, the same in the reference and in the agent quickstart", () => {
    const codes = [...new Set(Object.values(EXIT_CODES))].sort((a, b) => a - b);
    expect(tableCodes(reference)).toEqual(codes);
    expect(tableCodes(agents)).toEqual(codes);
  });

  it.each([
    ["reference", reference],
    ["agent quickstart", agents],
  ])("the %s puts each HTTP status in the row exitCodeFor maps it to", (_name, body) => {
    const rowFor = (exit: number): string =>
      body.split("\n").find((l) => new RegExp("^\\|\\s*`?" + exit + "`?\\s*\\|").test(l)) ?? "";
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      const row = rowFor(exitCodeFor(apiErrorFor(status, "", null)));
      expect(row, String(status)).toContain(`\`${status}\``);
    }
    expect(rowFor(exitCodeFor(apiErrorFor(503, "", null)))).toContain("`5xx`");
  });
});

describe("docs/install-for-agents.md", () => {
  const md = read(AGENTS);

  it("lists exactly the --dry-run commands under Safe trial runs", () => {
    expect(commandsIn(section(md, /Safe trial runs/))).toEqual(DRY_RUN_COMMANDS);
  });

  it("names exactly the commands without --json in its flag summary", () => {
    const row = table(md, /^Variable \/ flag$/).find((r) => ticks(r[0]!)[0] === "--json");
    expect(row).toBeDefined();
    expect(row![1]).toMatch(/except/);
    expect(ticks(row![1]!).sort()).toEqual(WITHOUT_JSON);
  });

  it("shows an error envelope buildErrorEnvelope would produce", () => {
    for (const envelope of jsonBlocks(section(md, /Exit codes and errors/)) as Array<{
      error: { status: number; url: string; detail: string };
    }>) {
      const { status, url, detail } = envelope.error;
      expect(buildErrorEnvelope(apiErrorFor(status, url, JSON.parse(detail)))).toEqual(envelope);
    }
  });
});

describe("counts of dry-run commands", () => {
  it.each([REFERENCE, AGENTS, "CHANGELOG.md"])("%s says as many as the tree has", (rel) => {
    const text = rel === "CHANGELOG.md" ? section(read(rel), /^Unreleased$/) : read(rel);
    const counts = [...text.matchAll(/\b(\d+) commands\b/g)].map((m) => Number(m[1]));
    for (const n of counts) expect(n).toBe(DRY_RUN_COMMANDS.length);
  });
});

describe("non-interactive login", () => {
  /**
   * Without a terminal `login` used to stop at the base-URL prompt, exit 0 and save nothing, so
   * the docs spelled out the default host to get past it. It no longer prompts: the key comes
   * from SYNCHAIN_TOKEN and the base URL defaults. The workaround is gone from every place an
   * agent would copy it from; a copied `--base-url` would also override a stored test host.
   */
  const workaround = `--base-url ${DEFAULT_BASE_URL}`;

  it.each([
    [REFERENCE, /^Non-interactive/],
    [REFERENCE, /^Troubleshooting$/],
    [AGENTS, /Authenticate without prompts/],
  ])("%s (%s) no longer needs --base-url for the default host", (rel, heading) => {
    const body = section(read(rel), heading);
    expect(body).not.toContain(workaround);
  });

  it.each([
    [REFERENCE, /^Non-interactive/],
    [AGENTS, /Authenticate without prompts/],
  ])("%s (%s) says what login does without a terminal", (rel, heading) => {
    const body = section(read(rel), heading);
    expect(body).toContain("SYNCHAIN_TOKEN");
    expect(body).toMatch(/not a terminal/);
    expect(body).toContain("missing_argument");
  });
});

describe("placeholder hosts", () => {
  it.each([REFERENCE, AGENTS, "README.md"])("%s has no made-up example host", (rel) => {
    // A fake host in a copy-paste example gets copied and pasted: the default already is the
    // real one, so an example only needs `--base-url` when it means a different deployment.
    expect(read(rel)).not.toContain("your-synchain.example");
  });
});

describe("docs sections referenced from source comments", () => {
  /**
   * A comment that says `the "X" section of docs/Y.md` is a promise that X exists. The one in
   * resolve-id.ts pointed at a section that had never been written; this keeps every such
   * pointer honest. Comment continuation markers are folded first, so a reference may wrap.
   */
  const refs = sourceFiles(path.join(REPO_ROOT, "src")).flatMap((file) => {
    const text = readFileSync(file, "utf8").replace(/\n\s*(?:\*|\/\/)\s?/g, " ");
    return [...text.matchAll(/the "([^"]+)" section of `(docs\/[\w./-]+\.md)`/g)].map((m) => ({
      from: path.relative(REPO_ROOT, file).replace(/\\/g, "/"),
      title: m[1]!,
      doc: m[2]!,
    }));
  });

  it("finds at least the resolve-id.ts reference (guards against a vacuous pass)", () => {
    expect(refs.map((r) => r.from)).toContain("src/util/resolve-id.ts");
  });

  it("every referenced section exists", () => {
    const missing = refs.filter(({ title, doc }) => {
      const headings = read(doc)
        .split("\n")
        .filter((l) => /^#{1,6}\s/.test(l));
      return !headings.some((h) => h.includes(title));
    });
    expect(missing).toEqual([]);
  });
});

describe("README.md", () => {
  const readme = read("README.md");
  const anchor = readme.indexOf("\n## 简体中文");
  const english = readme.slice(0, anchor);
  const chinese = readme.slice(anchor);

  it.each([
    "--format json",
    "--help --format json",
    "--dry-run",
    "synchain doctor",
    "SYNCHAIN_ERROR_FORMAT",
  ])("mentions %s in both the English and the Chinese half", (token) => {
    // check-readme-parity.ps1 compares heading structure only; this compares substance.
    expect(anchor).toBeGreaterThan(0);
    expect(english, "English half").toContain(token);
    expect(chinese, "Chinese half").toContain(token);
  });
});

describe("CHANGELOG.md, Unreleased", () => {
  const unreleased = section(read("CHANGELOG.md"), /^Unreleased$/);

  it("names everything the package entry now exports", () => {
    const types = [...read("src/index.ts").matchAll(/export type \{([^}]+)\}/g)].flatMap((m) =>
      m[1]!.split(",").map((s) => s.trim()).filter(Boolean)
    );
    const names = [...Object.keys(entry), ...types];
    expect(names.filter((n) => !unreleased.includes(`\`${n}\``))).toEqual([]);
  });

  it("records the non-interactive login fix and the -h fix under Fixed", () => {
    const fixed = section(unreleased, /^Fixed$/);
    expect(fixed).toContain("SYNCHAIN_TOKEN");
    expect(fixed).toContain("`-h`");
  });
});

describe("context7.json", () => {
  interface Context7 {
    $schema: string;
    projectTitle: string;
    description: string;
    folders: string[];
    excludeFolders: string[];
    excludeFiles: string[];
    rules: string[];
  }
  const load = (): Context7 => JSON.parse(read("context7.json")) as Context7;

  it("declares the documented schema and every field Context7 reads", () => {
    const cfg = load();
    expect(cfg.$schema).toBe("https://context7.com/schema/context7.json");
    expect(cfg.projectTitle).toBe("Synchain CLI");
    for (const key of ["folders", "excludeFolders", "excludeFiles", "rules"] as const) {
      expect(Array.isArray(cfg[key]), key).toBe(true);
    }
  });

  it("describes the package the way package.json does", () => {
    const pkg = JSON.parse(read("package.json")) as { description: string };
    expect(load().description).toBe(pkg.description);
  });

  it("points only at folders that exist (a typo would silently index nothing)", () => {
    const cfg = load();
    for (const dir of [...cfg.folders, ...cfg.excludeFolders]) {
      expect(existsSync(path.join(REPO_ROOT, dir)), dir).toBe(true);
    }
  });

  it("tells agents the key goes through SYNCHAIN_TOKEN or login, never argv", () => {
    const rules = load().rules.join("\n");
    expect(rules).toContain("SYNCHAIN_TOKEN");
    expect(rules).toMatch(/never pass a key as a command-line argument/i);
    expect(rules).not.toContain(`--base-url ${DEFAULT_BASE_URL}`);
  });
});

describe("frozen-contract record", () => {
  it("exists for this change and states the HTTP contract impact", () => {
    const dir = path.join(REPO_ROOT, "docs", "contract-changes");
    const record = readdirSync(dir).find((f) => /^\d{8}-agent-contract-restored\.md$/.test(f));
    expect(record, "docs/contract-changes/<YYYYMMDD>-agent-contract-restored.md").toBeDefined();
    expect(readFileSync(path.join(dir, record!), "utf8")).toContain("contract-impact: none");
  });
});
