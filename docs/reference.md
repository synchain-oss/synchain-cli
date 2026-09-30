# Synchain CLI

The `synchain` CLI manages Synchain project **files**, **calendar events**, and
**discussion**, and lists project **members** — all from your terminal. It is built for
both humans and AI agents and talks to the same authenticated API the web app uses, via a
per-user **CLI access key**.

- Source: [`src/`](../src) in this repo.
- Agent-focused quickstart: [install-for-agents.md](./install-for-agents.md).

---

## Install

Requires Node.js ≥ 20.

### From npm

```bash
npm install -g @synchain/cli        # global `synchain` binary
# or run without installing:
npx @synchain/cli --help
```

### From source (development)

The CLI is a self-contained package in this repository (its own `package.json` / `tsconfig`,
built with `tsc`). To run it straight from the repo:

```bash
git clone https://github.com/synchain-oss/synchain-cli && cd synchain-cli
npm install
npm run build
npm link          # exposes the `synchain` binary on your PATH
```

`npm link` symlinks the built `dist/index.js` as the global `synchain` command. To
update after pulling changes, re-run `npm run build`.

---

## Authenticate

1. In the web app, open **Settings → CLI Access** and **Generate** a key. Keys look
   like `synch_live_sk_<48 hex>` and are shown **once** — copy it immediately.
2. Log in:

   ```bash
   synchain login
   ```

   You are prompted for the **base URL** (default `https://www.synchain.ca`) and the
   **CLI key** (hidden input). The key is verified against `GET /api/user/me` and, on
   success, stored locally.

### Base URL

The CLI talks to `https://www.synchain.ca` by default, so you do not need `--base-url` to use
Synchain. Pass it to `login` only when you mean a **different deployment** — a test or
staging instance, or a mock server on your own machine:

```bash
synchain login --base-url http://127.0.0.1:8787    # e.g. a local mock server
```

