// SPDX-License-Identifier: MIT
/**
 * User-typed id input → one concrete record.
 *
 * ⚠ **The two namespaces must be resolved separately** (the core constraint the custom
 * project ID feature introduces). A project now has two references a human can write:
 * its canonical UUID (matchable by **prefix**) and the short custom ID claimed on the
 * web (matched **exactly**, never by prefix). They must never share one `startsWith`
 * candidate pool — otherwise a short custom ID that happens to be made of hex
 * characters would both "match project A's custom ID exactly" and "match project B's
 * UUID by prefix", and `project use` would silently switch to the wrong project.
 * Landing on the wrong object via prefix is the one class of mistake in this CLI that
 * **silently destroys someone else's work** (the `--dry-run` section of
 * `docs/install-for-agents.md` exists for it).
 *
 * ℹ️ The server already forbids that overlap wholesale: claiming a custom ID rejects
 * every string that could be a legal prefix of some UUID, so by design the two
 * namespaces are disjoint. **This file deliberately does not lean on that guarantee.**
 * The CLI ships as an independently released npm package with no auto-publish, so the
 * version on a user's machine lags the server indefinitely; the server rules may also
 * relax later, and rows written before a tightening are never re-validated. Keeping the
 * test local, with each lane on its own path, is the only form that does not depend on
 * two release cadences staying in step.
 *
 * ℹ️ Every server-derived string interpolated into an error below goes through
 * `sanitizeInline` first. These messages are printed straight to stderr by `formatApiError`,
 * which does no sanitizing of its own, and a project id or custom ID is content any admin of
 * that project controls — an unsanitized one is a terminal-escape injection vector.
 */

import { sanitizeInline } from "./sanitize.js";

/** Canonical 36-char UUID (the id shape Synchain stores for every record). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `synchain-` display prefix. When a project has **no** custom ID, the web "Copy ID"
 * button yields `synchain-<uuid>`, so pasting that back into the CLI has to work. Same
 * rule as that side: after stripping, the remainder is accepted **only** if it is a
 * complete UUID — a partial remainder is never treated as an alias and probed.
 */
const SYNCHAIN_PREFIX_RE = /^synchain-/i;

/**
 * True when `input` is already a full canonical UUID (not just an 8-char prefix).
 * Lets a command skip the project-wide fetch that prefix resolution needs and hit
 * the single-resource endpoint directly.
 *
 * The explicit 36-char length guard is load-bearing: regex `$` (no `m` flag) also
 * matches just before a trailing "\n", so `UUID_RE.test("<uuid>\n")` alone returns
 * true. A stray newline must NOT short-circuit — it would be URL-encoded into the
 * id and 404 — so a padded input falls through to normal prefix resolution instead.
 */
export function isUuid(input: string): boolean {
  return input.length === 36 && UUID_RE.test(input);
}

/**
 * Resolve a user-supplied id input (8-char prefix OR full UUID) to a full record
 * by fetching a list of candidates and matching.
 *
 * Resolution order:
 *   1. exact id match  → return that record
 *   2. unique prefix match (record.id.startsWith(input)) → return it
 *   3. zero matches → throw `No <label> matches "<input>".`
 *   4. multiple matches → throw `<label> prefix "<input>" is ambiguous (matches N).`
 *
 * ⚠ The candidate pool here is **UUIDs only**. A project's short custom ID goes through
 * the separate lane in {@link resolveProjectRef}; mixing a second namespace into this
 * `startsWith` pool is the red line described at the top of this file.
 */
export async function resolveByPrefix<T extends { id: string }>(
  input: string,
  fetchAll: () => Promise<T[]>,
  label: string
): Promise<T> {
  const all = await fetchAll();
  const exact = all.find((x) => x.id === input);
  if (exact) return exact;
  const matches = all.filter((x) => x.id.startsWith(input));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new Error(`No ${label} matches "${input}".`);
  }
  throw new Error(
    `${label} prefix "${input}" is ambiguous (matches ${matches.length}). Use more characters or the full UUID.`
  );
}

/**
 * A project row that can be resolved by custom ID. The shape mirrors `projects[]` in the
 * `/api/user/me` response.
 */
export interface ProjectRefRecord {
  id: string;
  /** The short custom ID claimed on the web. Older servers omit the key entirely. */
  customId?: string | null;
}

