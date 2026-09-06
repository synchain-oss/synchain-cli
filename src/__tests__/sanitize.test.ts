// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { sanitizeInline, sanitizeBlock, shortId } from "../util/sanitize.js";

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