`https://` is accepted for any host; plain `http://` only for `localhost`, `127.0.0.1` and
`::1`, so a key never crosses the network in cleartext. The value is saved in the config and
reused by later commands. (If you later log in to a different base URL, the remembered active
project is cleared so stale ids can't leak across hosts.)

### Non-interactive / CI / agents

Set `SYNCHAIN_TOKEN` in the environment to skip the hidden prompt:

```bash
SYNCHAIN_TOKEN=synch_live_sk_… synchain login --base-url https://www.synchain.ca
```

`--base-url` here is the default spelled out: `login` still asks for the base URL when it is
not given, and a script cannot answer that prompt. Run `synchain doctor` afterwards to confirm
a key was stored (see [`synchain doctor`](#synchain-doctor)).

`SYNCHAIN_TOKEN` is read by `synchain login` **only**; every other command uses the key that
`login` stored. The key is **never** accepted as a command-line flag — argv ends up in shell
history and `/proc/<pid>/cmdline`, which would leak the bearer.

### Where the key is stored

| OS       | Path                                              | Mode |
| -------- | ------------------------------------------------- | ---- |
| Windows  | `%APPDATA%\synchain\config.json`                  | —    |
| macOS/Linux | `~/.config/synchain/config.json` (or `$XDG_CONFIG_HOME/synchain`) | `0600` |

`synchain logout` deletes this file.

---

## Projects

Most commands act on an **active project**. Set it once:

```bash
synchain project ls                 # list projects you can access + your role
synchain project use 3f9a1c2b        # a full UUID or a unique 8-char prefix
synchain project use my-band         # or the project's custom ID
```

Or pass `--project <id>` per command.

Every project has a canonical UUID. **`project use` resolves what you type**; it accepts a
full UUID, a unique 8-character prefix, `synchain-<uuid>`, or the project's custom ID. An
ambiguous input always fails rather than picking a project for you, and the message says
what it matched — the specific projects when a custom ID collides with someone's UUID,
a count otherwise. What it stores is always the canonical UUID.

⚠️ **`--project <id>` does no resolving** — it passes the value straight to the API, which
accepts UUIDs only. Give it the full UUID (from `synchain project ls --json`, field
`projects[].id`); a prefix or a custom ID there gets a 400/404 from the server rather than
a CLI-side message.

A project may **also** have a short **custom ID** claimed on the web — a name you can say
out loud, such as `my-band`. `project use` accepts it, and the `ref` column of
`project ls` prints it when there is one (falling back to the 8-char UUID prefix
otherwise), so that column always pastes straight back into `project use`.

Three things worth knowing about custom IDs:

- **Hyphens do not count.** `my-band` and `myband` are the same ID — the spoken form is
  what matters, since you cannot hear a hyphen over the phone.
- **Matched exactly, never by prefix.** `my-b` does not resolve to `my-band`. Prefix
  matching stays a UUID-only affair.
- **The UUID remains the canonical id.** `project use` always writes the UUID into your
  config, custom IDs never reach an API path, and a custom ID that also happens to be a
  prefix of some project's UUID reports an ambiguity error naming both candidates rather
  than picking one.

---

## Commands

Help: `synchain help`, `synchain help <topic>`, `synchain <group> --help`, and
`synchain --help --format json` for the whole command tree as JSON
([Machine-readable help](#machine-readable-help)). Read commands, the `rm` commands and
every command that takes `--dry-run` accept `--json`; `--format json` does the same for any
command ([Global options](#global-options)). Every command that changes remote data accepts
`--dry-run` ([Dry runs](#dry-runs)).

### Auth

```bash
synchain login [--base-url <url>]
synchain logout [--yes]
synchain whoami [--json]
synchain doctor [--json]      # offline preflight, no request (see `synchain doctor` below)
```

### Files

```bash
synchain files ls [--folder <id>] [--project <p>] [--json]
synchain files upload <localPath> [--folder <id>] [--project <p>] [--json] [--dry-run]
synchain files download <fileId> [--out <path|->] [--project <p>]
synchain files mv <fileId> --to <folderId|root> [--project <p>] [--json] [--dry-run]
synchain files rename <fileId> <newName> [--project <p>] [--json] [--dry-run]
synchain files rm <fileId> [--yes] [--project <p>] [--json] [--dry-run]
```

- **upload** — two-step presigned-URL flow: the CLI requests an upload URL, PUTs the
  bytes to R2 with the detected MIME type (which must match the signed `Content-Type`),
  then registers the object as a file. Category size caps apply (audio 120 MB, video
  500 MB, archive 2 GB, other 100 MB). Without `--folder` the file lands in the project
  root.
- **download** — the endpoint returns a short-lived presigned URL (302); the CLI follows
  it and streams the bytes. `--out -` streams to stdout; otherwise it derives a safe file
  name (never a path).
- **mv `--to root`** — moves the file out of any folder.
- **rename** — the extension must stay the same (the server returns 422 otherwise).
- **rm** — asks for confirmation; pass `--yes` to skip (for scripts). `--dry-run` shows
  which file an id prefix resolved to, without asking and without deleting; with `--json`
  a real delete prints `{ "deleted": { "id", "name" } }`.

```bash
synchain files upload ./mix.wav
synchain files upload ./art.png --folder 8ab3
synchain files download 3f9a1c2b --out ./mix.wav
synchain files ls --json
```

### Folders

```bash
synchain folders ls [--project <p>] [--json]              # folder tree
synchain folders ls <folderId> [--project <p>] [--json]    # files inside a folder
synchain folders mkdir <name> [--parent <id>] [--project <p>] [--json] [--dry-run]
synchain folders rename <folderId> <newName> [--project <p>] [--json] [--dry-run]
synchain folders rm <folderId> [--project <p>] [--json] [--dry-run]   # 409 if not empty
```

`folders rm --json` prints `{ "deleted": { "id", "name" } }`. A dry run cannot predict the
`409 folder_not_empty`: only the real delete finds out whether the folder is empty.

### Calendar

```bash
synchain calendar add --title <t> --start <date> --end <date> \
                      [--desc <d>] [--tag <tag>] [--custom-tag <c>] [--json] [--dry-run]
synchain calendar ls [--from <date>] [--to <date>]         # default: next 30 days
synchain calendar edit <eventId> [--title] [--start] [--end] [--desc] [--tag] [--custom-tag] \
                      [--json] [--dry-run]
synchain calendar rm <eventId> [--json] [--dry-run]
```

- **Tags:** `meeting`, `mix`, `master`, `vocal`, `review`, `release`, `arrange`,
  `harmony`, `custom`. Use `--custom-tag "…"` together with `--tag custom`.
- **Dates:** ISO 8601 with a timezone (`2026-06-01T10:00:00Z`) or local
  `YYYY-MM-DD HH:mm` (parsed in your machine's timezone).
- Only the event **creator** or a **project admin** may edit or remove an event.
- `calendar rm --json` prints `{ "deleted": { "id" } }`. With a full UUID, `calendar rm
  --dry-run` echoes the id back without looking the event up; with a prefix it shows what
  the prefix resolved to.

```bash
synchain calendar add --title "Mix review" --start "2026-06-01 14:00" --end "2026-06-01 15:00" --tag review
```

### Discussion

```bash
synchain discussion ls [--limit <n>] [--offset <n>] [--project <p>] [--json]
synchain discussion read <postId> [--project <p>] [--json]
synchain discussion post --title <t> --content <c|-> [--category <c>] [--json] [--dry-run]
synchain discussion reply <postId> --content <c|-> [--json] [--dry-run]
```

- **Pagination:** `ls` lists **threads newest-first**, each with a server-computed reply
  count. `--limit <n>` sets the page size (default **50**, max **100**); `--offset <n>`
  skips ahead for the next page. A footer (`Showing X–Y of N threads …`) appears when more threads
  remain. `--json` returns `{ posts, total, limit, offset }`.
- **Categories:** `mix`, `master`, `art`, `release`, `vocal`, `general` (default
  `general`).
- `--content -` reads the body from **stdin** (handy for piping in a file).
- `read <postId>` accepts a thread root **or** a reply id and prints the whole thread
  (unaffected by pagination — it always resolves against the full thread).

```bash
synchain discussion ls --limit 20                # newest 20 threads
synchain discussion ls --limit 20 --offset 20    # next page
synchain discussion post --title "Mixdown v2" --content "Latest bounce attached." --category mix
cat notes.md | synchain discussion reply 7c1e --content -
```

### Members

```bash
synchain members ls [--project <p>] [--json]
```

- **Read-only.** Lists everyone in the project with their **permission** (`admin` /
  `member` / `viewer`), **creative role**, and **join date**, sorted admin → member →
  viewer then oldest first.
- The `role` column shows the project **creative role** (e.g. `Producer`) and falls back
  to the profile **role tag** when no creative role is set.
- Gated by the **`members`** scope, which is **off by default** — see [Scopes](#scopes).

```bash
synchain members ls --json | jq '.members[] | {name, permission}'
```

### Notifications (alias: `notif`)

```bash
synchain notifications ls [--all] [--limit <n>] [--json]
synchain notifications read <id> [--json] [--dry-run]
synchain notifications read --all [--json] [--dry-run]
```

These are **your** notifications across all projects — **user-level**, not tied to the
active project and **not** gated by the `files`/`calendar`/`discussion` scopes (any valid
key can read/clear its own notifications, like `whoami`).

- `ls` shows **unread only** by default (a leading `•` marks unread); `--all` includes
  already-read items, `--limit <n>` caps how many are fetched (default 30, max 100). It
  also prints the total unread count.
- Each line starts with the notification **id** — feed it to `read <id>` (an 8-char
  prefix works too).
- `read --all` marks every unread notification read and reports how many were cleared.

```bash
synchain notif ls --limit 10
synchain notifications read 3f9a1c2b
synchain notifications read --all
```

---

## Scopes

A CLI key carries **account-level scopes** you toggle in **Settings → CLI Access**:

| Scope        | Grants                                                     |
| ------------ | ---------------------------------------------------------- |
| `files`      | `files …` and `folders …` commands                         |
| `calendar`   | `calendar …` commands                                      |
| `discussion` | `discussion …` commands                                    |
| `members`    | `members ls` (read-only project roster)                    |

In addition, each **project admin** sets project-level CLI scopes under **Project
Settings → CLI Access**. The **effective** permission for a command is the **AND** of the
account scope and the project scope. If either is off, the API returns:

- `403 scope_denied` — your key's account scope is off, or
- `403 project_scope_denied` — the project disabled that scope.

(Read/write project membership still applies on top: a project **viewer** can read but
not upload/post/create events.)

---

## `[AI]` attribution

Every discussion **post** and **reply** created through a CLI key is stamped
`is_ai_generated = true` on the server. The web UI renders these as the “AI 助手”
identity with an **AI badge**, and the CLI mirrors it with an `[AI]` tag in
`discussion ls` and `discussion read`. This keeps automated/agent activity clearly
distinguishable from human posts.

---

## JSON output & scripting

Read commands accept `--json` (or the global `--format json`) and print the raw API payload
to **stdout**; progress and diagnostics go to **stderr**, so you can safely pipe stdout into
`jq`:

```bash
synchain files ls --json | jq '.files[] | {id, name, size}'
synchain project ls --json | jq -r '.projects[].id'
```

On failure a command exits with a categorised [exit code](#exit-codes) and describes the
error on stderr — as a single JSON line whenever stderr is not a terminal (see
[Errors](#errors)).

---

## Global options

`--format` belongs to the root command, so it works in any position:
`synchain --format json files ls` and `synchain files ls --format json` are the same call.
The other rows are per-command options that every script meets sooner or later.

| Option | Accepted by | Effect |
| --- | --- | --- |
| `--format json\|text` | every command (default `text`) | `json` turns on `--json` for every command that has it, switches errors to the [JSON envelope](#errors), and makes `--help` print the [command tree](#machine-readable-help). Any other value is a usage error (exit `2`). |
| `--json` | read commands, the three `rm` commands, every command that accepts `--dry-run`, `doctor` | Machine-readable stdout for that one command. Unchanged, so existing scripts keep working. |
| `--dry-run` | the 13 commands listed under [Dry runs](#dry-runs) | Rehearse the command; no write is sent. |
| `--base-url <url>` | `login` | Which deployment to talk to (default `https://www.synchain.ca`). Saved to the config, so every later command uses it. See [Base URL](#base-url). |
| `--project <id>` | project-scoped commands | The project for this one call — a full UUID only (see [Projects](#projects)). |
| `--yes` | `files rm`, `logout` | Skip the confirmation prompt. Scripts need it: with no terminal to answer, the prompt cancels the command. |

Environment variables:

| Variable | Effect |
| --- | --- |
| `SYNCHAIN_TOKEN` | The key for a non-interactive `synchain login`. Read by `login` only; every other command uses the stored key. |
| `SYNCHAIN_ERROR_FORMAT` | `json` or `text`: choose the error format instead of letting the terminal decide (see [Errors](#errors)). |
| `APPDATA` (Windows) / `XDG_CONFIG_HOME` (POSIX) | Where the config directory lives (see [Where the key is stored](#where-the-key-is-stored)). Point it at a temporary directory to keep a trial run away from your real login. |

---

## Machine-readable help

```bash
synchain --help --format json                          # the whole command tree, on stdout
synchain --help --format json | jq -r '.commands[].name'
```

In JSON mode `--help` on any subcommand prints the same whole tree, so one call is enough to
discover every command. Without `--format json`, `--help` prints the usual text.

Every node in the tree has these fields:

| Field | Meaning |
| --- | --- |
| `name` | Command name (`"synchain"` at the root). |
| `description` | One-line description. |
| `usage` | The usage string, positional arguments included (e.g. `[options] <fileId>`). |
| `options` | `[{ "flags": "--project <p>", "description": "…" }]`. `-h, --help` is left out, since every command has it. |
| `commands` | Child nodes (`[]` for a leaf command). |
| `aliases` | Present only when the command has one (`notifications` → `["notif"]`). |

The root also carries `version` (the installed CLI version), so an agent can check that a
feature it needs is there before calling it.

Help is recognised as an option, not by scanning the command line: an option **value** that
happens to be `-h` (e.g. `discussion post --title -h …`) is a value, and the command runs.

---

## Dry runs

Every command that changes remote data accepts `--dry-run`:

| Command | `action` |
| --- | --- |
| `files upload` | `files.upload` |
| `files mv` | `files.mv` |
| `files rename` | `files.rename` |
| `files rm` | `files.rm` |
| `folders mkdir` | `folders.mkdir` |
| `folders rename` | `folders.rename` |
| `folders rm` | `folders.rm` |
| `calendar add` | `calendar.add` |
| `calendar edit` | `calendar.edit` |
| `calendar rm` | `calendar.rm` |
| `discussion post` | `discussion.post` |
| `discussion reply` | `discussion.reply` |
| `notifications read` | `notifications.read` |

A dry run does everything the real command does up to the write — validates the arguments,
resolves id prefixes to the full record, builds the request — then prints what it would have
done and exits `0`. It never sends a write; the only requests it makes are the read-only
lookups the real run makes too. `files rm --dry-run` stops before the confirmation prompt, so
it needs no `--yes`.

This matters most for id prefixes: an 8-character prefix copied from the wrong place resolves
to a different record without any error. A dry run shows which record — id **and** name — the
command is about to touch.

Text output (stdout):

```text
[dry-run] would delete mix.wav (3f9a1c2b, 1.21 KB) from project 11111111-2222-4333-8444-555555555555.
Nothing was sent. Re-run without --dry-run to apply.
```

With `--json` or `--format json`:

```json
{
  "dryRun": true,
  "action": "files.rm",
  "target": {
    "project": "11111111-2222-4333-8444-555555555555",
    "file": {
      "id": "3f9a1c2b-7d4e-4a10-9c55-0e1f2a3b4c5d",
      "name": "mix.wav",
      "size": 1234,
      "folderId": null
    }
  }
}
```

`dryRun` is always `true`, and `action` is a stable `<group>.<command>` identifier (the
`notif` alias still reports `notifications.read`). `target` is what the command resolved —
the record, the destination, or the request body it would send — and its shape depends on
`action`, so read it per action.

What a dry run can and cannot tell you:

- `files upload --dry-run` asks the server for an upload URL (a read-only request that
  stores nothing), so scope, size caps and the destination folder are checked for real. No
  bytes are sent.
- `notifications read --all --dry-run` reads your notifications to report how many would be
  marked read.
- `calendar rm --dry-run` with a full UUID echoes the id without looking the event up (there
  is no single-event lookup); with a prefix it shows what the prefix resolved to.
- Rules the server applies only when the write arrives are not rehearsed: a non-empty folder
  still fails the real `folders rm` with `409 folder_not_empty`.

Server text in the text summary (file names, titles) has terminal escape sequences removed; in
JSON it appears as sent, JSON-escaped.

---

## Errors

In text mode a failing command prints a coloured message on stderr, exactly as before. In
**JSON mode** it prints **one line** of JSON on stderr instead, and nothing on stdout:

```json
{"error":{"code":"scope_denied","status":403,"url":"https://www.synchain.ca/api/projects/11111111-2222-4333-8444-555555555555/files","detail":"{\"error\":\"scope_denied\"}"}}
```

Which mode applies, first match wins:

1. `--json` or `--format json` on the command line → JSON.
2. `SYNCHAIN_ERROR_FORMAT=json` → JSON; `SYNCHAIN_ERROR_FORMAT=text` → text.
3. Otherwise JSON when **stderr is not a terminal** (a pipe, a file, a CI log, an agent
   harness), text when it is.

So scripts and agents get JSON without asking, and a person at a terminal still gets prose.
Set `SYNCHAIN_ERROR_FORMAT=text` to keep the old coloured output in logs.

All four fields are always present:

| Field | Type | Meaning |
| --- | --- | --- |
| `code` | string | What went wrong, as a `snake_case` identifier — see below. |
| `status` | number | The HTTP status, or `0` when there was no HTTP response (a usage error, a network failure, a check the CLI made itself). |
| `url` | string | The request URL, or `""` when no request was made. A presigned storage URL is reported without its query string, which carries the signature. |
| `detail` | string | The human-readable explanation — the text mode's message or the server's own. Terminal escape sequences are removed, and it is cut at 2000 characters (`… (truncated)`) so the envelope stays one parseable line. |

Where `code` comes from:

| `code` | When | Exit code |
| --- | --- | --- |
| The server's own code, e.g. `scope_denied`, `project_scope_denied`, `folder_not_empty` | The API returned an error body with a `snake_case` `error` field | By HTTP status ([Exit codes](#exit-codes)) |
| `http_<status>`, e.g. `http_401`, `http_502` | The API returned an error without a usable code (a gateway HTML page, a sentence) | By HTTP status |
| `unknown_command`, `unknown_option`, `invalid_argument`, `missing_argument`, `missing_mandatory_option_value`, `option_missing_argument` | The command line did not parse | `2` |
| `missing_option`, `invalid_option`, `invalid_name`, `invalid_time_range`, `nothing_to_update`, `unknown_topic` | The CLI rejected an argument before sending anything | `2` |
| `not_logged_in` | No key is stored | `3` |
| `client_error` | Anything else with no HTTP response: DNS or connection failure, timeout, a local file error, an id prefix that matches nothing or more than one record | `1` |

Treat the list as open: servers add codes, and a few CLI-side checks carry their own (for
example `not_a_file` from `files upload`). Branch on the **exit code** for the category, and on
`code` only for the reasons you handle specifically.

One other JSON line can appear on stderr. When `files upload` has stored the bytes but
registering the file fails, a warning names the orphaned storage key just before the error
envelope (a retry uploads again; the orphan is cleaned up server-side):

```json
{"warning":{"code":"orphaned_upload_key","storageKey":"<storage key>","detail":"the bytes were uploaded to storage (key: <storage key>) but registering the file record failed. …"}}
```

In JSON mode `files upload` prints no progress bar and no completion line on stderr; the
result is on stdout.

The package ships TypeScript declarations, and its entry point exports the error classes
behind these categories: `ApiError` and its subclasses `AuthError` (401), `ForbiddenError`
(403), `NotFoundError` (404), `ConflictError` (409), `ValidationError` (400, 422),
`RateLimitError` (429) and `ServerError` (5xx), plus the `ErrorEnvelope` type.

---

## Exit codes

| Exit code | Meaning |
| --- | --- |
| 0 | Success, including a completed `--dry-run`, `--help` and `--version` |
| 1 | Any other failure: network, a local check, an HTTP status not listed below |
| 2 | Usage: unknown command or option, missing argument, invalid value |
| 3 | Not authenticated: no stored key, or `401` |
| 4 | Forbidden: `403`, including `scope_denied` and `project_scope_denied` |
| 5 | Not found: `404` |
| 6 | Conflict or validation: `409`, `400`, `422` |
| 7 | Rate limited: `429` |
| 8 | Server error: `5xx` |

Scripts that only test "zero or not" keep working: every failure is still non-zero. Scripts
that compare against `1` need updating — 0.8.0 and earlier used `1` for every failure.
`synchain doctor` exits `1` when any of its checks fails.

---

## `synchain doctor`

An offline preflight. It reads the local config and environment and **makes no network
request**, so it is safe to run first in any agent or CI job:

```bash
synchain doctor           # one line per check
synchain doctor --json    # the same, as JSON
```

| Check `id` | `ok` when | Otherwise |
| --- | --- | --- |
| `node_version` | Node.js is 20 or newer | `fail` |
| `config_file` | The config file exists and is valid JSON | `warn` when it does not exist yet (run `synchain login`); `fail` when it cannot be read or parsed |
| `config_permissions` | Not listed: this check appears only on POSIX, and only when the file is open to group or other users | `warn` — run `chmod 600` on it |
| `credential` | A stored key has the `synch_live_sk_<48 hex>` shape. It is shown masked: first 8 and last 4 characters | `warn` on an unexpected shape, or when only `SYNCHAIN_TOKEN` is set (it is read by `login` alone — run `login` first); `fail` when there is no key at all |
| `base_url` | The stored base URL (or the default) passes the same safety check every request makes | `fail` |
| `active_project` | An active project is set and is a UUID | `warn` |

`ok` is `false` when any check is `fail`, and the command then exits `1`; warnings alone keep
`ok: true` and exit `0`. Whether the key is still **valid** is a question only the server can
answer: `synchain whoami` asks it.

```json
{
  "ok": true,
  "checks": [
    { "id": "node_version", "status": "ok", "detail": "Node v20.18.0" },
    { "id": "config_file", "status": "ok", "detail": "/home/me/.config/synchain/config.json" },
    { "id": "credential", "status": "ok", "detail": "stored key synch_li…9f3a" },
    { "id": "base_url", "status": "ok", "detail": "https://www.synchain.ca" },
    { "id": "active_project", "status": "ok", "detail": "set" }
  ]
}
```

---

## Troubleshooting

- **`Login failed: invalid CLI key.`** — the key is wrong or was revoked (regenerating a
  key revokes the previous one). Generate a fresh key in Settings.
- **`Login failed: /api/user/me not found.`** — the server deployment predates the
  CLI auth endpoints. Use a current Synchain deployment, or contact your server
  administrator.
- **`403 scope_denied` / `403 project_scope_denied`** — enable the scope in Settings
  (account) or ask a project admin to enable it (project).
- **`No project selected.`** — run `synchain project use <id>` or pass `--project <id>`.
- **Ambiguous prefix** — use more characters or the full UUID.
- **`"<x>" is ambiguous: it is the custom ID of project … and also a UUID prefix of …`** —
  one string means two different projects. Use the full UUID (from
  `synchain project ls --json`).
- **A JSON line on stderr instead of a coloured message** — stderr is not a terminal (a pipe,
  a file, CI), so errors come as the [JSON envelope](#errors). Set
  `SYNCHAIN_ERROR_FORMAT=text` to get the coloured message back.
- **A scripted `synchain login` stored nothing** — pass `--base-url https://www.synchain.ca`:
  without it `login` waits at the base-URL prompt, which a script cannot answer.
  `synchain doctor` shows whether a key is stored.

---

## Publishing (maintainers)

The package is `@synchain/cli` with `publishConfig.access = "public"` already set (a
scoped package publishes privately by default). To cut a release:

```bash
npm ci
npm run build
npm publish
```

Requirements & notes:

- You must own (or be a member of) the **`@synchain`** npm scope. If you don't, either
  create the org on npm or rename `name` in `package.json` to your own scope
  (e.g. `@your-org/synchain-cli`) before publishing.
- Bump `version` in `package.json` per release (`npm version patch|minor|major`).
- Licensed under the **MIT License** (see [`LICENSE`](../LICENSE)); `package.json` already declares `"license": "MIT"`.
- `files` ships `dist/` (JavaScript plus TypeScript declarations), `README.md` and `LICENSE`
  (npm adds `package.json` itself); run `npm pack --dry-run` first to preview the tarball.
