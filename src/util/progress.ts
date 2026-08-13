// SPDX-License-Identifier: MIT
/**
 * Minimal \r-overwriting byte progress for uploads/downloads. Skips entirely
 * when the stream is not a TTY (clean log output in CI).
 */

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const precision = v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(precision)} ${units[i]}`;
}

export interface ProgressOptions {
  /** Total bytes (if known). When omitted, only transferred bytes are shown. */
  total?: number;
  /** Label prefix, e.g. "uploading my.wav". */
  label?: string;
  /** Render to stderr by default (so stdout stays parseable). */
  stream?: NodeJS.WriteStream;
}

export class Progress {
  private transferred = 0;
  private readonly total?: number;
  private readonly label: string;
  private readonly stream: NodeJS.WriteStream;
  private readonly enabled: boolean;
  private lastRender = 0;
  private done = false;

  constructor(opts: ProgressOptions = {}) {
    this.total = opts.total;
    this.label = opts.label ?? "";
    this.stream = opts.stream ?? process.stderr;
    this.enabled = Boolean(this.stream.isTTY);
  }

  add(bytes: number): void {
    this.transferred += bytes;
    if (!this.enabled || this.done) return;
    // Throttle: render at most ~20 times/sec.
    const now = Date.now();
    if (now - this.lastRender < 50) return;
    this.lastRender = now;
    this.render();
  }

  private render(): void {
    let line: string;
    if (this.total && this.total > 0) {
      const pct = Math.min(100, (this.transferred / this.total) * 100);
      line = `${this.label} ${formatBytes(this.transferred)} / ${formatBytes(this.total)} (${pct.toFixed(1)}%)`;
    } else {
      line = `${this.label} ${formatBytes(this.transferred)}`;
    }
    this.stream.write(`\r${line.padEnd(60, " ")}`);
  }

  finish(message?: string): void {
    if (this.done) return;
    this.done = true;
    if (this.total && this.transferred < this.total) {
      this.transferred = this.total;
    }
    if (this.enabled) {
      // Interactive: overwrite the in-place progress line with the final state,
      // then emit the completion message on its own line.
      this.render();
      if (message) this.stream.write(`\r${message.padEnd(60, " ")}\n`);
      else this.stream.write("\n");
      return;
    }
    // Non-TTY (CI, pipes): we never emitted progress lines, but the caller's
    // completion message must still surface.
    if (message) this.stream.write(`${message}\n`);
  }
}
