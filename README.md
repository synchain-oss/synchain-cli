# Synchain CLI (`synchain`)

Manage Synchain project **files**, **calendar events**, **discussion**,
**members**, and **notifications** from your terminal — built for humans and AI agents alike.

## Install

```bash
npm install -g @synchain/cli        # global `synchain` binary
# or run without installing:
npx @synchain/cli --help
```

From source (development):

```bash
npm install && npm run build && npm link
```

Requires Node.js ≥ 20.

## Quickstart

Generate a CLI key in the web app under **Settings → CLI Access**, then:

```bash
synchain login                       # paste the key (or set SYNCHAIN_TOKEN)
synchain project ls                  # list projects, then:
synchain project use <id>            # set the active project
synchain files upload ./mix.wav      # upload a file
synchain notifications ls            # your unread notifications
```

## Commands

`login` · `logout` · `whoami` · `project ls|use` · `files ls|upload|download|mv|rename|rm` ·
`folders ls|mkdir|rename|rm` · `calendar add|ls|edit|rm` · `discussion ls|read|post|reply` ·
`members ls` · `notifications ls|read` (alias `notif`). Run `synchain help` or `synchain <group> --help`.

`discussion ls` is paginated (`--limit`, `--offset`; newest threads first). `members ls`
lists the project roster (read-only) and requires the `members` scope to be enabled.

## Notes

- The key is stored in the OS config dir (`%APPDATA%\synchain` / `~/.config/synchain`,
  mode `0600`) and is never accepted via an argv flag. Override the server with
  `--base-url` (default `https://synchain.vercel.app`; cleartext `http` is rejected for
  non-loopback hosts).
- Discussion posts made through a CLI key are stamped `is_ai_generated=true` and show an
  `[AI]` badge in the web UI.

Full guide: [`docs/reference.md`](https://github.com/synchain-oss/synchain-cli/blob/dev/docs/reference.md).
