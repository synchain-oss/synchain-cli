// context7.json carries the Context7 claim (url + public_key) next to the indexing config.
// The public_key is public by design, but gitleaks' generic-api-key rule would flag it; the
// [[allowlists]] entry in .gitleaks.toml exempts exactly one anchored line of exactly this file.
// These checks keep the file in the shape that entry expects.
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = readFileSync(path.join(REPO_ROOT, "context7.json"), "utf8");
const config = JSON.parse(raw) as Record<string, unknown>;

describe("context7.json", () => {
  it("points the claim at this repository's Context7 library", () => {
    expect(config.url).toBe("https://context7.com/synchain-oss/synchain-cli");
  });

  it("carries a Context7 public key in the expected shape", () => {
    expect(config.public_key).toMatch(/^pk_[A-Za-z0-9]{16,40}$/);
  });

  it("keeps public_key on its own line, the only line the gitleaks allowlist exempts", () => {
    const lines = raw.split("\n").filter((line) => line.includes('"public_key"'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\s*"public_key": "pk_[A-Za-z0-9]{16,40}",?\s*$/);
  });
});
