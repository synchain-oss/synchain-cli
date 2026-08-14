// SPDX-License-Identifier: MIT
/** Canonical 36-char UUID (the id shape Synchain stores for every record). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
