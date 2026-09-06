// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { DEFAULT_BASE_URL } from "../config.js";

/**
 * The default host every unconfigured `synchain login` resolves to.
 *
 * It used to be the Vercel deployment domain rather than the platform's own origin. Both serve
 * the same app, so nothing was broken — which is exactly why it went unnoticed for so long: a
 * deployment hostname is an implementation detail that can be retired without warning, and this
 * was the value the CLI taught every new user to trust.
 *
 * The second `describe` guards the *shape* of the bug rather than the value: it was wrong in
 * three places at once, because two help strings restated the host instead of reading the
 * constant. A value fix alone leaves that failure mode intact.
 */
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Files whose text reaches users directly. */
const USER_FACING = ["index.ts", "commands/help.ts", "commands/login.ts"] as const;

describe("DEFAULT_BASE_URL", () => {
  it("is the platform's own https origin", () => {
    expect(DEFAULT_BASE_URL).toBe("https://www.synchain.ca");
  });

  it("carries no trailing slash", () => {
    // `joinUrl` trims one, but a trailing slash here would also be persisted into config.json
    // and echoed back in the login prompt's initial value.
    expect(DEFAULT_BASE_URL).not.toMatch(/\/$/);
  });

  it("is not a deployment hostname", () => {
    // Any *.vercel.app is a deploy target, not a published address; a preview URL here would be
    // even worse, since those expire.
    expect(DEFAULT_BASE_URL).not.toContain("vercel.app");
  });
});

describe("user-facing strings", () => {
  it.each(USER_FACING)("%s contains no host literal at all", (rel) => {
    const src = readFileSync(path.join(SRC, rel), "utf8");
    // Deliberately **not** a blacklist of the current and previous values. Blacklisting those
    // two would let the exact bug recur: change the default to `https://app.synchain.ca`, spell
    // it out in `help.ts` at the same time, and both `not.toContain`s stay green while the
    // duplication is right back. The property worth holding is "these files never state a host,
    // they read the constant" -- and all three satisfy it today, so it can be asserted directly
    // rather than approximated.
    const hits = src
      .split("\n")
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      .filter(({ line }) => /https?:\/\//.test(line));
    expect(
      hits,
      `${rel} states a URL literally; import it from a constant instead:\n` +
        hits.map((h) => `  :${h.no}  ${h.line.slice(0, 100)}`).join("\n")
    ).toEqual([]);
    // The other half of "they read the constant". `toContain("DEFAULT_BASE_URL")` alone would
    // NOT do it -- the import line satisfies that on its own, so deleting the hint while leaving
    // the import behind would still pass. Counting occurrences distinguishes "imported" from
    // "actually used": every one of these files imports it once and uses it at least once.
    const uses = src.split("DEFAULT_BASE_URL").length - 1;
    expect(uses, `${rel} imports DEFAULT_BASE_URL but never uses it`).toBeGreaterThan(1);
  });
});