/**
 * Fold a possibly-absent custom ID into a comparable form; empty or whitespace-only
 * counts as absent.
 *
 * **Folds only, never validates**: `trim` → `NFKC` → `toLowerCase`. It deliberately
 * stops there — rejecting non-ASCII, checking the shape, screening reserved words all
 * answer "may this string be claimed?", which is the server's job alone. All this needs
 * is to move whatever the user typed onto the same plane the server actually stores, and
 * then compare for equality. Copying the claim rules into this package would only let
 * two independently released artifacts drift apart.
 *
 * NFKC is load-bearing, not decorative: the canonical string the server stores is itself
 * post-NFKC. `ｍｙ－ｂａｎｄ` typed on a CJK IME (full-width m, full-width hyphen) folds
 * to `my-band` and resolves fine in a browser; without folding here the same pasted
 * string would open on the web and report "no such project" in the terminal.
 * Say-it-out-loud, paste-it-anywhere is the entire point of the feature — two entry
 * points disagreeing about one string is not acceptable.
 */
function refKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim().normalize("NFKC").toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * The **spoken form** key of a custom ID: `refKey` with hyphens removed, matching the
 * server's own uniqueness key (its global unique index is built on the hyphen-stripped
 * form, so claiming `neon-tide` also locks `neontide`, and either spelling resolves to
 * the same project).
 *
 * **Why the hyphens must go**: the whole reason that rule exists is the spoken channel.
 * Someone reads "neon tide" to you over the phone and you cannot hear whether they typed
 * a hyphen. Comparing `customId` byte-for-byte makes the CLI answer the opposite of the
 * browser for one and the same string — the web page opens, while
 * `synchain project use neontide` says `No project matches`. Reproduced against a live
 * deployment on 2026-09-05; this function is the fix.
 *
 * Uniqueness is the server's guarantee, so at most one row in a given user's project
 * list can match.
 *
 * ⚠ **Only ever compare custom IDs with this — never UUIDs.** UUIDs carry their own
 * hyphens, and stripping them changes what `startsWith` means. The UUID lane keeps using
 * `refKey`.
 */
function slugKeyOf(value: string | null | undefined): string | null {
  const key = refKey(value)?.replace(/-/g, "");
  return key ? key : null;
}

/**
 * A project's short reference for **human-facing output**: its custom ID when it has one,
 * otherwise the first 8 characters of the UUID.
 *
 * Deliberately paired with {@link resolveProjectRef}: "copy the column `project ls`
 * printed into `project use`" is the most frequent interaction in this command group, so
 * every shape printed here must be one that side accepts.
 *
 * ⚠ The guarantee stops at "accepts" — it is **not** "always lands on this row". The
 * 8-char fallback is only a slice of a UUID, and prefixes can collide: two projects may
 * share their first 8 characters, or another project's custom ID may happen to equal
 * those 8 characters. Pasting it back then yields an **ambiguity error** (both candidates
 * are named and the full UUID is demanded), never a silent landing on someone else's
 * project. Stopping to ask is the only thing this pair promises; the full UUID is always
 * in `project ls --json` under `projects[].id`.
 */
export function projectRefLabel(p: ProjectRefRecord): string {
  const custom = p.customId?.trim();
  return custom && custom.length > 0 ? custom : p.id.slice(0, 8);
}

/**
 * Resolve user input to a project, with **custom IDs and UUIDs on separate lanes**.
 *
 * Priority (the order is load-bearing):
 *   1. **custom ID, exact** — compares `customId` only, never a prefix;
 *   2. strip a `synchain-` display prefix (the remainder must be a full UUID, otherwise
 *      the input passes through untouched);
 *   3. UUID, exact;
 *   4. UUID, unique prefix.
 *
 * Why an exact custom ID outranks a UUID prefix: **a whole identifier beats a partial
 * one** — the same principle as "exact id beats prefix" inside {@link resolveByPrefix}.
 * A full UUID and a full custom ID cannot fight over one input either: custom IDs cap at
 * 24 characters, UUIDs are always 36.
 *
 * ⚠ Priority settles **who is consulted first**, not **collisions**. The two namespaces
 * can shadow each other in both directions:
 *   - a custom ID hides someone else's UUID prefix (`cafe` is A's custom ID and also a
 *     prefix of B's UUID);
 *   - and the reverse — `project ls` prints exactly `B.id.slice(0, 8)` for a project with
 *     no custom ID, and that string may well equal A's custom ID, so **one table can
 *     print the same identifier on two rows**.
 * Neither direction may be waved through by ordering: picking either one is guessing on
 * the user's behalf, and the price of guessing wrong is every later `files rm` landing in
 * someone else's project. So after a custom-ID hit we **still** look at the UUID pool, and
 * a collision stops with an ambiguity error that names both sides.
 *
 * Why that gate never fires today: any legal prefix of a UUID is either pure hex, or hex
 * runs with hyphens sitting on UUID separator positions — and the server rejects both
 * shapes outright when a custom ID is claimed, so a **server-legal** custom ID cannot be a
 * prefix of any UUID. The gate exists for the premise stated at the top of this file: rows
 * written before the rules tightened, and user machines running behind the server.
 */
