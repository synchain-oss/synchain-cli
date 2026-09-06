// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { folderLabel, renderTree } from "../commands/folders.js";

// `folders.ts` had zero sanitizing: `renderTree` builds its own lines instead of going through
// `renderTable`, so it never inherited `toCell`'s ANSI stripping, and the three success lines
// printed server-supplied names verbatim. Folder names are set by any member of the project, so
// this was the most reachable terminal-escape injection point in the tool — no hostile server and
// no `--base-url` required. These pin the sanitizing so it cannot be dropped again.
const ESC = "\u001b";
const BEL = "\u0007";

function folder(p: { id: string; name: string; parentId?: string | null }) {
  return {
    id: p.id,
    name: p.name,
    parentId: p.parentId ?? null,
    projectId: "aaaa1111-1111-4111-8111-111111111111",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
  };
}

describe("folderLabel", () => {
  it("renders name and short id", () => {
    expect(folderLabel({ id: "dddd4444-4444-4444-8444-444444444444", name: "Stems" })).toBe(
      "Stems (dddd4444)"
    );
  });

  it("strips ANSI escapes from the folder name", () => {
    // A CR after an erase-line lets a folder name overwrite the line printed above it.
    const out = folderLabel({
      id: "dddd4444-4444-4444-8444-444444444444",
      name: `Stems${ESC}[2K\rpwned`,
    });
    expect(out).not.toContain(ESC);
    expect(out).toBe("Stems pwned (dddd4444)");
  });

  it("strips OSC sequences (window-title spoofing) from the folder name", () => {
    const out = folderLabel({
      id: "dddd4444-4444-4444-8444-444444444444",
      name: `${ESC}]0;pwned${BEL}Stems`,
    });
    expect(out).not.toContain(ESC);
    expect(out).toBe("Stems (dddd4444)");
  });
});

describe("renderTree", () => {
  it("renders a nested tree with connectors and short ids", () => {
    const out = renderTree([
      folder({ id: "aaaa1111-1111-4111-8111-111111111111", name: "Mixes" }),
      folder({
        id: "bbbb2222-2222-4222-8222-222222222222",
        name: "Takes",
        parentId: "aaaa1111-1111-4111-8111-111111111111",
      }),
    ]);
    expect(out).toContain("Mixes");
    expect(out).toContain("Takes");
    expect(out).toContain("aaaa1111");
    expect(out).toContain("└──");
    // The full UUID is never printed — the tree shows the 8-char form.
    expect(out).not.toContain("aaaa1111-1111-4111-8111-111111111111");
  });

  it("strips ANSI escapes from folder names in the tree", () => {
    // The core of this fix. `folders ls` is a command people run constantly, and until now a
    // single renamed folder could drive the reader's terminal.
    const out = renderTree([
      folder({ id: "aaaa1111-1111-4111-8111-111111111111", name: `Mixes${ESC}[31m` }),
      folder({ id: "bbbb2222-2222-4222-8222-222222222222", name: `${ESC}[2K\rTakes` }),
    ]);
    expect(out).not.toContain(`${ESC}[31m`);
    expect(out).not.toContain(`${ESC}[2K`);
    expect(out).toContain("Mixes");
    expect(out).toContain("Takes");
  });

  it("collapses a newline in a folder name so one row cannot forge extra tree rows", () => {
    // `sanitizeInline` folds control characters to spaces, so an injected newline cannot fake a
    // sibling entry — the tree's line structure stays a property of the data, not of the name.
    const out = renderTree([
      folder({ id: "aaaa1111-1111-4111-8111-111111111111", name: "Mixes\n├── Fake" }),
    ]);
    const rows = out.split("\n").filter((l) => l.includes("├──") || l.includes("└──"));
    expect(rows).toHaveLength(1);
  });

  it("renders an orphan (unknown parent) at the root", () => {
    const out = renderTree([
      folder({ id: "cccc3333-3333-4333-8333-333333333333", name: "Orphan", parentId: "missing" }),
    ]);
    expect(out).toContain("Orphan");
    expect(out.split("\n")[0]).toBe("/");
  });
});
