// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportDryRun } from "../dry-run.js";
import { sanitizeInline, sanitizeBlock, shortId, safeNumber } from "../util/sanitize.js";

// Security-critical: these strip terminal-escape sequences from untrusted
// server strings before they are printed. A regex regression here silently
// reopens the ANSI/terminal-escape injection, so the escape-stripping
// behaviour is pinned by these tests.
describe("sanitizeInline", () => {
  it("strips CSI escapes (colors, cursor, erase)", () => {
    expect(sanitizeInline("\x1b[31mhello\x1b[0m")).toBe("hello");
    expect(sanitizeInline("\x1b[2Jcleared")).toBe("cleared");
    expect(sanitizeInline("a\x1b[1;2Hb")).toBe("ab");
  });

  it("strips OSC sequences (both BEL- and ST-terminated)", () => {
    // OSC 0 sets the window title — a classic injection vector.
    expect(sanitizeInline("\x1b]0;evil-title\x07text")).toBe("text");
    expect(sanitizeInline("\x1b]0;evil-title\x1b\\text")).toBe("text");
  });

  it("strips single-char C1-style escapes", () => {
    expect(sanitizeInline("\x1bMhi")).toBe("hi");
  });

  it("collapses stray control characters (incl. CR/LF/TAB) to spaces", () => {
    // Injected newlines/CR must not survive to forge rows or overwrite lines.
    expect(sanitizeInline("a\tb\nc\rd")).toBe("a b c d");
  });

  it("preserves normal text and text that merely looks like an escape", () => {
    expect(sanitizeInline("normal text 123")).toBe("normal text 123");
    // No leading ESC ⇒ nothing to strip.
    expect(sanitizeInline("[31mred")).toBe("[31mred");
  });

  it("handles empty and non-string inputs", () => {
    expect(sanitizeInline("")).toBe("");
    expect(sanitizeInline(null)).toBe("");
    expect(sanitizeInline(undefined)).toBe("");
    expect(sanitizeInline(42)).toBe("42");
  });

  it("neutralises a custom project ID carrying escapes (project use prints one)", () => {
    // `customId` is chosen by an admin of the project and is printed by `project use` and
    // by the `ref` column of `project ls`. A CR here would let one project's row overwrite
    // the line above it in the caller's terminal.
    expect(sanitizeInline("my-band\u001b[2K\rowned")).toBe("my-band owned");
    expect(sanitizeInline("\u001b]0;pwned\u0007neon-tide")).toBe("neon-tide");
  });
});

describe("shortId", () => {
  it("trims a server id to 8 characters by default", () => {
    expect(shortId("dddd4444-4444-4444-8444-444444444444")).toBe("dddd4444");
  });

  it("sanitizes before slicing, so the cut can never leave a bare ESC", () => {
    // The order is the whole point: slice first and the truncation itself becomes the
    // injection — the cut can land mid-sequence and emit a stray ESC.
    const out = shortId("\u001b[2Kdddd4444-4444-4444-8444-444444444444");
    expect(out).not.toContain("\u001b");
    expect(out).toBe("dddd4444");
  });

  it("honours an explicit length", () => {
    expect(shortId("dddd4444-4444", 4)).toBe("dddd");
  });

  it("handles non-string values without throwing", () => {
    // Nothing in the CLI verifies a server actually returned a string id before printing it.
    expect(shortId(null)).toBe("");
    expect(shortId(undefined)).toBe("");
  });
});

describe("safeNumber", () => {
  it("passes a real finite number through untouched", () => {
    expect(safeNumber(42)).toBe(42);
    expect(safeNumber(0)).toBe(0);
  });

  it("sanitizes a value that only claims to be a number", () => {
    // `apiFetch` is a bare `res.json() as T`: a field declared `total: number` can arrive as a
    // string carrying an escape. Counts look like the last place an escape could hide, which is
    // exactly why they get skipped.
    const out = safeNumber("10\u001b[2K\rpwned");
    expect(String(out)).not.toContain("\u001b");
    expect(String(out)).toContain("10");
  });

  it("treats NaN and Infinity as malformed rather than printing them", () => {
    expect(safeNumber(Number.NaN)).toBe("NaN");
    expect(safeNumber(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

describe("sanitizeBlock", () => {
  it("strips CSI and OSC escapes", () => {
    expect(sanitizeBlock("\x1b[31mhi\x1b[0m")).toBe("hi");
    expect(sanitizeBlock("\x1b]0;title\x07body")).toBe("body");
  });

  it("preserves TAB and LF but removes CR and other control chars", () => {
    expect(sanitizeBlock("line1\nline2\tcol")).toBe("line1\nline2\tcol");
    expect(sanitizeBlock("a\rb")).toBe("ab");
  });

  it("handles empty and non-string inputs", () => {
    expect(sanitizeBlock("")).toBe("");
    expect(sanitizeBlock(null)).toBe("");
  });
});

/**
 * `--dry-run` prints a summary that interpolates names, ids and counts off the wire. Rather than
 * trusting each of the fourteen call sites to sanitize what it interpolates, `reportDryRun`
 * sanitizes the finished summary once -- one funnel, so a fifteenth caller cannot forget.
 */
describe("reportDryRun (the --dry-run summary funnel)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureText(summary: string): string {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    reportDryRun({}, { action: "files.rm", target: {}, summary });
    return lines.join("\n");
  }

  it("strips CSI / OSC escapes and folds CR/LF from whatever the caller interpolated", () => {
    const out = captureText("would delete mix\x1b[2K\x1b]0;pwned\x07evil.wav\r\nX");
    expect(out).not.toContain("\x1b[2K");
    expect(out).not.toContain("\x1b]0;");
    expect(out).not.toContain("\r");
    // picocolors may still colour the `[dry-run]` tag itself: that escape is the CLI's own.
    // eslint-disable-next-line no-control-regex
    expect(out.replace(/\x1b\[[0-9;]*m/g, "")).toContain("would delete mixevil.wav  X");
  });

  it("strips a C1 CSI (U+009B), which an 8-bit xterm honours like ESC [", () => {
    expect(captureText("would delete a\u009b2Kb.wav")).not.toContain("\u009b");
  });
});
