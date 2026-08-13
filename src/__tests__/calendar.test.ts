// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parseDateInput } from "../commands/calendar.js";

describe("parseDateInput", () => {
  it("accepts ISO 8601 with a timezone and normalizes to UTC", () => {
    expect(parseDateInput("2026-06-01T10:00:00Z")).toBe("2026-06-01T10:00:00.000Z");
  });

  it("parses local `YYYY-MM-DD HH:mm` in the machine timezone", () => {
    const iso = parseDateInput("2026-06-01 10:00");
    // Round-trips back to the same local wall-clock time.
    const d = new Date(iso);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June (0-indexed)
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(0);
  });

  it("accepts the `T` separator in the local form too", () => {
    const iso = parseDateInput("2026-06-01T10:00");
    const d = new Date(iso);
    expect(d.getHours()).toBe(10);
  });

  it("throws on empty or unparseable input", () => {
    expect(() => parseDateInput("")).toThrow();
    expect(() => parseDateInput("not-a-date")).toThrow();
  });
});
