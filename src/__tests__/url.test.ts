// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { assertSafeBaseUrl } from "../util/url.js";

describe("assertSafeBaseUrl", () => {
  it("allows any https URL", () => {
    expect(() => assertSafeBaseUrl("https://example.com")).not.toThrow();
    expect(() => assertSafeBaseUrl("https://staging.example.com:8443")).not.toThrow();
  });

  it("allows http only for loopback hosts (local dev)", () => {
    expect(() => assertSafeBaseUrl("http://localhost:3000")).not.toThrow();
    expect(() => assertSafeBaseUrl("http://127.0.0.1:3000")).not.toThrow();
    expect(() => assertSafeBaseUrl("http://[::1]:3000")).not.toThrow();
  });

  it("rejects cleartext http to a remote host", () => {
    expect(() => assertSafeBaseUrl("http://example.com")).toThrow(/insecure http/i);
    expect(() => assertSafeBaseUrl("http://evil.example.com")).toThrow(/insecure http/i);
    expect(() => assertSafeBaseUrl("http://10.0.0.5")).toThrow(/insecure http/i);
  });

  it("rejects a URL with credentials in it, without quoting them back", () => {
    for (const raw of [
      "https://alice:s3cret@example.com",
      "https://alice@example.com",
      "https://:s3cret@example.com",
      "http://alice:s3cret@localhost:3000",
      // Before the scheme check: that message quotes the input, this one must not.
      "ftp://alice:s3cret@example.com",
    ]) {
      let message = "";
      try {
        assertSafeBaseUrl(raw);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message, raw).toMatch(/credentials/);
      expect(message, raw).not.toContain("s3cret");
      expect(message, raw).not.toContain("alice");
    }
  });

  it("masks credentials when quoting back a URL that does not parse", () => {
    // `new URL` fails first (a space in the host, no scheme), so the check above never runs; the
    // message quotes the input, and it must not quote the password with it.
    const messageOf = (raw: string): string => {
      try {
        assertSafeBaseUrl(raw);
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    };
    for (const raw of ["https://alice:s3cret@exa mple.com", "https://alice:s3/cret@exa mple.com"]) {
      const message = messageOf(raw);
      expect(message, raw).toMatch(/^Invalid base URL: \*\*\*@exa mple\.com$/);
      expect(message, raw).not.toContain("s3");
      expect(message, raw).not.toContain("alice");
    }
    // The scheme left out: this parses, with `alice:` as the "scheme" and no username at all,
    // so it reaches the scheme message -- which must quote neither the input nor that "scheme".
    const noScheme = messageOf("alice:s3cret@example.com");
    expect(noScheme).toMatch(/^Unsupported base URL scheme in \*\*\*@example\.com/);
    expect(noScheme).not.toContain("s3cret");
    expect(noScheme).not.toContain("alice");
    // Input without an `@` is still quoted in full: it is the user's own typo, worth seeing.
    expect(messageOf("not a url")).toBe("Invalid base URL: not a url");
    expect(messageOf("ftp://example.com")).toContain('scheme "ftp:" in ftp://example.com');
  });

  it("rejects non-http(s) schemes and invalid URLs", () => {
    expect(() => assertSafeBaseUrl("ftp://example.com")).toThrow();
    expect(() => assertSafeBaseUrl("file:///etc/passwd")).toThrow();
    expect(() => assertSafeBaseUrl("not a url")).toThrow(/Invalid base URL/);
  });
});
