// SPDX-License-Identifier: MIT
import pc from "picocolors";
import { reportError, wantsStructuredOutput } from "../api.js";
import { DEFAULT_BASE_URL } from "../config.js";
import { nonInteractiveLoginLines } from "../help-auth.js";
import { sanitizeInline } from "../util/sanitize.js";
import { CALENDAR_HELP } from "./calendar.js";
import { DISCUSSION_HELP } from "./discussion.js";
import { MEMBERS_HELP } from "./members.js";
import { DOCS_AGENTS, DOCS_README } from "../constants.js";

interface Topic {
  name: string;
  summary: string;
  body: string;
}

const TOPICS: Record<string, Topic> = {
  login: {
    name: "login",
    summary: "Authenticate the CLI against a Synchain instance.",
    body: [
      "Usage:",
      "  synchain login",
      "  synchain login --base-url <url>",
      // The same lines as `--help` (src/help-auth.ts): one command, one key placeholder.
      ...nonInteractiveLoginLines("  ", ["CI / agents", "same, PowerShell"]),
      "",
      `Interactive prompts: base URL (default ${DEFAULT_BASE_URL}) and CLI key.`,
      "The CLI verifies the key via GET /api/user/me and stores it in the OS config",
      "dir (chmod 0600 on POSIX).",
      "",
      "For unattended / CI use, set SYNCHAIN_TOKEN in the environment to skip the",
      "key prompt; in CI, set it from a secret rather than typing the key into a",
      "shell. When stdin is not a terminal, login never prompts: the base URL is",
      "--base-url, else the stored one, else the default; without SYNCHAIN_TOKEN it",
      "exits 2. The key is never accepted via argv — it would leak into shell history",
      "and /proc/<pid>/cmdline.",
      "",
      "Generate a key under Settings → CLI Access in the web UI.",
    ].join("\n"),
  },
  files: {
    name: "files",
    summary: "List, upload, download, move, rename, and delete project files.",
    body: [
      "Usage:",
      "  synchain files ls [--folder <id>] [--project <p>] [--json]",
      "  synchain files upload <localPath> [--folder <id>] [--project <p>] [--json] [--dry-run]",
      "  synchain files download <fileId> [--out <path|->] [--project <p>]",
      "  synchain files mv <fileId> --to <folderId|root> [--project <p>] [--json] [--dry-run]",
      "  synchain files rename <fileId> <newName> [--project <p>] [--json] [--dry-run]",
      "  synchain files rm <fileId> [--yes] [--project <p>] [--json] [--dry-run]",
      "",
      "`upload` uses the presigned-URL flow (the Content-Type is pinned to the",
      "detected MIME). Without --folder the file lands in the project root; --folder",
      "accepts the 8-char prefix `folders ls` prints or a full UUID. `download --out -`",
      "streams to stdout. `mv --to root` moves the file out of any folder. `rename`",
      "keeps the extension (a change returns 422). `rm` confirms first; pass --yes to",
      "skip the prompt. Without a terminal there is nobody to ask, so `rm` without",
      "--yes deletes nothing and exits 2 (confirmation_required).",
      "",
      "`--dry-run` on upload/mv/rename/rm resolves the id prefixes and validates the",
      "request, prints the resolved target, sends no write, never prompts, and exits 0.",
      "Use it before deleting or moving anything from a script (`synchain help safety`).",
    ].join("\n"),
  },
  folders: {
    name: "folders",
    summary: "Browse, create, rename, and remove folders.",
    body: [
      "Usage:",
      "  synchain folders ls [--project <p>] [--json]",
      "  synchain folders ls <folderId> [--project <p>] [--json]",
      "  synchain folders mkdir <name> [--parent <id>] [--project <p>] [--json] [--dry-run]",
      "  synchain folders rename <folderId> <newName> [--project <p>] [--json] [--dry-run]",
      "  synchain folders rm <folderId> [--project <p>] [--json] [--dry-run]",
      "",
      "`ls` with no argument prints the folder tree. `ls <folderId>` prints the files",
      "inside that folder. `rm` refuses non-empty folders with 409 folder_not_empty —",
      "clear the contents first (a --dry-run cannot predict that 409: only the real",
      "DELETE finds out whether the folder is empty).",
    ].join("\n"),
  },
  project: {
    name: "project",
    summary: "List accessible projects and set the active one.",
    body: [
      "Usage:",
      "  synchain project ls [--json]",
      "  synchain project use <idOrPrefix>",
      "",
      "`use` accepts a full UUID, a unique 8-character UUID prefix, `synchain-<uuid>`,",
      "or the project's custom ID (the shape the `ref` column of `ls` prints). It stores",
      "the canonical UUID, so later commands can omit --project. Ambiguous input fails",
      "clearly instead of picking a project for you.",
    ].join("\n"),
  },
  calendar: CALENDAR_HELP,
  discussion: DISCUSSION_HELP,
  members: MEMBERS_HELP,
  notifications: {
    name: "notifications",
    summary: "List your notifications and mark them read (alias: notif).",
    body: [
      "Usage:",
      "  synchain notifications ls [--all] [--limit <n>] [--json]",
      "  synchain notifications read <id> [--json] [--dry-run]",
      "  synchain notifications read --all [--json] [--dry-run]",
      "",
      "These are YOUR notifications (across all projects) — user-level, not tied to",
      "the active project or to the files/calendar/discussion CLI scopes. `ls` shows",
      "unread only by default (a `•` marks unread); pass --all to include read ones.",
      "Each line begins with the notification id to feed `read <id>` (an 8-char prefix",
      "works too). `read --all` clears every unread notification; `read --all --dry-run`",
      "shows how many that would be.",
    ].join("\n"),
  },
  doctor: {
    name: "doctor",
    summary: "Check the local setup offline: Node, config file, stored key, base URL, project.",
    body: [
      "Usage:",
      "  synchain doctor [--json]",
      "",
      "Makes no request. It checks what can be settled before a round trip: Node >= 20,",
      "the config file exists and parses (and is chmod 600 on POSIX), the stored key",
      "looks like a CLI key (shown masked, first 8 + last 4), the base URL is one the CLI",
      "will send a key to, and an active project is set. Exit code 1 if any check fails.",
      "",
      "SYNCHAIN_TOKEN is read by `synchain login` only; every other command uses the",
      "stored key. `synchain whoami` asks the server whether that key is still valid.",
    ].join("\n"),
  },
  safety: {
    name: "safety",
    summary: "Preview any write with --dry-run before it runs.",
    body: [
      "Usage:",
      "  synchain <command> <args> --dry-run [--json]",
      "",
      "Every command that changes remote data takes --dry-run:",
      "  files          upload, mv, rename, rm",
      "  folders        mkdir, rename, rm",
      "  calendar       add, edit, rm",
      "  discussion     post, reply",
      "  notifications  read",
      "",
      "A dry run does everything the real run does up to the write: it validates the",
      "input, resolves 8-char id prefixes to full ids with read-only lookups, prints",
      "what would change, sends no write, and exits 0. `files rm --dry-run` never asks",
      "for confirmation. `files upload --dry-run` still requests the upload URL (a read",
      "that runs the server's scope and size checks); `notifications read --all",
      "--dry-run` reads the unread count.",
      "",
      "Output (stdout):",
      "  text  [dry-run] would delete mix.wav (3f9a1c2b, 12.0 MB) from project …",
      '  json  {"dryRun": true, "action": "files.rm", "target": {…}}',
      "",
      "What a dry run cannot see: a conflict only the write itself detects (`folders rm`",
      "on a non-empty folder still gets 409 folder_not_empty), and an id given as a full",
      "UUID to `calendar rm` or `discussion reply`, which is not looked up first.",
      "",
      "`project use`, `login` and `logout` change only local config and take no",
      "--dry-run.",
    ].join("\n"),
  },
};

