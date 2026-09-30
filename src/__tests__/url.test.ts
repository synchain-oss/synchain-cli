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

  it("rejects non-http(s) schemes and invalid URLs", () => {
    expect(() => assertSafeBaseUrl("ftp://example.com")).toThrow();
    expect(() => assertSafeBaseUrl("file:///etc/passwd")).toThrow();
    expect(() => assertSafeBaseUrl("not a url")).toThrow(/Invalid base URL/);
  });
});
