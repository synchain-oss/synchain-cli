// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";

import { runHelp } from "../commands/help.js";

/**
 * `synchain help [topic]`: the CLI's second self-description, next to `--help`.
 *
 * Unlike `--help`, this text is assembled by hand (commands/help.ts and the `*_HELP` blocks), so
 * nothing commander does keeps it in step with the real options. These cases pin it to the
 * contract: every link opens for an anonymous reader, every write command's usage line shows
 * `--dry-run`, and no read command's does.
 */

/**
 * A link here that 404s for a reader without repository access is worse than no link: the reader
 * concludes the docs are gone or the tool is abandoned. So hosts are allow-listed -- adding a new
 * one means registering it here, and answering "does it open for an anonymous visitor?".
 */
const ALLOWED_HOSTS = new Set(["www.synchain.ca", "www.npmjs.com"]);

/** Write commands by help topic (topic = command group). Mirrors contract.test.ts. */
const WRITE_USAGE: Array<[string, string]> = [
  ["files", "upload"],
  ["files", "mv"],
  ["files", "rename"],
  ["files", "rm"],
  ["folders", "mkdir"],
  ["folders", "rename"],
  ["folders", "rm"],
  ["calendar", "add"],
  ["calendar", "edit"],
  ["calendar", "rm"],
  ["discussion", "post"],
  ["discussion", "reply"],
  ["notifications", "read"],
];

/** Read commands in the same topics: their usage lines must not offer --dry-run. */
const READ_USAGE: Array<[string, string]> = [
  ["files", "ls"],
  ["files", "download"],
  ["folders", "ls"],
  ["calendar", "ls"],
  ["discussion", "ls"],
  ["discussion", "read"],
  ["notifications", "ls"],
];

function captureHelp(topic?: string): string {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    runHelp(topic);
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

/** The usage lines of `help <group>` that document `synchain <group> <sub>`. */
function usageLines(group: string, sub: string): string[] {
  return captureHelp(group)
    .split("\n")
    .filter((line) => line.trimStart().startsWith(`synchain ${group} ${sub} `));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("synchain help", () => {
  it("links only to publicly reachable hosts", () => {
    const urls = captureHelp().match(/https?:\/\/[^\s)]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const u = new URL(url);
      const ok =
        ALLOWED_HOSTS.has(u.host) ||
        (u.host === "github.com" && u.pathname.startsWith("/synchain-oss/synchain-cli/"));
      expect(ok, `${url}: host not on the allow-list`).toBe(true);
    }
  });

  it("the overview mentions --dry-run and lists the safety topic", () => {
    const overview = captureHelp();
    expect(overview).toContain("--dry-run");
    const topics = overview.split("\n").find((line) => line.startsWith("Topics:"));
    expect(topics).toContain("safety");
  });

  it.each(WRITE_USAGE)("`help %s` shows --dry-run on the `%s` usage line", (group, sub) => {
    const lines = usageLines(group, sub);
    expect(lines.length, `no usage line for ${group} ${sub}`).toBeGreaterThan(0);
    for (const line of lines) expect(line).toContain("[--dry-run]");
  });

  it.each(READ_USAGE)("`help %s` does not offer --dry-run on the `%s` usage line", (group, sub) => {
    const lines = usageLines(group, sub);
    expect(lines.length, `no usage line for ${group} ${sub}`).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain("--dry-run");
  });

  it("the rm commands' usage lines show their new --json", () => {
    for (const group of ["files", "folders", "calendar"]) {
      for (const line of usageLines(group, "rm")) expect(line).toContain("[--json]");
    }
  });
});

describe("synchain help safety", () => {
  it("lists every write command under its group", () => {
    const lines = captureHelp("safety").split("\n");
    for (const [group, sub] of WRITE_USAGE) {
      const row = lines.find((line) => new RegExp(`^\\s+${group}\\s`).test(line));
      expect(row, `no row for ${group}`).toBeDefined();
      expect(row).toMatch(new RegExp(`\\b${sub}\\b`));
    }
  });

  it("states the contract: no write, exit 0, the JSON shape, and what it cannot predict", () => {
    const text = captureHelp("safety");
    expect(text).toContain("exits 0");
    expect(text).toContain('"dryRun": true');
    expect(text).toContain("[dry-run] would");
    expect(text).toContain("folder_not_empty");
    // Not a remote write, so not a --dry-run command: saying so keeps the flag's promise narrow.
    expect(text).toContain("project use");
  });

  it("is case-insensitive like every other topic", () => {
    expect(captureHelp("Safety")).toBe(captureHelp("safety"));
  });
});
