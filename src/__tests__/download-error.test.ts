// `files download` sends its own fetch (it follows the 302 to storage), so its error path does not
// go through apiFetch. It must still read a JSON error body the same way apiFetch does, or the
// envelope loses the server's code (`not_found` would degrade to `http_404`).
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FILE_ID = "00000000-0000-4000-8000-000000000000";

let tmpDir: string;
let stderr: string[];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "synchain-download-error-"));
  for (const key of ["HOME", "APPDATA", "XDG_CONFIG_HOME", "SYNCHAIN_ERROR_FORMAT"]) {
    savedEnv[key] = process.env[key];
  }
  process.env.HOME = tmpDir;
  process.env.APPDATA = tmpDir;
  process.env.XDG_CONFIG_HOME = tmpDir;
  process.env.SYNCHAIN_ERROR_FORMAT = "json";
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  process.exitCode = undefined;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function envelopes(): Array<{ error: Record<string, unknown> }> {
  return stderr
    .join("")
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line) as { error: Record<string, unknown> });
}

describe("files download error path", () => {
  it("keeps the server's snake_case code from a JSON error body (404 -> not_found, exit 5)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          })
      )
    );
    const { runFilesDownload } = await import("../commands/files.js");
    await runFilesDownload(FILE_ID, { project: "p", out: path.join(tmpDir, "x.bin") });

    const [record] = envelopes();
    expect(record).toMatchObject({ error: { code: "not_found", status: 404 } });
    expect(process.exitCode).toBe(5);
  });

  it("falls back to http_<status> when the body claims JSON but does not parse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"error":"not_fou', {
            status: 404,
            headers: { "content-type": "application/json" },
          })
      )
    );
    const { runFilesDownload } = await import("../commands/files.js");
    await runFilesDownload(FILE_ID, { project: "p", out: path.join(tmpDir, "x.bin") });

    const [record] = envelopes();
    expect(record).toMatchObject({ error: { code: "http_404", status: 404 } });
    expect(process.exitCode).toBe(5);
  });

  it("strips terminal escapes from a server message in the envelope's detail", async () => {
    const ESC = String.fromCharCode(27);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "not_found", message: `${ESC}[2Jpwned` }), {
            status: 404,
            headers: { "content-type": "application/json" },
          })
      )
    );
    const { runFilesDownload } = await import("../commands/files.js");
    await runFilesDownload(FILE_ID, { project: "p", out: path.join(tmpDir, "x.bin") });

    const [record] = envelopes();
    expect(record).toMatchObject({ error: { code: "not_found", status: 404 } });
    expect(String(record!.error.detail)).not.toContain(ESC);
    expect(String(record!.error.detail)).toContain("pwned");
  });

  it("still falls back to http_<status> when the body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>Bad gateway</html>", {
            status: 502,
            headers: { "content-type": "text/html" },
          })
      )
    );
    const { runFilesDownload } = await import("../commands/files.js");
    await runFilesDownload(FILE_ID, { project: "p", out: path.join(tmpDir, "x.bin") });

    const [record] = envelopes();
    expect(record).toMatchObject({ error: { code: "http_502", status: 502 } });
    expect(process.exitCode).toBe(8);
  });
});
