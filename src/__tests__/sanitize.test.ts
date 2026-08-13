import { describe, expect, it } from "vitest";
import { sanitizeInline, sanitizeBlock } from "../util/sanitize.js";

// Security-critical: these strip terminal-escape sequences from untrusted
// server strings before they are printed. A regex regression here silently
// reopens the ANSI/terminal-escape injection ((内部编号)), so the escape-stripping
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
