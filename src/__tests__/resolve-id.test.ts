// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  isUuid,
  projectRefLabel,
  resolveByPrefix,
  resolveProjectRef,
} from "../util/resolve-id.js";

// `discussion read` previously used find(startsWith) and would
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
  // commands short-circuit the project-wide fetch when the input is
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

/**
 * The custom-project-ID resolution lane.
 *
 * This group guards the feature's **first red line**: custom IDs and UUIDs are two
 * namespaces with entirely different semantics, and they must never land in one shared
 * `startsWith` candidate pool. Mixing them does not produce an error — it **silently
 * switches to the wrong project**, so every `files rm` / `discussion post` after that
 * `project use` lands in someone else's project.
 *
 * `cafe` and `dddd4444` in the fixture are deliberately the worst case: each is exactly
 * equal to one project's custom ID **and** a legal prefix of a different project's UUID.
 * The server does not allow claiming such strings today (any UUID prefix is either pure
 * hex, or hex runs with hyphens on UUID separator positions, and both shapes are
 * rejected), but the CLI **may not lean on that guarantee**: it is an independently
 * released npm package with no auto-publish, the version on a user's machine lags the
 * server indefinitely, and older rows may predate a tightening of the rules. So these
 * cases are written as if the server-side rule were not in force.
 */
const projects = [
  { id: "aaaa1111-1111-4111-8111-111111111111", name: "Alpha", customId: "cafe" },
  { id: "cafe0000-0000-4000-8000-000000000001", name: "Bravo", customId: "my-band" },
  { id: "cafe0000-0000-4000-8000-000000000002", name: "Charlie", customId: null },
  { id: "dddd4444-4444-4444-8444-444444444444", name: "Delta" },
  { id: "eeee5555-5555-4555-8555-555555555555", name: "Echo", customId: "beef" },
  // Foxtrot's custom ID happens to equal the 8 characters `project ls` prints for Delta —
  // two rows of one table showing an identical identifier. That is the reverse direction
  // of shadowing; see the case below.
  { id: "ffff6666-6666-4666-8666-666666666666", name: "Foxtrot", customId: "dddd4444" },
];
const allProjects = async () => projects;

