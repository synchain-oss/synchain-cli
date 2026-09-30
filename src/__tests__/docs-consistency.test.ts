// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

/**
 * The public docs describe a contract that scripts and agents code against: option names, the
 * error envelope, exit codes, the `--dry-run` command list. Nothing in the build reads those
 * files, so nothing in the build notices when they drift -- and every drift this guards against
 * has already happened once in this repo:
 *
 * - a source comment pointed readers at a docs section that did not exist;
 * - the publishing notes listed a `files` array that no longer matched `package.json`;
 * - the install section still said "once published" long after the package was on npm;
 * - the two exit-code descriptions (reference and agent quickstart) could disagree silently.
 *
 * Each assertion below reads the docs as data, so a failure names the file and what to fix.
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

/** Every ```json fenced block in `md`, parsed. A block that does not parse fails the test. */
function jsonBlocks(md: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /```json\n([\s\S]*?)```/g;
  for (let m = re.exec(md); m; m = re.exec(md)) {
    blocks.push(JSON.parse(m[1]!) as unknown);
  }
  return blocks;
}

/** First-column integers of a markdown table (`| 3 | … |` or `` | `3` | … | ``). */
function tableCodes(md: string): number[] {
  return md
    .split("\n")
    .map((line) => /^\|\s*`?(\d+)`?\s*\|/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
}

const REFERENCE = "docs/reference.md";
const AGENTS = "docs/install-for-agents.md";

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

  it("documents every command that accepts --dry-run, and only those", () => {
    // Mirrors the command tree; if a mutating command gains or loses the flag, this list and the
    // table in the docs change together.
    const expected = [
      "calendar add",
      "calendar edit",
      "calendar rm",
      "discussion post",
      "discussion reply",
      "files mv",
      "files rename",
      "files rm",
      "files upload",
      "folders mkdir",
      "folders rename",
      "folders rm",
      "notifications read",
    ];
    const body = section(md, /^Dry runs$/);
    const listed = new Set(
      [...body.matchAll(/`((?:files|folders|calendar|discussion|notifications) [a-z]+)`/g)].map(
        (m) => m[1]!
      )
    );
    expect([...listed].sort()).toEqual(expected);
  });

  it("shows a dry-run plan that parses and carries the three stable fields", () => {
    const [plan] = jsonBlocks(section(md, /^Dry runs$/)) as Array<Record<string, unknown>>;
    expect(plan).toMatchObject({ dryRun: true, action: expect.any(String) });
    expect(typeof plan!.target).toBe("object");
  });

  it("shows an error envelope that parses and has exactly the four fields", () => {
    const [envelope] = jsonBlocks(section(md, /^Errors$/)) as Array<{ error: object }>;
    expect(Object.keys(envelope!.error).sort()).toEqual(["code", "detail", "status", "url"]);
  });

  it("names SYNCHAIN_ERROR_FORMAT where the error format is explained", () => {
    expect(section(md, /^Errors$/)).toContain("SYNCHAIN_ERROR_FORMAT");
  });

  it("shows a doctor report that parses as {ok, checks[{id,status,detail}]}", () => {
    const [report] = jsonBlocks(section(md, /^`synchain doctor`$/)) as Array<{
      ok: boolean;
      checks: Array<Record<string, unknown>>;
    }>;
    expect(typeof report!.ok).toBe("boolean");
    expect(report!.checks.length).toBeGreaterThan(0);
    for (const check of report!.checks) {
      expect(Object.keys(check).sort()).toEqual(["detail", "id", "status"]);
    }
  });
});

describe("exit codes", () => {
  it("are the same categories in the reference and in the agent quickstart", () => {
    const reference = tableCodes(section(read(REFERENCE), /^Exit codes$/));
    const agents = tableCodes(section(read(AGENTS), /Exit codes/));
    expect(reference).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(agents).toEqual(reference);
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
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
      return name.endsWith(".ts") ? [full] : [];
    });
  }

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
    expect(cfg.description).toMatch(/Synchain/);
    for (const key of ["folders", "excludeFolders", "excludeFiles", "rules"] as const) {
      expect(Array.isArray(cfg[key]), key).toBe(true);
    }
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
