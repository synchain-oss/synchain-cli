import { describe, expect, it } from "vitest";
import { isUuid, resolveByPrefix } from "../util/resolve-id.js";

// (内部编号) (内部编号): `discussion read` previously used find(startsWith) and would
// silently pick the first prefix hit; it now shares resolveByPrefix with the other
// commands. Pin the three resolution branches so that behaviour can't regress.
const rows = [
  { id: "aaaa1111-1111-4111-8111-111111111111", name: "one" },
  { id: "aaaa2222-2222-4222-8222-222222222222", name: "two" },
  { id: "bbbb3333-3333-4333-8333-333333333333", name: "three" },
];
const all = async () => rows;

describe("resolveByPrefix", () => {
  it("returns the exact id match", async () => {
    const r = await resolveByPrefix(rows[1]!.id, all, "file");
    expect(r).toBe(rows[1]);
  });

  it("returns a unique prefix match", async () => {
    const r = await resolveByPrefix("bbbb", all, "file");
    expect(r).toBe(rows[2]);
  });

  it("throws on an ambiguous prefix (does not silently pick the first)", async () => {
    await expect(resolveByPrefix("aaaa", all, "file")).rejects.toThrow(/ambiguous/i);
  });

  it("throws on zero matches", async () => {
    await expect(resolveByPrefix("zzzz", all, "file")).rejects.toThrow(/No file matches/);
  });

  it("prefers an exact id over a prefix that also matches a longer id", async () => {
    // "abc" is both an exact id AND a prefix of "abcd": exact must win, not throw
    // ambiguous — this is the branch discussion reply/read rely on.
    const two = [{ id: "abc" }, { id: "abcd" }];
    const r = await resolveByPrefix("abc", async () => two, "post");
    expect(r.id).toBe("abc");
  });
});

describe("isUuid", () => {
  // (内部编号) item9: commands short-circuit the project-wide fetch when the input is
  // already a full UUID, so this predicate must accept canonical UUIDs and reject
  // the 8-char prefixes / partials the same commands also take.
  it("accepts a canonical 36-char UUID (any case)", () => {
    expect(isUuid("aaaa1111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("AAAA1111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("rejects an 8-char prefix and other non-UUID shapes", () => {
    expect(isUuid("aaaa1111")).toBe(false); // the prefix `ls` prints
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("aaaa1111-1111-4111-8111-111111111111x")).toBe(false); // trailing junk
    expect(isUuid("aaaa1111-1111-4111-8111")).toBe(false); // truncated
  });

  it("rejects a trailing newline (regex `$` matches before `\\n`; guard against it)", () => {
    // A stray "\n" must not short-circuit — it would be URL-encoded into the id
    // and 404. The length guard rejects it where a bare regex `$` would not.
    expect(isUuid("aaaa1111-1111-4111-8111-111111111111\n")).toBe(false);
    expect(isUuid("aaaa1111-1111-4111-8111-111111111111 ")).toBe(false); // trailing space
  });
});
