import { describe, expect, it } from "vitest";
import { renderMembersTable, type Member } from "../commands/members.js";

function member(p: Partial<Member> & { userId: string }): Member {
  return {
    name: "Alice",
    permission: "member",
    creativeRole: null,
    roleTag: null,
    joinedAt: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

describe("renderMembersTable", () => {
  it("renders id (8-char short), name, permission, and joined columns", () => {
    const out = renderMembersTable([
      member({
        userId: "abcdef1234567890",
        name: "Alice",
        permission: "admin",
        joinedAt: "2026-02-03T10:00:00.000Z",
      }),
    ]);
    expect(out).toContain("abcdef12"); // short id (first 8 chars)
    expect(out).not.toContain("abcdef1234567890"); // full uuid never printed
    expect(out).toContain("Alice");
    expect(out).toContain("admin");
    expect(out).toContain("2026-02-03T10:00:00.000Z");
    // Header row present.
    expect(out.split("\n")[0]).toContain("permission");
  });

  it("prefers creativeRole for the role column, then falls back to roleTag", () => {
    const withCreative = renderMembersTable([
      member({ userId: "u1", creativeRole: "Producer", roleTag: "singer" }),
    ]);
    expect(withCreative).toContain("Producer");
    expect(withCreative).not.toContain("singer");

    const withTagOnly = renderMembersTable([
      member({ userId: "u2", creativeRole: null, roleTag: "Vocalist" }),
    ]);
    expect(withTagOnly).toContain("Vocalist");
  });

  it("leaves the role column empty when neither creativeRole nor roleTag is set", () => {
    const out = renderMembersTable([member({ userId: "u3", creativeRole: null, roleTag: null })]);
    // No stray role text — only the header names appear on the first line.
    expect(out).toContain("role");
    expect(out).not.toContain("null");
  });

  it("renders one data row per member", () => {
    const out = renderMembersTable([
      member({ userId: "aaaaaaaa11111111", name: "Ann", permission: "admin" }),
      member({ userId: "bbbbbbbb22222222", name: "Bob", permission: "viewer" }),
    ]);
    // header + separator + 2 data rows.
    expect(out.split("\n")).toHaveLength(4);
    expect(out).toContain("Ann");
    expect(out).toContain("Bob");
    expect(out).toContain("viewer");
  });
});
