# Synchain CLI for AI agents

This is the quickstart for driving Synchain from an autonomous agent or CI job. For the
full command reference, see [reference.md](./reference.md).

## 1. Install

```bash
npm install -g @synchain/cli
```

From source (development):

```bash
npm install && npm run build && npm link
```

`synchain` is now on the PATH. (Node.js ≥ 20 required.)

To learn the whole command surface in one call, ask for the command tree as JSON:

```bash
synchain --help --format json      # { name, version, description, usage, options, auth, environment, commands: [...] }
```

Every node carries `name`, `description`, `usage`, `options[{flags, description}]` and child
`commands`; the root adds the installed `version`, `auth` (how to get a key and log in —
`auth.login.nonInteractive` is the form for a run without a terminal, §2) and `environment`
(the variables the CLI reads, §10). See
[Machine-readable help](./reference.md#machine-readable-help).

## 2. Authenticate without prompts

Generate a key in the web app under **Settings → CLI Access**, then pass it via the
environment — never as an argv flag (argv leaks into shell history and `/proc`):

```bash
export SYNCHAIN_TOKEN=synch_live_sk_…
synchain login
synchain doctor --json             # offline: confirms a key is stored, masked, no request
```

When stdin is not a terminal — the normal case for an agent — `login` never prompts. The key
comes from `SYNCHAIN_TOKEN`; the base URL from `--base-url`, else the one already stored, else
the default `https://www.synchain.ca`. Without `SYNCHAIN_TOKEN` it sends nothing and exits `2`
with code `missing_argument`. If it reuses a stored base URL other than the default, it says so
on stdout before sending the key.

`SYNCHAIN_TOKEN` is read by `login` **only** — every other command uses the key `login` stored,
so setting the variable without running `login` does nothing (`doctor` warns about exactly
that).

The CLI states all of this itself: `synchain --help` prints it as its `Authentication:` block, and
`synchain --help --format json | jq .auth` returns it as data.

`login` validates the key against `GET /api/user/me` and persists it to the OS config dir
(`%APPDATA%\synchain\config.json` on Windows, `~/.config/synchain/config.json` mode
`0600` on POSIX). In ephemeral CI you can keep `SYNCHAIN_TOKEN` set and re-run `login`
each job.

`synchain doctor` never touches the network: it checks Node ≥ 20, that the config exists and
parses (and is `0600` on POSIX), that the stored key has the `synch_live_sk_<48 hex>` shape
(printed as first 8 + last 4 characters only), that the base URL passes the CLI's safety
check, and that an active project is set. `--json` prints `{ ok, checks: [{ id, status,
detail }] }`, and the exit code is `1` when any check has `status: "fail"`. Whether the key is
still valid is a server question — `synchain whoami` answers it.

Alternatively, the same key works directly against the HTTP API:

```
Authorization: Bearer synch_live_sk_…
```

## 3. Select a project

```bash
synchain project ls --json        # → { projects: [ { id, name, role, customId? } ] }
synchain project use <id-or-prefix-or-custom-id>
```

All later commands use the active project unless you pass `--project <id>`. The canonical
id is a UUID; the 8-char prefix printed by `ls` is accepted and resolved for you **by
`project use`**.

⚠️ **`--project <id>` does no resolving** — it goes straight to the API, which accepts
UUIDs only. Automation should pass the full `projects[].id`; a prefix or custom ID there
returns a server 400/404, not a CLI-side error.

A project may also carry a short **custom ID**. The `customId` field is `null` when the
project never set one, and is **absent entirely** when the server predates the feature —
`project ls --json` passes the API payload through verbatim, so treat the field as optional
and fall back to `id`.
`project use` accepts it, hyphens do not affect matching (`my-band` == `myband`), and it is
matched exactly — never by prefix. **Always keep `projects[].id` for automation**: the UUID is
canonical and stable, whereas a custom ID is optional and can be changed by a project
admin.

## 4. Machine-readable output

Every read command supports `--json` and prints the raw API payload to **stdout**;
progress bars and errors go to **stderr**. Pipe stdout into `jq`:

```bash
synchain files ls --json | jq '.files[] | {id, name, size}'
synchain discussion ls --limit 20 --json | jq '.posts[] | {id, title, replyCount}'
synchain calendar ls --json | jq '.events[].id'
```

`--format json` is the global spelling: it works in any position and on every command, turns
on `--json` wherever a command has it, and also makes errors and `--help` machine-readable.
Setting it once is the simplest way to drive the CLI from an agent:

```bash
synchain --format json files ls | jq '.files | length'
```

Response shapes (`?` marks a field older servers omit entirely):

| Command                | stdout JSON                                          |
| ---------------------- | ---------------------------------------------------- |
| `whoami --json`        | `{ user, projects: [{ …, customId? }], activeProject }` |
| `project ls --json`    | `{ projects: [{ id, name, role, customId? }] }`      |
| `files ls --json`      | `{ files: [{ id, name, size, mimeType, folderId, … }] }` |
| `folders ls --json`    | `{ folders: [{ id, name, parentId, … }] }`           |
| `calendar ls --json`   | `{ events: [{ id, title, startTime, endTime, tag, … }], isAdmin }` |
| `discussion ls --json` | `{ posts: [{ id, title, authorName, replyCount, isAiGenerated, … }], total, limit, offset }` — root threads only, newest-first, paginated (`--limit`/`--offset`) |
| `members ls --json`    | `{ members: [{ userId, name, permission, creativeRole, roleTag, joinedAt }] }` |
| `files rm --json`, `folders rm --json` | `{ deleted: { id, name } }` |
| `calendar rm --json`   | `{ deleted: { id } }`                                |
| any write with `--dry-run --json` | `{ dryRun: true, action, target }` — see [§6](#6-safe-trial-runs) |
| `doctor --json`        | `{ ok, checks: [{ id, status, detail }] }`           |

## 5. Common patterns

Upload a file to a folder and capture its id:

```bash
id=$(synchain files upload ./mix.wav --folder 8ab3 --json | jq -r '.file.id')
```

Post a discussion thread from a file on stdin:

```bash
cat report.md | synchain discussion post --title "Nightly mix report" --content - --category mix
```

Add a calendar event:

```bash
synchain calendar add --title "Master QA" \
  --start "2026-06-02T09:00:00Z" --end "2026-06-02T10:00:00Z" --tag master
```

Delete a file non-interactively — rehearse first, then delete:

```bash
synchain files rm <fileId> --dry-run --json   # which file does this id resolve to?
synchain files rm <fileId> --yes --json       # → { "deleted": { "id": "…", "name": "…" } }
```

`--yes` is required here: without a terminal nobody can answer the confirmation, so
`files rm` without it sends nothing, deletes nothing and fails with exit `2` and code
`confirmation_required`.

## 6. Safe trial runs

There is no sandbox mode and no test tenant: anything run without `--dry-run` against
`https://www.synchain.ca` changes real data. Two tools cover the gap.

**`--dry-run` on every write.** All 13 commands that change remote data accept it:
`files upload|mv|rename|rm`, `folders mkdir|rename|rm`, `calendar add|edit|rm`,
`discussion post|reply` and `notifications read` (see [Dry runs](./reference.md#dry-runs)).
A dry run validates the arguments, resolves id prefixes, prints what it would do and exits
`0` without sending the write; `files rm` does not even ask for confirmation. Use it whenever an id came
from a prefix or from another tool's output, because a wrong 8-character prefix resolves to a
different record without any error:

```bash
synchain files rm 3f9a1c2b --dry-run --json
```

```json
{
  "dryRun": true,
  "action": "files.rm",
  "target": {
    "project": "11111111-2222-4333-8444-555555555555",
    "file": { "id": "3f9a1c2b-7d4e-4a10-9c55-0e1f2a3b4c5d", "name": "mix.wav", "size": 1234, "folderId": null }
  }
}
```

Check that `target` names the record you meant, then run the same command without
`--dry-run`. A dry run that has to look something up makes the same read-only requests as the
real command, so it needs a valid key and the right scopes. It cannot predict rules the server
checks only when the write arrives (a non-empty folder still fails `folders rm` with `409`),
and a full UUID given to `calendar rm`, `discussion reply` or `notifications read` is echoed
back without a lookup — pass the prefix if you want to see what it resolves to.

**A loopback server for end-to-end tests.** To exercise a whole script without touching real
data, run a mock of the endpoints it calls on your own machine and log a throwaway config in
to it. Plain `http://` is accepted only for `localhost`, `127.0.0.1` and `::1`:

```bash
export XDG_CONFIG_HOME="$(mktemp -d)"   # POSIX; on Windows point APPDATA at a temp dir instead
SYNCHAIN_TOKEN=mock-token synchain login --base-url http://127.0.0.1:8787
synchain doctor --json                  # warns that mock-token is not a real key shape: expected
```

`login` calls `GET /api/user/me` on the mock, so that endpoint has to answer; §4 lists the
response shapes, and the request paths are in `src/commands/` of this repository. The key is
sent to whatever base URL you log in to, so never use a real one with a mock.

## 7. Scopes (why you might get 403)

A CLI key has **account scopes** (`files`, `calendar`, `discussion`, `members`)
set in Settings, and each project admin sets **project scopes**. The effective grant is
the **AND** of the two. When a scope is off you get:

- `403 scope_denied` — the account key lacks the scope, or
- `403 project_scope_denied` — the project disabled it.

Project **write** access (upload / post / create events) additionally requires
member-or-admin permission; a viewer is read-only.

## 8. `[AI]` attribution (important)

Every discussion **post** / **reply** made through a CLI key is flagged
`is_ai_generated = true` server-side and displayed with an **AI badge** in the web UI.
This is automatic and cannot be disabled — it keeps agent activity transparent to the
human team. `discussion ls` / `read` show an `[AI]` tag for these posts.

## 9. Exit codes and errors

| Exit code | Meaning | What to do |
| --- | --- | --- |
| `0` | Success, including a completed `--dry-run` | — |
| `1` | Other failure: no response (network), a local file error, a rejected storage upload, an uncategorised HTTP status, a failed `doctor` check | Read `error.detail`; retry a `network_error` |
| `2` | Usage: unknown command or option, missing argument, invalid value, no project selected, an ambiguous id prefix, a `files rm` without `--yes` (`confirmation_required`) | Fix the command line; `synchain --help --format json` lists what exists |
| `3` | Not authenticated: no stored key, or `401` | Run `synchain login`; retrying the same key will not help |
| `4` | Forbidden: `403`, including `scope_denied` and `project_scope_denied` | Enable the scope (§7); logging in again will not help |
| `5` | Not found: `404`, or an id prefix that matches nothing | List again to get a current id |
| `6` | Conflict or validation: `409`, `400`, `422` | Fix the input, or the state it conflicts with, then retry |
| `7` | Rate limited: `429` | Back off, then retry |
| `8` | Server error: `5xx` | Retry with exponential backoff |

Every failure is non-zero, so "zero or not" checks keep working; a script that compares
against `1` needs updating (0.8.0 and earlier used `1` for everything).

When stderr is not a terminal — the normal case for an agent — an error arrives as **one JSON
line on stderr**; stdout carries results only, never the error:

```json
{"error":{"code":"scope_denied","status":403,"url":"https://www.synchain.ca/api/projects/11111111-2222-4333-8444-555555555555/files","detail":"{\"error\":\"scope_denied\"}"}}
```

All four fields are always present. `code` is the server's `snake_case` error code when it
sent one, `http_<status>` when it did not, and a CLI code when there was no HTTP response —
for example `unknown_option`, `missing_mandatory_option_value`, `no_project_selected`,
`ambiguous_id`, `id_not_found`, `unauthenticated`, `network_error` or `client_error`; `status`
is `0` without an HTTP response. `--json` / `--format json` always select this format;
otherwise `SYNCHAIN_ERROR_FORMAT=json|text` decides, and without it a terminal gets text. In
this mode `files upload` / `files download` print no progress on stderr, and `files rename`
reports an extension change as a `{"warning":…}` line, so every stderr line parses. Full field
and code tables: [Errors](./reference.md#errors).

Rule of thumb: branch on the exit code, read `error.code` for the specific reason, and show
`error.detail` to a human.

## 10. Base URL & environment summary

| Variable / flag   | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `SYNCHAIN_TOKEN`  | CLI key for non-interactive `login` (never argv). Read by `login` only. |
| `SYNCHAIN_ERROR_FORMAT` | `json` / `text`: the error format, instead of letting the terminal decide. |
| `XDG_CONFIG_HOME` / `APPDATA` | Config directory: `$XDG_CONFIG_HOME/synchain` on POSIX (default `~/.config/synchain`), `%APPDATA%\synchain` on Windows. |
| `--base-url <url>`| `login` option: target deployment (default `https://www.synchain.ca`); persisted after login. |
| `--format json`   | The one global option — any command, any position: JSON stdout, JSON errors, JSON `--help`. |
| `--project <id>`  | Override the active project for one command (full UUID only). |
| `--json`          | Machine-readable stdout on every command except `login`, `logout`, `project use`, `files download` and `help`. |
| `--dry-run`       | Rehearse a write: resolve, validate, print, send no write, exit `0`. |
| `--yes`           | Skip the `files rm` / `logout` confirmation; `files rm` in a script needs it. |
