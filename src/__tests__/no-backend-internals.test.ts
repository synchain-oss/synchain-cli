// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * This package is the open client of a closed-source backend, and it is being prepared to go
 * public. Describing the **HTTP contract** — endpoints, fields, status codes — is this repo's
 * job. Describing how the backend *implements* that contract is not: module paths, internal
 * identifiers and internal history say nothing a consumer can use, and cannot be reviewed by
 * anyone who reads this repo.
 *
 * The distinction is easy to lose in a comment written while looking at both codebases at once.
 * Five such comments had accumulated by 2026-09-06, and every one of them read as helpful
 * context at the time it was written. This test is the part that does not depend on remembering.
 *
 * ## What this guards, exactly
 *
 * The three patterns below, and nothing else: backend module paths, backend constant names
 * introduced as "server-side X", and a short list of backend identifiers already seen leaking.
 *
 * ## What it deliberately does NOT guard
 *
 * **Internal planning codenames and doc references** — `J20`, `C10`, `ADR-013`, `12 §2.1` and
 * friends, currently spread across ~15 files (workflows, `REUSE.toml`, `.gitleaks.toml`,
 * `docs/contract-changes/`, `CLAUDE.md`). They are not implementation leaks: they expose no
 * backend internals, only that a planning system exists which readers cannot follow. Cleaning
 * them up is a writing task with judgement in it — some references are load-bearing for
 * maintainers — so it belongs to whoever owns the publicization pass, not to a regex here.
 *
 * That split is stated because an earlier version of this comment claimed to cover the
 * codenames too. A guard whose description is broader than its patterns is worse than no
 * guard: it invites the next reader to trust a check that was never running.
 */
const REPO_ROOT = path.join(__dirname, "..", "..");

/**
 * Every git-tracked text file, read once.
 *
 * Deliberately not a hand-maintained list: the point is to cover files nobody thought to check,
 * and `git ls-files` grows on its own. It lists the *index*, so a tracked-but-deleted file would
 * otherwise blow up with ENOENT in the middle of a security assertion — filtered, not caught,
 * so a genuinely unreadable file still fails loudly.
 */
function trackedTextFiles(): Array<{ rel: string; text: string }> {
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" });
  return listed
    .split("\0")
    .filter(Boolean)
    .filter((f) => /\.(ts|mts|js|mjs|json|md|ya?ml|ps1|toml)$/i.test(f))
    // This file necessarily contains every pattern it forbids.
    .filter((f) => !f.endsWith("no-backend-internals.test.ts"))
    .filter((f) => existsSync(path.join(REPO_ROOT, f)))
    .map((rel) => ({ rel, text: readFileSync(path.join(REPO_ROOT, rel), "utf8") }));
}

/**
 * Each entry is a shape, not a single string — the specific leaks are already fixed, so pinning
 * their exact text would guard nothing. `why` is what a failure message needs in order to be
 * actionable rather than mysterious.
 */
const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    // `lib/<area>/<file>.ts` is the backend's layout, not this package's (this one uses `src/`).
    pattern: /\blib\/[a-z0-9-]+\/[a-z0-9-]+\.tsx?\b/i,
    why: "a backend module path — say what the API accepts, not which file defines it",
  },
  {
    // SCREAMING_SNAKE identifiers attributed to the server: the value is contract, the name is not.
    pattern: /server-side [A-Z][A-Z0-9_]{4,}/,
    why: "a backend constant's name — describe the rule, not the identifier that holds it",
  },
  {
    // Named outright, so a rephrasing ("the backend's FILE_NAME_FORBIDDEN_RE") cannot slip past
    // the "server-side " wording the pattern above depends on.
    pattern:
      /\bbuildReplyTree\b|\bfetchProjectDiscussion\b|\beventInputSchema\b|\bFALLBACK_ORIGIN\b|\bFILE_NAME_FORBIDDEN_RE\b/,
    why: "a backend internal identifier",
  },
];

describe("no closed-source backend internals in the public surface", () => {
  const files = trackedTextFiles();

  it("finds files to scan (guards against a silently empty sweep)", () => {
    // A `git ls-files` that returns nothing would make every assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(40);
    const names = files.map((f) => f.rel);
    expect(names).toContain("src/commands/discussion.ts");
    expect(names).toContain("docs/reference.md");
  });

  it.each(FORBIDDEN)("no $why", ({ pattern, why }) => {
    const hits: string[] = [];
    for (const { rel, text } of files) {
      text.split("\n").forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits, `${why}\n${hits.join("\n")}`).toEqual([]);
  });
});
