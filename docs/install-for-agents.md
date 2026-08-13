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

## 2. Authenticate without prompts

Generate a key in the web app under **Settings → CLI Access**, then pass it via the
environment — never as an argv flag (argv leaks into shell history and `/proc`):

```bash
export SYNCHAIN_TOKEN=synch_live_sk_…
synchain login --base-url https://your-synchain.example
```

`login` validates the key against `GET /api/user/me` and persists it to the OS config dir
(`%APPDATA%\synchain\config.json` on Windows, `~/.config/synchain/config.json` mode
`0600` on POSIX). In ephemeral CI you can keep `SYNCHAIN_TOKEN` set and re-run `login`
each job.

Alternatively, the same key works directly against the HTTP API:

```
Authorization: Bearer synch_live_sk_…
```

## 3. Select a project

```bash
synchain project ls --json        # → { "projects": [ { "id", "name", "role" } ] }
synchain project use <id-or-prefix>
```

All later commands use the active project unless you pass `--project <id>`. Ids are
UUIDs; the 8-char prefix printed by `ls` is accepted and resolved for you.

## 4. Machine-readable output

Every read command supports `--json` and prints the raw API payload to **stdout**;
progress bars and errors go to **stderr**. Pipe stdout into `jq`:

```bash
synchain files ls --json | jq '.files[] | {id, name, size}'
synchain discussion ls --limit 20 --json | jq '.posts[] | {id, title, replyCount}'
synchain calendar ls --json | jq '.events[].id'
```

Response shapes:

| Command                | stdout JSON                                          |
| ---------------------- | ---------------------------------------------------- |
| `whoami --json`        | `{ user, projects, activeProject }`                  |
| `project ls --json`    | `{ projects: [{ id, name, role }] }`                 |
| `files ls --json`      | `{ files: [{ id, name, size, mimeType, folderId, … }] }` |
| `folders ls --json`    | `{ folders: [{ id, name, parentId, … }] }`           |
| `calendar ls --json`   | `{ events: [{ id, title, startTime, endTime, tag, … }], isAdmin }` |
| `discussion ls --json` | `{ posts: [{ id, title, authorName, replyCount, isAiGenerated, … }], total, limit, offset }` — root threads only, newest-first, paginated (`--limit`/`--offset`) |
| `members ls --json`    | `{ members: [{ userId, name, permission, creativeRole, roleTag, joinedAt }] }` |

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

Delete a file non-interactively:

```bash
synchain files rm <fileId> --yes
```

## 6. Scopes (why you might get 403)

A CLI key has **account scopes** (`files`, `calendar`, `discussion`, `members`)
set in Settings, and each project admin sets **project scopes**. The effective grant is
the **AND** of the two. When a scope is off you get:

- `403 scope_denied` — the account key lacks the scope, or
- `403 project_scope_denied` — the project disabled it.

Project **write** access (upload / post / create events) additionally requires
member-or-admin permission; a viewer is read-only.

## 7. `[AI]` attribution (important)

Every discussion **post** / **reply** made through a CLI key is flagged
`is_ai_generated = true` server-side and displayed with an **AI badge** in the web UI.
This is automatic and cannot be disabled — it keeps agent activity transparent to the
human team. `discussion ls` / `read` show an `[AI]` tag for these posts.

## 8. Exit codes

- `0` — success.
- `1` — any error (invalid/for­bidden key, `403` scope/permission, `404` not found,
  validation, network). A human-readable message is written to stderr; when the server
  returns JSON, its body is included.

## 9. Base URL & environment summary

| Variable / flag   | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `SYNCHAIN_TOKEN`  | CLI key for non-interactive `login` (never argv).   |
| `--base-url <url>`| Target deployment (default `https://synchain.vercel.app`); persisted after login. |
| `--project <id>`  | Override the active project for one command.         |
| `--json`          | Machine-readable stdout on read commands.            |
| `--yes`           | Skip the `files rm` confirmation.                    |
