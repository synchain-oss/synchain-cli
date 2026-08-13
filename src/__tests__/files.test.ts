import { describe, expect, it } from "vitest";
import { safeDownloadName } from "../commands/files.js";

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