describe("resolveProjectRef", () => {
  it("resolves a custom ID from its own candidate pool (`beef` is nothing in the UUID pool)", async () => {
    // This pins "two pools coexist": merged into one `startsWith(id)` pool, `beef` matches
    // no UUID at all and the answer would be `No project matches` — the custom-ID lane
    // would simply not exist.
    const r = await resolveProjectRef("beef", allProjects);
    expect(r.name).toBe("Echo");
  });

  it("reports ambiguity naming both sides when a custom ID shadows someone's UUID prefix", async () => {
    // `cafe` is exactly Alpha's custom ID and also a legal prefix of Bravo's and
    // Charlie's UUIDs. Picking either is guessing for the user, and the price of guessing
    // wrong is every later `files rm` hitting someone else's project.
    const err = await resolveProjectRef("cafe", allProjects).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/ambiguous/i);
    // The error must name both candidates, or the user cannot tell which full UUID to
    // retry with.
    expect((err as Error).message).toContain("aaaa1111-1111-4111-8111-111111111111");
    expect((err as Error).message).toContain("cafe0000-0000-4000-8000-000000000001");
  });

  it("blocks the reverse direction too: a UUID's 8-char label shadowed by a custom ID", async () => {
    // `project ls` prints exactly `dddd4444` for Delta (no custom ID), and that is also
    // Foxtrot's custom ID — a user copying that string off Delta's row hits Foxtrot first
    // via lane (1). Guarding only the "custom ID shadows a UUID prefix" direction is not
    // enough: both directions print the very same string.
    expect(projectRefLabel(projects[3]!)).toBe(projectRefLabel(projects[5]!));
    const err = await resolveProjectRef("dddd4444", allProjects).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/ambiguous/i);
    expect((err as Error).message).toContain("ffff6666-6666-4666-8666-666666666666");
    expect((err as Error).message).toContain("dddd4444-4444-4444-8444-444444444444");
  });

  it("applies the shadow gate on the spoken form too, so hyphens cannot buy a silent answer", async () => {
    // The gate must be at least as broad as the lane it guards. Lane (1) matches on the
    // spoken form, so it has already declared `ca-fe` and `cafe` to be one identifier — if
    // the gate only asked the literal question, `cafe` would report the collision while
    // `ca-fe` resolved silently to Golf. The user would be choosing between "warned" and
    // "silently landed elsewhere" by guessing where a hyphen goes.
    const hyphenated = [
      { id: "aaaa1111-1111-4111-8111-111111111111", name: "Golf", customId: "ca-fe" },
      { id: "cafe0000-0000-4000-8000-000000000001", name: "Hotel" },
    ];
    for (const input of ["cafe", "ca-fe"]) {
      const err = await resolveProjectRef(input, async () => hyphenated).catch((e: Error) => e);
      expect(err, `input ${input}`).toBeInstanceOf(Error);
      expect((err as Error).message, `input ${input}`).toMatch(/ambiguous/i);
      expect((err as Error).message).toContain("cafe0000-0000-4000-8000-000000000001");
    }
  });

  it("applies the shadow gate when the id's own hyphens are the ones in the way", async () => {
    // The mirror image of the case above, and the more dangerous half: here it is the *id*
    // that carries hyphens the input does not. Testing a stripped input against a raw id
    // misses it — `dddd44444444` is not a prefix of `dddd4444-4444-…` — so the hyphen-less
    // spelling would resolve silently while the hyphenated one reported the collision. The
    // spoken channel is exactly where hyphens get dropped, so the unprotected spelling is
    // the one people actually type. Both sides have to be folded.
    const hyphenatedId = [
      { id: "aaaa1111-1111-4111-8111-111111111111", name: "India", customId: "dddd4444-4444" },
      { id: "dddd4444-4444-4444-8444-444444444444", name: "Juliet" },
    ];
    for (const input of ["dddd4444-4444", "dddd44444444"]) {
      const err = await resolveProjectRef(input, async () => hyphenatedId).catch((e: Error) => e);
      expect(err, `input ${input}`).toBeInstanceOf(Error);
      expect((err as Error).message, `input ${input}`).toMatch(/ambiguous/i);
      expect((err as Error).message).toContain("dddd4444-4444-4444-8444-444444444444");
    }
  });

  it("folds case on both sides of the shadow gate, not just the input", async () => {
    // `projectRefLabel` prints an id verbatim, so an upper-case id gives a `ref` column the
    // user copies as-is. Lane (1) folds it and hits the custom-ID holder; a gate that folded
    // only hyphens would compare "CAFE0000...".startsWith("cafe0000") === false and return
    // that holder silently -- the "one table, two rows, same identifier" case walked past.
    const upperId = [
      { id: "aaaa1111-1111-4111-8111-111111111111", name: "Kilo", customId: "cafe0000" },
      { id: "CAFE0000-0000-4000-8000-000000000001", name: "Lima" },
      // A degenerate id whose spoken form is empty. It cannot shadow anything, and the gate
      // must treat it as "no match" rather than letting an empty key prefix-match everything.
      { id: "---", name: "Mike" },
    ];
    const err = await resolveProjectRef("cafe0000", async () => upperId).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/ambiguous/i);
  });

  it("does not widen the shadow gate for custom IDs that cannot prefix a UUID", async () => {
    // `my-band` folds to `myband`, which contains non-hex characters and so cannot be the
    // prefix of any UUID. Widening the gate must not turn ordinary custom IDs into
    // ambiguity errors.
    const r = await resolveProjectRef("my-band", allProjects);
    expect(r.name).toBe("Bravo");
  });

  it("matches on the spoken form: hyphen-less `myband` must hit `my-band`", async () => {
    // This is the entire reason the feature exists: someone reads "my band" to you over
    // the phone and you cannot hear whether they typed a hyphen. The server's unique index
    // is built on the hyphen-stripped key — claiming `my-band` also locks `myband`, and a
    // browser resolves either spelling to the same project.
    // Reproduced live on 2026-09-05: comparing `customId` byte-for-byte made one string
    // open in the browser while `synchain project use myband` said No project matches.
    const r = await resolveProjectRef("myband", allProjects);
    expect(r.id).toBe("cafe0000-0000-4000-8000-000000000001");
  });

  it("folds case and full-width forms alike (the NFKC + toLowerCase layer of refKey)", async () => {
    for (const input of ["MY-BAND", "MyBand", "ｍｙ－ｂａｎｄ"]) {
      const r = await resolveProjectRef(input, allProjects);
      expect(r.id, `input ${input}`).toBe("cafe0000-0000-4000-8000-000000000001");
    }
  });

  it("strips hyphens for custom IDs only — never polluting UUID prefix comparison", async () => {
    // UUIDs carry their own hyphens. If the UUID lane also used a hyphen-stripped key for
    // `startsWith`, **every hyphenated prefix would stop matching** (the hyphens are still
    // in the canonical id) and the whole prefix lane would silently die.
    // `dddd4444-4444` hits both points at once: stripped it is `dddd44444444`, which is not
    // Foxtrot's custom ID `dddd4444` (so lane (1) does not intercept it), while as a UUID
    // prefix it uniquely identifies Delta.
    const r = await resolveProjectRef("dddd4444-4444", allProjects);
    expect(r.name).toBe("Delta");
  });

  it("returns the canonical UUID on a custom-ID hit (that is what gets persisted)", async () => {
    // `project use` writes this id into config.json, and every later command interpolates
    // it into `/api/projects/<id>/…`. Returning the short ID the user typed would 400 the
    // entire API surface.
    const r = await resolveProjectRef("my-band", allProjects);
    expect(r.id).toBe("cafe0000-0000-4000-8000-000000000001");
    expect(isUuid(r.id)).toBe(true);
  });

  it("matches custom IDs **exactly**, never by prefix", async () => {
    // `my-b` is a prefix of `my-band`. The UUID lane allows prefixes because a UUID carries
    // 122 bits of entropy and a collision reports ambiguity; a custom ID is a short word a
    // human chose, and prefix matching would read "half a name typed" as "this project".
    await expect(resolveProjectRef("my-b", allProjects)).rejects.toThrow(/No project matches/);
  });

  it("treats custom IDs case-insensitively (the server stores them lowercase)", async () => {
    const r = await resolveProjectRef("My-Band", allProjects);
    expect(r.name).toBe("Bravo");
  });

  it("still lets an exact UUID beat any prefix", async () => {
    const r = await resolveProjectRef("dddd4444-4444-4444-8444-444444444444", allProjects);
    expect(r.name).toBe("Delta");
  });

  it("falls back to unique UUID prefix matching when no custom ID hits", async () => {
    const r = await resolveProjectRef("dddd", allProjects);
    expect(r.name).toBe("Delta");
  });

  it("keeps the UUID-prefix ambiguity message pointing at more characters / the full UUID", async () => {
    // It must stay distinguishable from the custom-ID ambiguity below: the actionable next
    // step differs between the two.
    await expect(resolveProjectRef("cafe0000", allProjects)).rejects.toThrow(
      /prefix .* is ambiguous/i
    );
  });

  it("uses a distinct message for custom-ID ambiguity (the source stays identifiable)", async () => {
    const dup = [
      { id: "aaaa1111-1111-4111-8111-111111111111", customId: "twin" },
      { id: "bbbb2222-2222-4222-8222-222222222222", customId: "twin" },
    ];
    await expect(resolveProjectRef("twin", async () => dup)).rejects.toThrow(
      /Custom ID "twin" is ambiguous/
    );
  });

  it("rejects empty / whitespace-only input instead of reporting a bogus empty prefix", async () => {
    // An empty string is a prefix of every id, so without the explicit guard the UUID lane
    // would answer `prefix "" is ambiguous (matches 6)` — true, and useless.
    // Whitespace-only input reports the same message: the guard runs on the trimmed string,
    // so both quote `""`.
    await expect(resolveProjectRef("", allProjects)).rejects.toThrow(/^No project matches ""\.$/);
    await expect(resolveProjectRef("   ", allProjects)).rejects.toThrow(
      /^No project matches ""\.$/
    );
  });

  it("keeps the wantedSlug guard load-bearing: an all-hyphen input folds to an empty key", async () => {
    // `---` is non-empty, so it survives the empty-input guard, but its slug key (hyphens
    // stripped) is "". Projects with no custom ID fold to an empty key too — so without the
    // `if (wantedSlug)` guard this input would "exactly match" Charlie *and* Delta and
    // report a custom-ID ambiguity. It must fall through to the UUID lane instead.
    await expect(resolveProjectRef("---", allProjects)).rejects.toThrow(
      /No project matches "---"/
    );
  });

  it("trims paste artifacts on both lanes alike", async () => {
    // Before the shared trim, `" my-band "` resolved (refKey trims while building its
    // comparison key) while `" <uuid> "` did not (the UUID lane compares raw bytes) — an
    // asymmetry with no justification when "paste it anywhere" is the point of the feature.
    const byCustom = await resolveProjectRef("  my-band \n", allProjects);
    expect(byCustom.name).toBe("Bravo");
    const byUuid = await resolveProjectRef("  dddd4444-4444-4444-8444-444444444444\n", allProjects);
    expect(byUuid.name).toBe("Delta");
    const byPrefix = await resolveProjectRef(" eeee5555 ", allProjects);
    expect(byPrefix.name).toBe("Echo");
  });

  it("ANSI-sanitizes the ids it interpolates into ambiguity errors", async () => {
    // A project id / custom ID is content an admin of that project controls, and these
    // messages reach stderr through formatApiError, which does no sanitizing of its own.
    const evil = [
      { id: "aaaa1111-1111-4111-8111-111111111111", customId: "cafe" },
      { id: "cafe0000-0000-4000-8000-00000000000\u001b[31m1" },
    ];
    const err = await resolveProjectRef("cafe", async () => evil).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/ambiguous/i);
    expect((err as Error).message).not.toContain("\u001b");
  });

  it("accepts the `synchain-<uuid>` shape the web Copy ID button yields", async () => {
    const r = await resolveProjectRef("synchain-dddd4444-4444-4444-8444-444444444444", allProjects);
    expect(r.name).toBe("Delta");
  });

  it("passes the input through untouched when the `synchain-` remainder is not a full UUID", async () => {
    // Same rule as the web side. Were `synchain-my-band` stripped down to `my-band` it
    // would hit Bravo — exactly the defect an unconditional prefix strip produces.
    await expect(resolveProjectRef("synchain-my-band", allProjects)).rejects.toThrow(
      /No project matches/
    );
  });

  it("NFKC-folds the custom-ID comparison key (full-width input resolves in a browser too)", async () => {
    // The comparison key folds only: trim → NFKC → toLowerCase. NFKC comes first precisely
    // so full-width input folds instead of missing. (Whether a string may be *claimed* —
    // ASCII-only, shape, reserved words — is the server's call, never this package's;
    // duplicating those rules here is what would let the two drift apart.) `ｍｙ－ｂａｎｄ`
    // pasted from a CJK IME resolves on the web; without folding here the CLI would answer
    // "no such project" — one string, two entry points, opposite answers.
    const r = await resolveProjectRef("ｍｙ－ｂａｎｄ", allProjects);
    expect(r.name).toBe("Bravo");
  });

  it("resolves an upper-case full UUID (isUuid accepts it; comparison is byte-wise on lowercase ids)", async () => {
    // The same upper-case UUID works via `--project` (the server's own check is
    // case-insensitive, and Postgres accepts upper-case literals). Without folding here you
    // would get "recognised as a UUID" immediately followed by "no such project".
    const r = await resolveProjectRef("AAAA1111-1111-4111-8111-111111111111", allProjects);
    expect(r.name).toBe("Alpha");
    const viaPrefix = await resolveProjectRef(
      "synchain-DDDD4444-4444-4444-8444-444444444444",
      allProjects
    );
    expect(viaPrefix.name).toBe("Delta");
  });

  it("never case-folds a **prefix**: it is still an unproven run of bytes", async () => {
    // Only a string proven by isUuid to be a full UUID gets lowercased. Folding a prefix
    // would change its meaning, and UUID prefix matching is byte-wise by definition.
    await expect(resolveProjectRef("DDDD4", allProjects)).rejects.toThrow(/No project matches/);
  });
});

describe("projectRefLabel", () => {
  // The column `project ls` prints must paste straight back into `project use`: printing
  // something you cannot feed back leads the user into a dead end.
  it("prints the custom ID when there is one, else the first 8 UUID characters", () => {
    expect(projectRefLabel(projects[0]!)).toBe("cafe");
    expect(projectRefLabel(projects[2]!)).toBe("cafe0000");
    expect(projectRefLabel(projects[3]!)).toBe("dddd4444");
  });

  it("treats an empty / whitespace-only customId as absent (older servers may send \"\")", () => {
    expect(projectRefLabel({ id: "dddd4444-4444-4444-8444-444444444444", customId: "" })).toBe(
      "dddd4444"
    );
    expect(projectRefLabel({ id: "dddd4444-4444-4444-8444-444444444444", customId: "  " })).toBe(
      "dddd4444"
    );
  });
});
