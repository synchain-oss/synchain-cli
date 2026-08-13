# Synchain CLI (`synchain`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**English** · [简体中文](#简体中文)

Manage Synchain project **files**, **calendar events**, **discussion**, **members** and
**notifications** from your terminal — built for humans and AI agents alike.

## Install

```bash
npm install -g @synchain/cli        # global `synchain` binary
# or run without installing:
npx @synchain/cli --help
```

Requires Node.js ≥ 20.

## Quick start

Generate a CLI key in the web app under **Settings → CLI Access**, then:

```bash
synchain login                       # paste the key (or set SYNCHAIN_TOKEN)
synchain project ls                  # list projects
synchain project use <id>            # set the active project
synchain files upload ./mix.wav      # upload a file
```

## Commands at a glance

| Group | Commands | Scope |
| --- | --- | --- |
| Auth | `login` · `logout` · `whoami` | — |
| Project | `project ls` · `project use <id>` | — |
| Files | `files ls` · `upload` · `download` · `mv` · `rename` · `rm` | `files` |
| Folders | `folders ls` · `mkdir` · `rename` · `rm` | `files` |
| Calendar | `calendar add` · `ls` · `edit` · `rm` | `calendar` |
| Discussion | `discussion ls` · `read` · `post` · `reply` | `discussion` |
| Members | `members ls` (read-only) | `members` |
| Notifications | `notifications ls` · `read` (alias `notif`) | — |
| Help | `help [topic]` | — |

Run `synchain help` or `synchain <group> --help` for options. Read commands accept `--json`.

## Documentation

- Full command reference: [docs/reference.md](./docs/reference.md)
- Agent / CI quickstart: [docs/install-for-agents.md](./docs/install-for-agents.md)

## Requirements & scope of this repo

**This repository is the CLI client only.** The Synchain platform (the server) is a
closed-source service hosted at `https://synchain.vercel.app`. You need a Synchain
account and a CLI key generated under **Settings → CLI Access** to use this tool — you
cannot self-host the server from this repo.

The key is stored in the OS config dir (`%APPDATA%\synchain` / `~/.config/synchain`,
mode `0600`) and is **never** accepted via an argv flag (use `SYNCHAIN_TOKEN` in CI, or
the interactive prompt). Discussion posts made through a CLI key are stamped
`is_ai_generated=true` and shown with an `[AI]` badge in the web UI.

## License

[MIT](./LICENSE) © 2026 Synchain

---

## 简体中文

# Synchain CLI (`synchain`)

从终端管理 Synchain 项目的**文件**、**日历事件**、**讨论**、**成员**与**通知** —— 同时面向人类与 AI agent。

## 安装

```bash
npm install -g @synchain/cli    # 或 npx @synchain/cli --help
```

需要 Node.js ≥ 20。

## 快速上手

在 Web 应用 **Settings → CLI Access** 生成 key 后:

```bash
synchain login && synchain project use <id> && synchain files upload ./mix.wav
```

## 命令总览

| 分组 | 命令 | scope |
| --- | --- | --- |
| 鉴权 | `login` · `logout` · `whoami` | — |
| 项目 | `project ls` · `project use <id>` | — |
| 文件 | `files ls` · `upload` · `download` · `mv` · `rename` · `rm` | `files` |
| 文件夹 | `folders ls` · `mkdir` · `rename` · `rm` | `files` |
| 日历 | `calendar add` · `ls` · `edit` · `rm` | `calendar` |
| 讨论 | `discussion ls` · `read` · `post` · `reply` | `discussion` |
| 成员 | `members ls`(只读) | `members` |
| 通知 | `notifications ls` · `read`(别名 `notif`) | — |
| 帮助 | `help [topic]` | — |

## 文档

[docs/reference.md](./docs/reference.md) · [docs/install-for-agents.md](./docs/install-for-agents.md)

## 需求与本仓库范围

本仓库只是 CLI 客户端;服务端是 `https://synchain.vercel.app` 上的闭源平台(需账号 + **Settings → CLI Access** 生成的 key,无法用本仓库自建)。key 存于 `%APPDATA%\synchain` / `~/.config/synchain`(mode `0600`),绝不走 argv;CLI key 发布的帖标记 `is_ai_generated=true` 并显示 `[AI]` 徽章。

## 许可证

[MIT](./LICENSE) © 2026 Synchain
