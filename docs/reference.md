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

### From npm (once published)

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

   You are prompted for the **base URL** (default `https://synchain.vercel.app`) and the
   **CLI key** (hidden input). The key is verified against `GET /api/user/me` and, on
   success, stored locally.

### Base URL

Point the CLI at a specific deployment with `--base-url`:

```bash
synchain login --base-url https://your-synchain.example
```

The value is saved in the config and reused by later commands. (If you later log in to a
different base URL, the remembered active project is cleared so stale ids can't leak
across hosts.)

### Non-interactive / CI / agents

Set `SYNCHAIN_TOKEN` in the environment to skip the hidden prompt:

```bash
SYNCHAIN_TOKEN=synch_live_sk_… synchain login --base-url https://your-synchain.example
```

The key is **never** accepted as a command-line flag — argv ends up in shell history and
`/proc/<pid>/cmdline`, which would leak the bearer.

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
synchain project use 3f9a1c2b        # accept a full UUID or a unique 8-char prefix
```

Or pass `--project <id>` per command. Project ids are UUIDs; anywhere an id is expected
you may use the 8-character prefix the `ls` commands print (it is resolved to the full
UUID for you; ambiguous prefixes fail with a clear message).

---

## Commands

Global: `synchain help`, `synchain help <topic>`, `synchain <group> --help`, `--json` on
read commands for machine-readable output.

### Auth

```bash
synchain login [--base-url <url>]
synchain logout
synchain whoami [--json]
```

### Files

```bash
synchain files ls [--folder <id>] [--project <p>] [--json]
synchain files upload <localPath> [--folder <id>] [--project <p>] [--json]
synchain files download <fileId> [--out <path|->] [--project <p>]
synchain files mv <fileId> --to <folderId|root> [--project <p>] [--json]
synchain files rename <fileId> <newName> [--project <p>] [--json]
synchain files rm <fileId> [--yes] [--project <p>]
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
- **rm** — asks for confirmation; pass `--yes` to skip (for scripts).

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
synchain folders mkdir <name> [--parent <id>] [--project <p>]
synchain folders rename <folderId> <newName> [--project <p>]
synchain folders rm <folderId> [--project <p>]             # 409 if not empty
```

### Calendar

```bash
synchain calendar add --title <t> --start <date> --end <date> \
                      [--desc <d>] [--tag <tag>] [--custom-tag <c>]
synchain calendar ls [--from <date>] [--to <date>]         # default: next 30 days
synchain calendar edit <eventId> [--title] [--start] [--end] [--desc] [--tag] [--custom-tag]
synchain calendar rm <eventId>
```

- **Tags:** `meeting`, `mix`, `master`, `vocal`, `review`, `release`, `arrange`,
  `harmony`, `custom`. Use `--custom-tag "…"` together with `--tag custom`.
- **Dates:** ISO 8601 with a timezone (`2026-06-01T10:00:00Z`) or local
  `YYYY-MM-DD HH:mm` (parsed in your machine's timezone).
- Only the event **creator** or a **project admin** may edit or remove an event.

```bash
synchain calendar add --title "Mix review" --start "2026-06-01 14:00" --end "2026-06-01 15:00" --tag review
```

### Discussion

```bash
synchain discussion ls [--limit <n>] [--offset <n>] [--project <p>] [--json]
synchain discussion read <postId> [--project <p>] [--json]
synchain discussion post --title <t> --content <c|-> [--category <c>]
synchain discussion reply <postId> --content <c|->
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
synchain notifications read <id> [--json]
synchain notifications read --all [--json]
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

Read commands accept `--json` and print the raw API payload to **stdout**; progress and
diagnostics go to **stderr**, so you can safely pipe stdout into `jq`:

```bash
synchain files ls --json | jq '.files[] | {id, name, size}'
synchain project ls --json | jq -r '.projects[].id'
```

Commands exit non-zero on error (invalid key, forbidden, not found, validation, network)
and print a human-readable message to stderr.

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
- `files` ships only `dist/` + `README.md`; run `npm pack` first to preview the tarball.
