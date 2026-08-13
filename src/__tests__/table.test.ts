// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { renderTable } from "../util/table.js";

describe("renderTable", () => {
  it("renders header, separator, and rows", () => {
    const out = renderTable(
      [
        { header: "id", key: "id" },
        { header: "name", key: "name" },
      ],
      [
        { id: "a1", name: "Ann" },
        { id: "b22", name: "Bob" },
      ]
    );
    const lines = out.split("\n");
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("name");
    expect(lines[1]).toMatch(/^-+  -+$/);
    expect(lines[2]).toContain("a1");
    expect(lines[2]).toContain("Ann");
    expect(lines[3]).toContain("Bob");
  });

  it("truncates long cells with an ellipsis", () => {
    const out = renderTable([{ header: "h", key: "v", maxWidth: 5 }], [{ v: "123456789" }]);
    expect(out).toContain("1234…");
    expect(out).not.toContain("123456789");
  });

  it("handles maxWidth <= 1", () => {
    const out = renderTable([{ header: "h", key: "v", maxWidth: 1 }], [{ v: "abc" }]);
    expect(out).toContain("a");
    expect(out).not.toContain("abc");
  });

  it("renders null/undefined cells as empty and sanitizes ANSI", () => {
    const out = renderTable(
      [{ header: "h", key: "v" }],
      [{ v: null }, { v: "\x1b[31mred\x1b[0m" }]
    );
    expect(out).not.toContain("null");
    expect(out).toContain("red");
    expect(out).not.toContain("\x1b");
  });

  it("honors a column maxWidth override", () => {
    const out = renderTable([{ header: "h", key: "v", maxWidth: 3 }], [{ v: "abcdef" }]);
    expect(out).toContain("ab…");
  });
});