const HEADER = [
  "synchain — CLI for the Synchain platform",
  "",
  "Common commands:",
  "  synchain login                             Authenticate with a CLI key",
  "  synchain logout                            Clear stored credentials",
  "  synchain whoami                            Print current user + project list",
  "  synchain project ls                        List accessible projects",
  "  synchain project use <id>                  Set the active project",
  "  synchain files ls|upload|download|mv|rename|rm  Manage project files",
  "  synchain folders ls|mkdir|rename|rm        Manage folders",
  "  synchain calendar add|ls|edit|rm           Manage calendar events",
  "  synchain discussion ls|read|post|reply     Read and post in discussions",
  "  synchain members ls                        List project members (read-only)",
  "  synchain notifications ls|read             Your notifications (alias: notif)",
  "  synchain doctor                            Check the local setup offline",
  "  synchain help <topic>                      Detailed help for a topic",
  "",
  "Topics: login, project, files, folders, calendar, discussion, members, notifications, doctor, safety",
  "",
  "Pass --help to any subcommand for its full flag list.",
  "Every command that changes remote data takes --dry-run: it resolves ids, validates,",
  "prints what would change, sends no write, and exits 0 (`synchain help safety`).",
  "",
  "AI agents: install + usage guide at",
  `  ${DOCS_AGENTS}`,
  "Humans: full reference at",
  `  ${DOCS_README}`,
].join("\n");

export function runHelp(topic: string | undefined): void {
  if (!topic) {
    console.log(HEADER);
    return;
  }
  const t = TOPICS[topic.toLowerCase()];
  if (!t) {
    // argv-sourced (self-inflicted, not cross-tenant), sanitized for the same reason the rest
    // of the CLI is: an unsanitized exception among sanitized neighbours is how the rule erodes.
    const unknown = `Unknown help topic: ${sanitizeInline(topic)}`;
    const available = `Available topics: ${Object.keys(TOPICS).join(", ")}`;
    if (wantsStructuredOutput()) {
      reportError(new Error(`${unknown}\n${available}`), { code: "unknown_topic" });
    } else {
      // Text mode prints what it always has: the complaint in red, the topic list plain.
      reportError(new Error(unknown), { code: "unknown_topic" });
      console.error(available);
    }
    return;
  }
  console.log(`${pc.bold(t.name)} — ${t.summary}`);
  console.log("");
  console.log(t.body);
}
