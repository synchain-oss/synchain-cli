// SPDX-License-Identifier: MIT
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What `import "@synchain/cli"` gives a consumer: declarations shipped in the tarball, an
 * `exports` map that opens only `.` and `./package.json`, and an entry that re-exports the
 * error classes (and types) but not the CLI's own wiring (`main` / `buildProgram` are internal:
 * exporting them would make them public API to keep stable).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface PackageJson {
  description: string;
  keywords: string[];
  main: string;
  types: string;
  exports: unknown;
  bin: Record<string, string>;
  files: string[];
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as PackageJson;

const ERROR_CLASSES = [
  "ApiError",
  "AuthError",
  "ConflictError",
  "ForbiddenError",
  "NotFoundError",
  "RateLimitError",
  "ServerError",
  "ValidationError",
];

describe("package.json", () => {
  it("points main / types / exports at the built entry and opens nothing else", () => {
    expect(pkg.main).toBe("./dist/index.js");
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(pkg.exports).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./package.json": "./package.json",
    });
    // The binary is unaffected by the library entry.
    expect(pkg.bin).toEqual({ synchain: "./dist/index.js" });
  });

  it("describes the product in the words the README opens with", () => {
    expect(pkg.description).toBe(
      "Command-line interface for Synchain — the all-in-one music and audio production " +
        "collaboration platform. Manage project files, scheduling, discussion and members " +
        "from your terminal."
    );
    // README paragraphs are hard-wrapped, so compare with whitespace collapsed.
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8").replace(/\s+/g, " ");
    const firstSentence = pkg.description.split(". ")[0]!;
    expect(readme).toContain(`${firstSentence}.`);
  });

  it("carries the discovery keywords", () => {
    for (const keyword of ["music-production", "audio", "daw", "ai-agents", "json"]) {
      expect(pkg.keywords).toContain(keyword);
    }
  });
});

describe("package entry", () => {
  it("exports exactly the error classes at runtime (no main / buildProgram)", async () => {
    const entry = (await import("../index.js")) as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(ERROR_CLASSES);
    const api = await import("../api.js");
    expect(entry.ApiError).toBe(api.ApiError);
    expect(entry.NotFoundError).toBe(api.NotFoundError);
  });
});

describe("npm pack", () => {
  it("ships the type declarations for the entry and the error module", () => {
    // The test runs before `npm run build` in both `npm run gates` and CI, so build first.
    execFileSync(
      process.execPath,
      [path.join(ROOT, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"],
      { cwd: ROOT, stdio: "pipe" }
    );
    const raw = execSync("npm pack --dry-run --json --ignore-scripts", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [report] = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>;
    const files = report!.files.map((file) => file.path.replace(/\\/g, "/"));

    expect(files).toContain("dist/index.js");
    expect(files).toContain("dist/index.d.ts");
    expect(files).toContain("dist/api.d.ts");
    expect(files.some((file) => file.includes("__tests__"))).toBe(false);

    const dts = readFileSync(path.join(ROOT, "dist/index.d.ts"), "utf8");
    for (const name of ERROR_CLASSES) expect(dts).toContain(name);
    expect(dts).toContain("OutputFormat");
    expect(dts).toContain("CommandTree");
    expect(dts).not.toMatch(/function\s+(main|buildProgram)\b/);
    expect(dts).not.toMatch(/export\s*\{[^}]*\b(main|buildProgram)\b[^}]*\}/);
  }, 180_000);
});
