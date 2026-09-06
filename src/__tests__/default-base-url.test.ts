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
  it.each(USER_FACING)("%s states the default host by reading the constant", (rel) => {
    const src = readFileSync(path.join(SRC, rel), "utf8");
    // The bug this replaces: `help.ts` and `index.ts` each spelled the old host out, so changing
    // the constant left two copies behind telling users something else.
    expect(src).not.toContain("https://www.synchain.ca");
    expect(src).not.toContain("synchain.vercel.app");
  });
});
