#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { Command } from "commander";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import path from "node:path";

import { isFirstRun, markWelcomeSeen } from "./config.js";
import { printWelcomeBanner } from "./commands/welcome.js";
import { runLogin } from "./commands/login.js";
import { runLogout } from "./commands/logout.js";
import { runWhoami } from "./commands/whoami.js";
import { runProjectLs, runProjectUse } from "./commands/project.js";
import {
  runFilesDownload,
  runFilesLs,
  runFilesMv,
  runFilesRename,
  runFilesRm,
  runFilesUpload,
} from "./commands/files.js";
import {
  runFoldersLs,
  runFoldersMkdir,
  runFoldersRename,
  runFoldersRm,
} from "./commands/folders.js";
import {
  runCalendarAdd,
  runCalendarEdit,
  runCalendarLs,
  runCalendarRm,
} from "./commands/calendar.js";
import {
  runDiscussionLs,
  runDiscussionPost,
  runDiscussionRead,
  runDiscussionReply,
} from "./commands/discussion.js";
import { runNotificationsLs, runNotificationsRead } from "./commands/notifications.js";
import { runMembersLs } from "./commands/members.js";
import { runHelp } from "./commands/help.js";
import { DOCS_AGENTS, DOCS_README } from "./constants.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

function buildProgram(): Command {
  const program = new Command();

  program
    .name("synchain")
    .description("CLI for the Synchain platform")
    .version(pkg.version)
    .addHelpText(
      "after",
      "\nAI agents: install + usage guide at\n" +
        `  ${DOCS_AGENTS}\n` +
        "Humans: full reference at\n" +
        `  ${DOCS_README}\n`
    );

  // -- auth
  program
    .command("login")
    .description("Authenticate the CLI against a Synchain instance")
    .option("--base-url <url>", "Base URL (default https://synchain.vercel.app)")
    .action(async (opts) => {
      // The key is never accepted via argv (it would leak into shell history and
      // /proc/<pid>/cmdline). Use SYNCHAIN_TOKEN in CI, or the interactive prompt.
      await runLogin({ baseUrl: opts.baseUrl });
    });

  program
    .command("logout")
    .description("Clear stored credentials (local only; does not revoke the CLI key server-side)")
    .option("--yes", "Skip the confirmation prompt (required in non-TTY/CI environments)")
    .action(async (opts) => {
      await runLogout(opts);
    });

  program
    .command("whoami")
    .description("Print current user and project memberships")
    .option("--json", "Output JSON")
    .action(async (opts) => {
      await runWhoami({ json: Boolean(opts.json) });
    });

  // -- project
  const project = program.command("project").description("List or switch the active project");
  project
    .command("ls")
    .description("List accessible projects")
    .option("--json", "Output JSON")
    .action(async (opts) => {
      await runProjectLs({ json: Boolean(opts.json) });
    });
  project
    .command("use <id>")
    .description("Set the active project for subsequent commands")
    .action(async (id: string) => {
      await runProjectUse(id);
    });

  // -- files
  const files = program.command("files").description("Manage project files");
  files
    .command("ls")
    .description("List files in the active project (root or a folder)")
    .option("--folder <id>", "Folder id or 8-char prefix (root if omitted)")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (opts) => {
      await runFilesLs(opts);
    });
  files
    .command("upload <localPath>")
    .description("Upload a local file (defaults to project root)")
    .option("--folder <id>", "Destination folder id or 8-char prefix (root if omitted)")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (localPath: string, opts) => {
      await runFilesUpload(localPath, opts);
    });
  files
    .command("download <fileId>")
    .description("Download a file by id/prefix (use --out - to stream to stdout)")
    .option("--out <path>", "Output path, or `-` for stdout")
    .option("--project <p>", "Project id")
    .action(async (fileId: string, opts) => {
      await runFilesDownload(fileId, opts);
    });
  files
    .command("mv <fileId>")
    .description("Move a file to a folder (or `root`)")
    .requiredOption("--to <folderId|root>", "Destination folder id/prefix or `root`")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (fileId: string, opts) => {
      await runFilesMv(fileId, opts);
    });
  files
    .command("rm <fileId>")
    .description("Delete a file (confirms first; --yes to skip)")
    .option("--yes", "Skip the confirmation prompt")
    .option("--project <p>", "Project id")
    .action(async (fileId: string, opts) => {
      await runFilesRm(fileId, opts);
    });
  files
    .command("rename <fileId> <newName>")
    .description("Rename a file (extension must stay the same)")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (fileId: string, newName: string, opts) => {
      await runFilesRename(fileId, newName, opts);
    });

  // -- folders
  const folders = program.command("folders").description("Manage folders");
  folders
    .command("ls [folderId]")
    .description("List the folder tree, or files inside a specific folder")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (folderId: string | undefined, opts) => {
      await runFoldersLs(folderId, opts);
    });
  folders
    .command("mkdir <name>")
    .description("Create a folder")
    .option("--parent <id>", "Parent folder id or 8-char prefix (root if omitted)")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (name: string, opts) => {
      await runFoldersMkdir(name, opts);
    });
  folders
    .command("rm <folderId>")
    .description("Delete an empty folder (409 if not empty)")
    .option("--project <p>", "Project id")
    .action(async (folderId: string, opts) => {
      await runFoldersRm(folderId, opts);
    });
  folders
    .command("rename <folderId> <newName>")
    .description("Rename a folder")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (folderId: string, newName: string, opts) => {
      await runFoldersRename(folderId, newName, opts);
    });

  // -- calendar
  const calendar = program.command("calendar").description("Manage project calendar events");
  calendar
    .command("add")
    .description("Create a calendar event")
    .requiredOption("--title <t>", "Event title")
    .requiredOption("--start <date>", "ISO 8601 or local `YYYY-MM-DD HH:mm`")
    .requiredOption("--end <date>", "ISO 8601 or local `YYYY-MM-DD HH:mm`")
    .option("--desc <d>", "Event description")
    .option(
      "--tag <tag>",
      "meeting | mix | master | vocal | review | release | arrange | harmony | custom",
      "meeting"
    )
    .option("--custom-tag <c>", "Free-text label (required when --tag custom)")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (opts) => {
      await runCalendarAdd(opts);
    });
  calendar
    .command("ls")
    .description("List events in a date range (default: next 30 days)")
    .option("--from <date>", "Window start (ISO or local `YYYY-MM-DD HH:mm`)")
    .option("--to <date>", "Window end (ISO or local `YYYY-MM-DD HH:mm`)")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (opts) => {
      await runCalendarLs(opts);
    });
  calendar
    .command("edit <eventId>")
    .description("Edit an existing event (creator or admin only)")
    .option("--title <t>", "New title")
    .option("--start <date>", "New start (ISO or local)")
    .option("--end <date>", "New end (ISO or local)")
    .option("--desc <d>", "New description")
    .option("--tag <tag>", "New tag (see `calendar add`)")
    .option("--custom-tag <c>", "New free-text label (with --tag custom)")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (eventId: string, opts) => {
      await runCalendarEdit(eventId, opts);
    });
  calendar
    .command("rm <eventId>")
    .description("Delete a calendar event (creator or admin only)")
    .option("--project <p>", "Project id")
    .action(async (eventId: string, opts) => {
      await runCalendarRm(eventId, opts);
    });

  // -- discussion
  const discussion = program
    .command("discussion")
    .description("Browse + post to project discussion threads");
  discussion
    .command("ls")
    .description("List discussion threads (paginated: root threads + reply counts)")
    .option("--limit <n>", "Threads per page (default 50, max 100)")
    .option("--offset <n>", "Skip the first N threads")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (opts) => {
      await runDiscussionLs(opts);
    });
  discussion
    .command("read <postId>")
    .description("Print a thread (root or a reply id) as a tree")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (postId: string, opts) => {
      await runDiscussionRead(postId, opts);
    });
  discussion
    .command("post")
    .description("Start a new discussion thread")
    .requiredOption("--title <t>", "Thread title")
    .requiredOption("--content <c>", "Thread body (use `-` to read from stdin)")
    .option("--category <c>", "mix | master | art | release | vocal | general", "general")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (opts) => {
      await runDiscussionPost(opts);
    });
  discussion
    .command("reply <postId>")
    .description("Reply to an existing thread or post")
    .requiredOption("--content <c>", "Reply body (use `-` to read from stdin)")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (postId: string, opts) => {
      await runDiscussionReply(postId, opts);
    });

  // -- members (read-only project roster)
  const members = program.command("members").description("List project members (read-only)");
  members
    .command("ls")
    .description("List the members of the active project")
    .option("--project <p>", "Project id")
    .option("--json", "Output JSON")
    .action(async (opts) => {
      await runMembersLs(opts);
    });

  // -- notifications (your own; user-level, not project-scoped)
  const notifications = program
    .command("notifications")
    .alias("notif")
    .description("Your notifications (list / mark read)");
  notifications
    .command("ls")
    .description("List your notifications (unread only by default)")
    .option("--all", "Include already-read notifications")
    .option("--limit <n>", "Max items to fetch (default 30, max 100)")
    .option("--json", "Output JSON")
    .action(async (opts) => {
      await runNotificationsLs(opts);
    });
  notifications
    .command("read [id]")
    .description("Mark one notification read, or --all to clear them")
    .option("--all", "Mark all notifications read")
    .option("--json", "Output JSON")
    .action(async (id: string | undefined, opts) => {
      await runNotificationsRead(id, opts);
    });

  // -- help
  program
    .command("help [topic]")
    .description(
      "Rich help per topic (login, project, files, folders, calendar, discussion, members)"
    )
    .action((topic: string | undefined) => {
      runHelp(topic);
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  // First-run welcome banner —— 仅在【交互式且非 --json】时打印，且只在真正打印后才落 sentinel。
  // banner 走 stderr（见 welcome.ts），据 stderr 是否为终端判定：--json/管道/重定向时完全不打印、
  // 也不消费 first-run（让人类首次交互运行仍能看到 banner，同时绝不污染 stdout/--json）（(内部编号)）。
  const wantsJson = argv.includes("--json");
  if (isFirstRun() && process.stderr.isTTY === true && !wantsJson) {
    printWelcomeBanner();
    try {
      await markWelcomeSeen();
    } catch {
      // Non-fatal — worst case, the banner shows again next run.
    }
  }
  const program = buildProgram();
  await program.parseAsync(argv);
}

// Invoke only when run as a script (not when imported by tests). Resolve both
// sides to real, absolute paths before comparing — argv[1] can be relative or a
// symlink (e.g. under `npm link`), otherwise the CLI silently exits with code 0.
const invokedAsScript = (() => {
  try {
    if (!process.argv[1]) return false;
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const invokedPath = realpathSync(path.resolve(process.argv[1]));
    return modulePath === invokedPath;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export { buildProgram };