export async function resolveProjectRef<T extends ProjectRefRecord>(
  input: string,
  fetchAll: () => Promise<T[]>
): Promise<T> {
  const all = await fetchAll();

  // Trim **once**, up front, so both lanes are equally forgiving of paste artifacts. Before
  // this, `" my-band "` resolved (refKey trims as part of building its comparison key) while
  // `" <uuid> "` did not (the UUID lane compares raw bytes) — an asymmetry with no
  // justification, since "paste it anywhere" is the whole point of the feature and a UUID
  // copied out of a JSON blob routinely carries a trailing newline.
  //
  // This does not weaken `isUuid`'s length guard: that guard exists so a *padded* string is
  // never short-circuited into a single-resource URL, and trimming here means it is simply
  // never handed one.
  const raw = input.trim();
  if (!raw) {
    // Guarded explicitly rather than left to fall through: an empty string is a prefix of
    // every id, so the UUID lane would answer `prefix "" is ambiguous (matches N)`, which
    // tells the user nothing about what they actually did wrong.
    throw new Error(`No project matches "${sanitizeInline(input)}".`);
  }

  // (1) Custom-ID match — its own candidate pool, with no UUID mixed in. Compared on the
  // **spoken form** (hyphens stripped, the same key the server uses), not byte-for-byte:
  // `neontide` must hit `neon-tide`, or the CLI and the browser answer one string
  // differently.
  const wanted = refKey(raw); // UUID-lane key: hyphens kept
  // Still guarded: a non-empty input can fold to an empty slug key when it is all hyphens
  // (`---`). Without the guard such an input would "exactly match" every project that has
  // no custom ID at all.
  const wantedSlug = slugKeyOf(raw); // custom-ID-lane key: hyphens stripped
  if (wantedSlug) {
    const hits = all.filter((p) => slugKeyOf(p.customId) === wantedSlug);
    if (hits.length > 1) {
      // A custom ID points at exactly one project server-side, so this branch should be
      // unreachable; if it ever is reached we still stop and ask rather than pick the
      // first (the same stance as the ambiguity branch in `resolveByPrefix`). The wording
      // deliberately differs from the UUID one — the next action differs too, since there
      // are no "more characters" to add here.
      throw new Error(
        `Custom ID "${sanitizeInline(raw)}" is ambiguous (matches ${hits.length} projects). Use the full UUID instead.`
      );
    }
    if (hits.length === 1) {
      const hit = hits[0]!;
      // Cross-namespace shadow check (see above): after a hit we **must** look at the UUID
      // pool too. Compare using the folded `wanted`, not the raw input — canonical ids are
      // lowercase, so testing an upper-case input with `startsWith` would simply miss, and
      // missing is the very outcome this gate exists to prevent.
      // ⚠ This uses `wanted` (**hyphens kept**), not `wantedSlug`: UUIDs carry hyphens, so
      // a hyphen-stripped key would turn the gate into noise. `wanted` is necessarily
      // non-null whenever `wantedSlug` is (stripping only shortens); the guard is there for
      // the type narrowing.
      const shadowed = wanted ? all.filter((p) => p !== hit && p.id.startsWith(wanted)) : [];
      if (shadowed.length > 0) {
        throw new Error(
          `"${sanitizeInline(raw)}" is ambiguous: it is the custom ID of project ${sanitizeInline(
            hit.id
          )} and also a UUID prefix of ${shadowed
            .map((p) => sanitizeInline(p.id))
            .join(", ")}. Use the full UUID instead.`
        );
      }
      return hit;
    }
  }

  // (2) `synchain-<uuid>`: what the web "Copy ID" button yields for a project that has no
  // custom ID.
  const stripped = raw.replace(SYNCHAIN_PREFIX_RE, "");
  const bare = stripped !== raw && isUuid(stripped) ? stripped : raw;

  // (3)(4) Hand back to the UUID lane. **Only a string already proven to be a full UUID is
  // case-folded**: UUIDs are case-insensitive, but the comparisons below are byte-wise
  // `===` / `startsWith` against all-lowercase canonical ids — without folding, an
  // upper-case UUID would be "recognised as a UUID" and then "not found", while the same
  // string works via `--project`. Conversely, **a prefix is never folded**: it is just an
  // unproven run of bytes, and `toLowerCase` would change its meaning.
  const candidate = isUuid(bare) ? bare.toLowerCase() : bare;
  return resolveByPrefix(candidate, async () => all, "project");
}
