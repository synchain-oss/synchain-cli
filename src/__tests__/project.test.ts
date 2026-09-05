// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { projectUseMessage } from "../commands/project.js";
import { activeProjectLine } from "../commands/whoami.js";

// `src/commands` is outside the coverage `include`, and `commander.test.ts` mocks these
// modules wholesale — so the sanitizing in these two lines has no regression net unless it is
// pinned here. Both print strings that originate on the server and are controlled by any
// admin of the project.
const ESC = "\u001b";
const BEL = "\u0007";

describe("projectUseMessage", () => {
  it("prints the custom ID as the reference when the project has one", () => {
    expect(
      projectUseMessage({
        id: "cafe0000-0000-4000-8000-000000000001",
        name: "Neon Tide",
        customId: "neon-tide",
      })
    ).toBe("Active project set to Neon Tide (neon-tide).");
  });

  it("falls back to the 8-char UUID prefix when there is no custom ID", () => {
    expect(
      projectUseMessage({ id: "dddd4444-4444-4444-8444-444444444444", name: "Delta" })
    ).toBe("Active project set to Delta (dddd4444).");
  });

  it("strips ANSI escapes from the project name", () => {
    // A CR after an erase-line would let the project's name overwrite what the terminal
    // already printed above it.
    const out = projectUseMessage({
      id: "dddd4444-4444-4444-8444-444444444444",
      name: `Delta${ESC}[2K\rpwned`,
    });
    expect(out).not.toContain(ESC);
    expect(out).toBe("Active project set to Delta pwned (dddd4444).");
  });

  it("strips ANSI escapes from the custom ID", () => {
    // The custom ID reaches this line straight from `projectRefLabel`, which does no
    // sanitizing of its own — `project ls` is safe only because renderTable funnels through
    // `sanitizeInline`, and this command has no such funnel.
    const out = projectUseMessage({
      id: "cafe0000-0000-4000-8000-000000000001",
      name: "Bravo",
      customId: `neon${ESC}]0;pwned${BEL}-tide`,
    });
    expect(out).not.toContain(ESC);
    expect(out).toBe("Active project set to Bravo (neon-tide).");
  });
});

describe("activeProjectLine", () => {
  it("prints the stored name and the 8-char id", () => {
    const out = activeProjectLine({
      id: "cafe0000-0000-4000-8000-000000000001",
      name: "Neon Tide",
    });
    expect(out).toContain("Neon Tide");
    expect(out).toContain("(cafe0000)");
    expect(out).not.toContain("cafe0000-0000-4000-8000-000000000001");
  });

  it("falls back to the id when no name was stored", () => {
    const out = activeProjectLine({ id: "cafe0000-0000-4000-8000-000000000001" });
    expect(out).toContain("cafe0000");
  });

  it("strips ANSI escapes from the persisted name", () => {
    // This is the one place such a payload is *persisted* and replayed: `project use` wrote
    // the name into config.json, so without sanitizing here every later `synchain whoami`
    // re-emits the escape offline, with no request involved.
    const out = activeProjectLine({
      id: "cafe0000-0000-4000-8000-000000000001",
      name: `Neon${ESC}[31m Tide`,
    });
    expect(out).not.toContain(`${ESC}[31m`);
    expect(out).toContain("Neon Tide");
  });
});
