// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { extensionWarning, safeDownloadName } from "../commands/files.js";

describe("safeDownloadName", () => {
  it("uses the Content-Disposition filename when present", () => {
    expect(safeDownloadName('attachment; filename="mix.wav"', "db.wav", "id1")).toBe("mix.wav");
  });

  it("strips path traversal from the Content-Disposition filename", () => {
    expect(
      safeDownloadName('attachment; filename="../../../.ssh/authorized_keys"', "db.wav", "id1")
    ).toBe("authorized_keys");
  });

  it("basenames the fallback DB filename when there is no Content-Disposition", () => {
    // A malicious/MITM server can control the stored `name`.
    expect(safeDownloadName(null, "../../../../home/user/.bashrc", "id1")).toBe(".bashrc");
    expect(safeDownloadName("", "/etc/passwd", "id1")).toBe("passwd");
  });

  it("falls back to <fileId>.bin when nothing usable remains", () => {
    expect(safeDownloadName(null, "", "abc123")).toBe("abc123.bin");
    expect(safeDownloadName('filename=".."', "..", "abc123")).toBe("abc123.bin");
  });

  it("never returns a value containing a path separator", () => {
    const out = safeDownloadName('filename="a/b/c.txt"', "../x/y.txt", "id1");
    expect(out.includes("/")).toBe(false);
    expect(out.includes("\\")).toBe(false);
  });
});

describe("extensionWarning", () => {
  it("returns null when the extensions agree", () => {
    expect(extensionWarning("mix.wav", "master.wav")).toBeNull();
    expect(extensionWarning("notes", "readme")).toBeNull();
  });

  it("names both extensions when they differ", () => {
    expect(extensionWarning("mix.wav", "mix.mp3")).toContain(".wav");
    expect(extensionWarning("mix.wav", "mix.mp3")).toContain(".mp3");
  });

  it("handles a new name with no extension", () => {
    expect(extensionWarning("mix.wav", "mix")).toContain("(none)");
  });

  it("reports the reverse case without claiming an old extension", () => {
    const out = extensionWarning("mix", "mix.wav");
    expect(out).toContain("no extension");
  });

  it("strips ANSI escapes carried in the server-supplied old name", () => {
    // `oldName` is whatever a project member named the file. This warning goes out through
    // `process.stderr.write`, not `console.*`, which is why a grep-for-console sweep never
    // found it.
    const out = extensionWarning("mix.w\u001b[2K\rav", "mix.mp3");
    expect(out).not.toContain("\u001b");
    expect(out).toContain(".mp3");
  });

  it("sanitizes the new extension too (it comes from argv, and the pair is symmetric)", () => {
    // `nxt` is user-supplied rather than server-supplied, so it is self-inflicted rather than
    // cross-tenant -- but the two halves of one sentence disagreeing about whether their input
    // is safe is the exact shape this whole change set spent six rounds removing.
    const out = extensionWarning("mix.wav", "mix.m\u001b[31mp3");
    expect(out).not.toContain("\u001b");
    expect(out).toContain(".wav");
  });

  it("strips C1 control characters, which the local name check does NOT cover", () => {
    // The local check stops at U+007F and never sees C1 (U+0080–U+009F). U+009B *is* CSI to an
    // xterm in 8-bit mode, so a name carrying one looks perfectly legal to that check and still
    // drives the terminal. `sanitizeInline` covers U+007F–U+009F, which is what closes this.
    const out = extensionWarning("mix.w\u009bav", "mix.mp3");
    expect(out).not.toContain("\u009b");
    expect(out).toContain(".mp3");
  });
});
