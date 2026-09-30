# Synchain CLI (`synchain`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**English** · [简体中文](#简体中文)

Command-line interface for Synchain — the all-in-one music and audio production collaboration
platform. Manage project **files**, **calendar events**, **discussion**, **members** and
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
| Doctor | `doctor` (offline preflight) | — |
| Help | `help [topic]` | — |

Run `synchain help` or `synchain <group> --help` for options. Read commands accept `--json`.

## For scripts and AI agents

- **`--format json`** anywhere on the command line: turns on `--json` for every command that
  has it, and makes errors and `--help` JSON too.
- **`synchain --help --format json`** prints the whole command tree as JSON — every command,
  option and argument in one call.
- **`--dry-run`** on every command that changes data: resolves ids, validates the input,
  prints what would change, sends no write, exits `0`.
- **Non-interactive login**: with `SYNCHAIN_TOKEN` set, `synchain login` never prompts when
  stdin is not a terminal; without it, it exits `2` instead of waiting for input.
- **Structured errors**: when stderr is not a terminal, or JSON output was requested, an error
  is one JSON line on stderr — `{"error":{"code","status","url","detail"}}`.
  `SYNCHAIN_ERROR_FORMAT=text|json` overrides the terminal check: set `text` to keep the
  coloured messages when you redirect stderr to a log you read yourself (`2>err.log`).
- **Exit codes by category**: `0` ok, `1` other, `2` usage, `3` not authenticated,
  `4` forbidden, `5` not found, `6` conflict / validation, `7` rate limited, `8` server error.
- **`synchain doctor`**: an offline check of Node, config, key shape and base URL — no network
  request.
- **TypeScript types**: the package ships declarations and exports its error classes
  (`ApiError`, `AuthError`, `ForbiddenError`, `NotFoundError`, …).

Details: [docs/install-for-agents.md](./docs/install-for-agents.md).

## Documentation

- Full command reference: [docs/reference.md](./docs/reference.md)
- Agent / CI quickstart: [docs/install-for-agents.md](./docs/install-for-agents.md)

## Requirements & scope of this repo

**This repository is the CLI client only.** The Synchain platform (the server) is a
closed-source service hosted at `https://www.synchain.ca`. You need a Synchain
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

Synchain 的命令行工具 —— Synchain 是一站式音乐与音频制作协作平台。从终端管理项目的**文件**、**日历事件**、**讨论**、**成员**与**通知** —— 同时面向人类与 AI agent。

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
| 自检 | `doctor`(离线预检) | — |
| 帮助 | `help [topic]` | — |

## 面向脚本与 AI agent

- **`--format json`**:可放在命令行任意位置;对所有带 `--json` 的命令等同打开 `--json`,错误与 `--help` 也随之输出 JSON。
- **`synchain --help --format json`**:把整棵命令树输出为 JSON —— 一次调用拿到全部命令、选项与参数。
- **`--dry-run`**:所有会改动数据的命令都支持;解析 id、校验输入、打印将要做的改动,不发送任何写请求,退出码 `0`。
- **非交互登录**:stdin 不是终端时,设置了 `SYNCHAIN_TOKEN` 的 `synchain login` 不会弹任何提示;没设置则以退出码 `2` 结束,而不是等待输入。
- **结构化错误**:stderr 不是终端、或要求了 JSON 输出时,错误是 stderr 上的一行 JSON —— `{"error":{"code","status","url","detail"}}`;`SYNCHAIN_ERROR_FORMAT=text|json` 可覆盖终端判断:把 stderr 重定向到自己要看的日志(`2>err.log`)时,设为 `text` 可保留原来的彩色文字。
- **按类别区分的退出码**:`0` 成功、`1` 其它、`2` 用法错误、`3` 未认证、`4` 无权限、`5` 不存在、`6` 冲突 / 校验失败、`7` 限流、`8` 服务端错误。
- **`synchain doctor`**:离线检查 Node、配置、key 形态与 base URL,不发任何网络请求。
- **TypeScript 类型**:包内附带类型声明,并导出错误类(`ApiError`、`AuthError`、`ForbiddenError`、`NotFoundError` 等)。

详见 [docs/install-for-agents.md](./docs/install-for-agents.md)。

## 文档

[docs/reference.md](./docs/reference.md) · [docs/install-for-agents.md](./docs/install-for-agents.md)

## 需求与本仓库范围

本仓库只是 CLI 客户端;服务端是 `https://www.synchain.ca` 上的闭源平台(需账号 + **Settings → CLI Access** 生成的 key,无法用本仓库自建)。key 存于 `%APPDATA%\synchain` / `~/.config/synchain`(mode `0600`),绝不走 argv;CLI key 发布的帖标记 `is_ai_generated=true` 并显示 `[AI]` 徽章。

## 许可证

[MIT](./LICENSE) © 2026 Synchain
