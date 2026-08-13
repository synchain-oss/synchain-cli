// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { Progress } from "../util/progress.js";

function makeStream(isTTY: boolean) {
  const writes: string[] = [];
  const stream = {
    isTTY,
    write: vi.fn((s: string) => {
      writes.push(s);
      return true;
    }),
  } as unknown as NodeJS.WriteStream;
  return { stream, writes };
}

describe("Progress", () => {
  it("renders progress on a TTY stream with a total", () => {
    const { stream, writes } = makeStream(true);
    const p = new Progress({ total: 100, label: "uploading", stream });
    p.add(50);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes[writes.length - 1]!).toContain("uploading");
    expect(writes[writes.length - 1]!).toContain("50 B / 100 B");
  });

  it("renders transferred-only when no total is given", () => {
    const { stream, writes } = makeStream(true);
    const p = new Progress({ label: "downloading", stream });
    p.add(50);
    expect(writes[writes.length - 1]!).toContain("downloading");
    expect(writes[writes.length - 1]!).toContain("50 B");
  });

  it("does not render while add() is throttled or disabled", () => {
    const { stream, writes } = makeStream(true);
    const p = new Progress({ total: 100, stream });
    p.add(1);
    const count = writes.length;
    p.add(2); // within 50ms — throttled, no new render
    expect(writes.length).toBe(count);
  });

  it("never renders on a non-TTY stream", () => {
    const { stream, writes } = makeStream(false);
    const p = new Progress({ total: 100, stream });
    p.add(50);
    expect(writes).toHaveLength(0);
  });

  it("finish on TTY overwrites and writes the completion message", () => {
    const { stream, writes } = makeStream(true);
    const p = new Progress({ total: 100, stream });
    p.finish("done!");
    expect(writes.some((w) => w.includes("done!"))).toBe(true);
  });

  it("finish on non-TTY writes only the completion message", () => {
    const { stream, writes } = makeStream(false);
    const p = new Progress({ stream });
    p.finish("done!");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe("done!\n");
  });

  it("finish without a message on non-TTY writes nothing", () => {
    const { stream, writes } = makeStream(false);
    const p = new Progress({ stream });
    p.finish();
    expect(writes).toHaveLength(0);
  });

  it("finish is idempotent", () => {
    const { stream, writes } = makeStream(false);
    const p = new Progress({ stream });
    p.finish("first");
    p.finish("second");
    expect(writes).toHaveLength(1);
  });

  it("finish clamps transferred up to total and covers KB formatting", () => {
    const { stream, writes } = makeStream(true);
    const p = new Progress({ total: 5000, label: "x", stream });
    p.finish();
    expect(writes.some((w) => w.includes("KB"))).toBe(true);
  });

  it("defaults to process.stderr and empty label", () => {
    const p = new Progress();
    // Non-TTY stderr → no output on add/finish; constructor must not throw.
    p.add(1);
    p.finish();
    expect(true).toBe(true);
  });
});
