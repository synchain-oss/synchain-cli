// SPDX-License-Identifier: MIT
import pc from "picocolors";
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
      "  SYNCHAIN_TOKEN=synch_live_sk_... synchain login --base-url <url>   # CI",
      "",
      "Interactive prompts: base URL (default https://synchain.vercel.app) and CLI key.",
      "The CLI verifies the key via GET /api/user/me and stores it in the OS config",
      "dir (chmod 0600 on POSIX).",
      "",
      "For unattended / CI use, set SYNCHAIN_TOKEN in the environment to skip the",
      "prompt. The key is never accepted via argv — it would leak into shell history",
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
      "  synchain files upload <localPath> [--folder <id>] [--project <p>]",
      "  synchain files download <fileId> [--out <path|->] [--project <p>]",
      "  synchain files mv <fileId> --to <folderId|root> [--project <p>]",
      "  synchain files rename <fileId> <newName> [--project <p>] [--json]",
      "  synchain files rm <fileId> [--yes] [--project <p>]",
      "",
      "`upload` uses the presigned-URL flow (the Content-Type is pinned to the",
      "detected MIME). Without --folder the file lands in the project root; --folder",
      "accepts the 8-char prefix `folders ls` prints or a full UUID. `download --out -`",
      "streams to stdout. `mv --to root` moves the file out of any folder. `rename`",
      "keeps the extension (a change returns 422). `rm` confirms first; pass --yes to",
      "skip the prompt.",
    ].join("\n"),
  },
  folders: {
    name: "folders",
    summary: "Browse, create, rename, and remove folders.",
    body: [
      "Usage:",
      "  synchain folders ls [--project <p>] [--json]",
      "  synchain folders ls <folderId> [--project <p>] [--json]",
      "  synchain folders mkdir <name> [--parent <id>] [--project <p>]",
      "  synchain folders rename <folderId> <newName> [--project <p>] [--json]",
      "  synchain folders rm <folderId> [--project <p>]",
      "",
      "`ls` with no argument prints the folder tree. `ls <folderId>` prints the files",
      "inside that folder. `rm` refuses non-empty folders with 409 folder_not_empty —",
      "clear the contents first.",
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
      "`use` accepts a full UUID or a unique 8-character prefix (the shape `ls`",
      "prints) and stores it so later commands can omit --project. Ambiguous prefixes",
      "fail clearly.",
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
      "  synchain notifications read <id> [--json]",
      "  synchain notifications read --all [--json]",
      "",
      "These are YOUR notifications (across all projects) — user-level, not tied to",
      "the active project or to the files/calendar/discussion CLI scopes. `ls` shows",
      "unread only by default (a `•` marks unread); pass --all to include read ones.",
      "Each line begins with the notification id to feed `read <id>` (an 8-char prefix",
      "works too). `read --all` clears every unread notification.",
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
  "  synchain help <topic>                      Detailed help for a topic",
  "",
  "Topics: login, project, files, folders, calendar, discussion, members, notifications",
  "",
  "Pass --help to any subcommand for its full flag list.",
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
    console.error(pc.red(`Unknown help topic: ${sanitizeInline(topic)}`));
    console.error(`Available topics: ${Object.keys(TOPICS).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${pc.bold(t.name)} — ${t.summary}`);
  console.log("");
  console.log(t.body);
}
