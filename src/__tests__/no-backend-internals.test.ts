// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * This package is the open client of a closed-source backend, and it is being prepared to go
 * public. Describing the **HTTP contract** — endpoints, fields, status codes — is this repo's
 * job. Describing how the backend *implements* that contract is not: module paths, internal
 * identifiers and internal history say nothing a consumer can use, and cannot be reviewed by
 * anyone who reads this repo.
 *
 * The distinction is easy to lose in a comment written while looking at both codebases at once.
 * Five such comments had accumulated by 2026-09-06 — backend module paths, two internal function
 * names, an internal regex constant, an internal constant plus a link to an internal doc — and
 * every one of them read as helpful context at the time it was written. This test is the part
 * that does not depend on remembering.
 */
const REPO_ROOT = path.join(__dirname, "..", "..");

/**
 * Every git-tracked text file. Deliberately not a hand-maintained list: the point is to cover
 * files nobody thought to check, and `git ls-files` grows on its own.
 */
function trackedTextFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => /\.(ts|mts|js|mjs|json|md|ya?ml|ps1|toml)$/i.test(f))
    // This file necessarily contains every pattern it forbids.
    .filter((f) => !f.endsWith("no-backend-internals.test.ts"));
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
    pattern: /\bbuildReplyTree\b|\bfetchProjectDiscussion\b|\beventInputSchema\b|\bFALLBACK_ORIGIN\b/,
    why: "a backend internal identifier",
  },
];

describe("no closed-source backend internals in the public surface", () => {
  const files = trackedTextFiles();

  it("finds files to scan (guards against a silently empty sweep)", () => {
    // A `git ls-files` that returns nothing would make every assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(40);
    expect(files).toContain("src/commands/discussion.ts");
    expect(files).toContain("docs/reference.md");
  });

  it.each(FORBIDDEN)("no $why", ({ pattern, why }) => {
    const hits: string[] = [];
    for (const rel of files) {
      const text = readFileSync(path.join(REPO_ROOT, rel), "utf8");
      text.split("\n").forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits, `${why}\n${hits.join("\n")}`).toEqual([]);
  });
});
