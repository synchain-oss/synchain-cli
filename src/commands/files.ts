// SPDX-License-Identifier: MIT
import pc from "picocolors";
import { promises as fs, createReadStream, createWriteStream } from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import mime from "mime-types";

import {
  apiFetch,
  ApiError,
  formatApiError,
  formatErrorBody,
  resolveActiveProject,
  wantsJson,
} from "../api.js";
import { DEFAULT_BASE_URL, loadConfig } from "../config.js";
import { renderTable } from "../util/table.js";
import { Progress } from "../util/progress.js";
import { promptConfirm } from "../util/prompt.js";
import { isUuid, resolveByPrefix } from "../util/resolve-id.js";
import { assertSafeBaseUrl } from "../util/url.js";
import { sanitizeInline, shortId } from "../util/sanitize.js";

interface FileDTO {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  storageKey: string;
  folderId: string | null;
  uploadedBy: string | null;
  uploaderName: string | null;
  uploadedAt: string;
}

interface FilesListResponse {
  files: FileDTO[];
}

/** Synchain presign response: PUT the bytes to `uploadUrl`, then register `key`. */
interface UploadUrlResponse {
  uploadUrl: string;
  method: "PUT";
  key: string;
}

interface CreateFileResponse {
  file: FileDTO;
}

interface FolderRow {
  id: string;
  name: string;
}

export interface FilesFlags {
  folder?: string;
  project?: string;
  json?: boolean;
  out?: string;
  to?: string;
  yes?: boolean;
}

// Mirrors the server-side FILE_NAME_FORBIDDEN_RE (no path separators / control chars).
// eslint-disable-next-line no-control-regex
const CLIENT_NAME_FORBIDDEN_RE = /[\\/\x00-\x1f\x7f]/;

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx <= 0 ? "" : name.slice(idx + 1).toLowerCase();
}

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

/**
 * No-progress watchdog for streaming fetches: undici has no stall timeout of its
 * own, so a half-open socket mid-transfer would hang forever. Aborts the paired
 * request if no bytes move for `ms`. Call kick() on every chunk, clear() on done.
 */
function stallGuard(
  ms: number,
  label: string
): { signal: AbortSignal; kick: () => void; clear: () => void } {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  const arm = () => {
    timer = setTimeout(
      () => controller.abort(new Error(`${label} stalled: no data for ${Math.round(ms / 1000)}s`)),
      ms
    );
    timer.unref(); // don't keep the process alive for the watchdog alone
  };
  const kick = () => {
    if (timer) clearTimeout(timer);
    arm();
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  arm();
  return { signal: controller.signal, kick, clear };
}

/**
 * Returns `p` if free, else `stem (1).ext`, `stem (2).ext`, … so a default-named
 * download never silently clobbers an existing local file (a project peer can name
 * a file `package.json`/`.npmrc`). Only used for the DERIVED name — an explicit
 * `--out <path>` keeps overwrite semantics (the user opted into that path).
 */
async function nextAvailablePath(p: string): Promise<string> {
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const stem = path.basename(p, ext);
  let candidate = p;
  for (let n = 0; n < 10_000; n++) {
    try {
      await fs.access(candidate); // resolves ⇒ exists ⇒ try the next suffix
    } catch {
      return candidate; // rejects ⇒ free to use
    }
    candidate = path.join(dir, `${stem} (${n + 1})${ext}`);
  }
  return candidate; // pathological dir; give up and let the write proceed
}

/** Every file across the project (root + all folders). Used for id-prefix resolution. */
async function fetchAllFilesInProject(projectId: string): Promise<FileDTO[]> {
  const res = await apiFetch<FilesListResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/files?all=1`
  );
  return res.files;
}

/**
 * Resolve a file id (full UUID or 8-char prefix) to its full record.
 *
 * this still walks the whole project even for a full UUID, because
 * mv/rm/rename need the record's `name` (for their confirmations, success lines
 * and the rename extension check) and the only single-file endpoint
 * (`GET /files/[fileId]`) streams the bytes rather than returning metadata — there
 * is no metadata-by-id endpoint to short-circuit to. `download` (which needs only
 * the id, the name arriving via Content-Disposition) does short-circuit; see
 * runFilesDownload.
 */
async function resolveFile(projectId: string, input: string): Promise<FileDTO> {
  return resolveByPrefix(input, () => fetchAllFilesInProject(projectId), "file");
}

/** Resolve a folder id (full UUID or prefix) to a full UUID, or return null for "root". */
async function resolveFolderId(projectId: string, input: string): Promise<string> {
  const folder = await resolveByPrefix(
    input,
    async () => {
      const res = await apiFetch<{ folders: FolderRow[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/folders`
      );
      return res.folders;
    },
    "folder"
  );
  return folder.id;
}

export async function runFilesLs(flags: FilesFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);
    const qs = new URLSearchParams();
    if (flags.folder) qs.set("folderId", await resolveFolderId(projectId, flags.folder));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const result = await apiFetch<FilesListResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/files${suffix}`
    );
    if (wantsJson(flags)) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.files.length === 0) {
      console.log(pc.dim("(no files)"));
      return;
    }
    const rows = result.files.map((f) => ({
      id: shortId(f.id),
      name: f.name,
      size: formatBytes(f.size),
      mime: f.mimeType,
      uploader: f.uploaderName ?? "",
      uploadedAt: f.uploadedAt,
    }));
    console.log(
      renderTable(
        [
          { header: "id", key: "id" },
          { header: "name", key: "name" },
          { header: "size", key: "size" },
          { header: "mime", key: "mime" },
          { header: "uploader", key: "uploader" },
          { header: "uploadedAt", key: "uploadedAt" },
        ],
        rows
      )
    );
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

export async function runFilesUpload(localPath: string, flags: FilesFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);
    const absPath = path.resolve(localPath);
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) {
      console.error(pc.red(`Not a regular file: ${absPath}`));
      process.exitCode = 1;
      return;
    }
    // The server's upload-url schema rejects size=0 with an opaque "invalid_query";
    // pre-check here so an empty placeholder file gets a message that says why.
    if (stat.size === 0) {
      console.error(
        pc.red(`Cannot upload an empty (0-byte) file: ${absPath} — empty files aren't supported.`)
      );
      process.exitCode = 1;
      return;
    }
    const fileName = path.basename(absPath);
    const mimeType = mime.lookup(fileName) || "application/octet-stream";

    // Resolve --folder via the prefix rule (same 8-char id `folders ls` prints).
    let resolvedFolderId: string | null = null;
    if (flags.folder) resolvedFolderId = await resolveFolderId(projectId, flags.folder);

    // 1. Mint a presigned upload URL.
    const qs = new URLSearchParams();
    qs.set("name", fileName);
    qs.set("size", String(stat.size));
    qs.set("type", mimeType);
    if (resolvedFolderId) qs.set("folderId", resolvedFolderId);
    const upload = await apiFetch<UploadUrlResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/files/upload-url?${qs.toString()}`
    );

    // 2. PUT the file body to the presigned URL. The Content-Type MUST match the
    //    `type` the URL was signed with, or R2 rejects the PUT.
    const progress = new Progress({ total: stat.size, label: `uploading ${fileName}` });
    const guard = stallGuard(60_000, "upload");
    const fileStream = createReadStream(absPath);
    fileStream.on("data", (chunk) => {
      progress.add((chunk as Buffer).length);
      guard.kick(); // backpressure pauses local reads when the network stalls
    });
    const webStream = Readable.toWeb(fileStream) as unknown as ReadableStream;

    const putRes = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType, "Content-Length": String(stat.size) },
      body: webStream,
      signal: guard.signal,
      // Node's undici fetch requires duplex:'half' when streaming a body.
      ...({ duplex: "half" } as Record<string, unknown>),
    } as RequestInit);
    guard.clear();
    if (!putRes.ok) {
      const text = await putRes.text().catch(() => "");
      progress.finish(`upload failed: HTTP ${putRes.status}`);
      // Same treatment as `formatApiError`, and for a slightly wider trust boundary: this body
      // does not come from the configured API host at all, but from whatever host that API
      // handed back in `upload.uploadUrl`. It bypasses `formatApiError`, so it needs the shared
      // renderer explicitly -- sanitized, indented, and capped.
      const body = formatErrorBody(text);
      console.error(
        pc.red(`Storage PUT failed: ${putRes.status}${body ? `
  ${body}` : ""}`)
      );
      process.exitCode = 1;
      return;
    }
    progress.finish(`uploaded ${fileName} (${formatBytes(stat.size)})`);

    // 3. Register the object as a file row. Note the field rename key → storageKey.
    let created: CreateFileResponse;
    try {
      created = await apiFetch<CreateFileResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/files`,
        {
          method: "POST",
          body: {
            storageKey: upload.key,
            name: fileName,
            size: stat.size,
            mimeType,
            folderId: resolvedFolderId ?? undefined,
          },
        }
      );
    } catch (err) {
      // The bytes reached R2 but the file row wasn't created (network drop, write
      // scope revoked mid-flight, folder deleted, …). Surface the orphaned key so
      // the user understands a retry re-uploads the bytes and the stray object is
      // reclaimed by server-side cleanup — then let the outer handler print the error.
      process.stderr.write(
        pc.yellow(
          `\nNote: the bytes were uploaded to storage (key: ${sanitizeInline(upload.key)}) but registering the file ` +
            `record failed. Retrying re-uploads the bytes; the orphaned object is reclaimed server-side.\n`
        )
      );
      throw err;
    }

    if (wantsJson(flags)) {
      console.log(JSON.stringify(created, null, 2));
    } else {
      console.log(pc.green(`Created file ${sanitizeInline(created.file.id)}`));
    }
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

/**
 * Derive a SAFE local filename for a download when no `--out` is given. Both the
 * server's Content-Disposition and the DB filename are untrusted, so each is
 * reduced to a bare `path.basename` (stripping any `../` or absolute path) before
 * use — a malicious/MITM server can't steer the write outside the cwd. Falls back
 * to `<fileId>.bin` if nothing usable remains. Exported for tests.
 */
export function safeDownloadName(
  contentDisposition: string | null,
  fallbackName: string,
  fileId: string
): string {
  const match = /filename="([^"]+)"/i.exec(contentDisposition ?? "");
  let name = path.basename(match ? match[1]! : "");
  if (!name || name === "." || name === "..") name = path.basename(fallbackName);
  if (!name || name === "." || name === "..") name = `${fileId}.bin`;
  return name;
}

export async function runFilesDownload(fileId: string, flags: FilesFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);
    // a full UUID hits the file endpoint directly; only an 8-char
    // prefix needs the project-wide walk. The endpoint carries the authoritative
    // filename in Content-Disposition, so the DB name is only a fallback here.
    let downloadId: string;
    let fallbackName: string;
    if (isUuid(fileId)) {
      downloadId = fileId;
      fallbackName = fileId;
    } else {
      const resolved = await resolveFile(projectId, fileId);
      downloadId = resolved.id;
      fallbackName = resolved.name;
    }
    const baseUrl = cfg?.baseUrl ?? DEFAULT_BASE_URL;
    // This path bypasses apiFetch (raw fetch to follow the 302 → R2), so guard
    // the base URL here too — never send the bearer over cleartext http.
    assertSafeBaseUrl(baseUrl);
    // The endpoint 302-redirects to a short-lived presigned R2 URL; fetch follows.
    const url = `${baseUrl.replace(/\/+$/, "")}/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(downloadId)}`;
    const headers: Record<string, string> = {};
    if (cfg?.token) headers["Authorization"] = `Bearer ${cfg.token}`;
    const guard = stallGuard(60_000, "download");
    // If fetch() itself throws (DNS/connect failure), the watchdog timer is still
    // armed — clear it here, since the outer catch has no handle on the guard.
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: guard.signal });
    } catch (err) {
      guard.clear();
      throw err;
    }
    if (!res.ok) {
      guard.clear();
      const body = await res.text().catch(() => "");
      throw new ApiError(res.status, url, body);
    }
    if (!res.body) {
      guard.clear();
      throw new Error("Empty response body");
    }

    // Resolve the output path.
    //
    // SECURITY: the derived name comes from untrusted server data (both the
    // Content-Disposition AND the DB filename), so it is reduced to a bare
    // basename (see safeDownloadName) and the resolved target is asserted to
    // stay inside the cwd. An explicit `--out <path>` is honored verbatim
    // (the user opted in to that path).
    let absOut: string | undefined;
    let toStdout = false;
    if (flags.out === "-") {
      toStdout = true;
    } else if (flags.out) {
      absOut = path.resolve(flags.out);
    } else {
      const safeName = safeDownloadName(
        res.headers.get("content-disposition"),
        fallbackName,
        downloadId
      );
      absOut = path.resolve(process.cwd(), safeName);
      // Defense-in-depth: the derived target must not escape the working dir.
      const cwd = process.cwd();
      if (absOut !== cwd && !absOut.startsWith(cwd + path.sep)) {
        throw new Error(`Refusing to write outside the working directory: ${sanitizeInline(absOut)}`);
      }
      // Never silently overwrite an existing local file with a server-derived name.
      absOut = await nextAvailablePath(absOut);
    }

    const total = (() => {
      const cl = res.headers.get("content-length");
      return cl ? Number(cl) : undefined;
    })();
    const progress = new Progress({
      total,
      label: `downloading ${toStdout ? "(stdout)" : sanitizeInline(path.basename(absOut ?? fallbackName))}`,
    });

    const nodeStream = Readable.fromWeb(
      res.body as unknown as import("node:stream/web").ReadableStream
    );
    nodeStream.on("data", (chunk: Buffer) => {
      progress.add(chunk.length);
      guard.kick();
    });

    if (toStdout) {
      await pipeline(nodeStream, process.stdout);
      guard.clear();
      progress.finish();
    } else {
      const writeStream = createWriteStream(absOut!);
      await pipeline(nodeStream, writeStream);
      guard.clear();
      progress.finish(`downloaded to ${sanitizeInline(absOut)}`);
    }
  } catch (err) {
    if (err instanceof Error && /No file matches|prefix.*ambiguous/.test(err.message)) {
      console.error(pc.red(err.message));
      process.exitCode = 1;
      return;
    }
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

export async function runFilesMv(fileId: string, flags: FilesFlags): Promise<void> {
  if (!flags.to) {
    console.error(pc.red("--to <folderId|root> is required"));
    process.exitCode = 1;
    return;
  }
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);
    const resolved = await resolveFile(projectId, fileId);
    const folderId = flags.to === "root" ? null : await resolveFolderId(projectId, flags.to);
    const result = await apiFetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(resolved.id)}`,
      { method: "PATCH", body: { folderId } }
    );
    if (wantsJson(flags)) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        pc.green(
          `Moved ${sanitizeInline(resolved.name)} to ${folderId === null ? "root" : sanitizeInline(folderId)}.`
        )
      );
    }
  } catch (err) {
    if (err instanceof Error && /No (file|folder) matches|prefix.*ambiguous/.test(err.message)) {
      console.error(pc.red(err.message));
      process.exitCode = 1;
      return;
    }
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

export async function runFilesRm(fileId: string, flags: FilesFlags): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg?.token) {
    console.error(pc.red("Not logged in. Run `synchain login`."));
    process.exitCode = 1;
    return;
  }
  try {
    const projectId = resolveActiveProject(cfg, flags.project);

    // 1. Resolve 8-char prefix → full record via a project-wide files walk.
    let resolved: FileDTO;
    try {
      resolved = await resolveFile(projectId, fileId);
    } catch (err) {
      if (err instanceof Error && /No file matches|prefix.*ambiguous/.test(err.message)) {
        console.error(pc.red(err.message));
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    // 2. Confirm (skipped with --yes for non-interactive use).
    if (!flags.yes) {
      const ok = await promptConfirm(
        `Delete ${sanitizeInline(resolved.name)} (${shortId(resolved.id)})?`,
        false
      );
      if (!ok) {
        console.log("Cancelled.");
        return;
      }
    }

    // 3. DELETE the file (server removes the R2 object then the row).
    await apiFetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(resolved.id)}`,
      { method: "DELETE" }
    );
    console.log(pc.green(`Deleted ${sanitizeInline(resolved.name)} (${shortId(resolved.id)}).`));
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

export async function runFilesRename(
  fileId: string,
  newName: string,
  flags: FilesFlags
): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);

    // Client-side validation — snappy errors for cases that need no round-trip.
    // The server has the final say (≤255 chars, forbidden chars, extension lock).
    if (!newName || newName.length === 0) {
      console.error(pc.red("New name cannot be empty."));
      process.exitCode = 1;
      return;
    }
    if (newName.length > 255) {
      console.error(pc.red("New name is too long (max 255 chars)."));
      process.exitCode = 1;
      return;
    }
    if (CLIENT_NAME_FORBIDDEN_RE.test(newName)) {
      console.error(pc.red("Invalid name — no path separators or control characters."));
      process.exitCode = 1;
      return;
    }

    let resolved: FileDTO;
    try {
      resolved = await resolveFile(projectId, fileId);
    } catch (err) {
      if (err instanceof Error && /No file matches|prefix.*ambiguous/.test(err.message)) {
        console.error(pc.red(err.message));
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    // Extension sanity check (warn only — the server's 422 is the source of truth).
    if (extOf(resolved.name) !== extOf(newName)) {
      const cur = extOf(resolved.name);
      const nxt = extOf(newName);
      const note = cur
        ? `Warning: extension differs (.${cur} → ${nxt ? `.${nxt}` : "(none)"}). Server may reject.`
        : `Warning: original has no extension; new name does. Server may reject.`;
      process.stderr.write(pc.yellow(`${note}\n`));
    }

    try {
      const result = await apiFetch<{ file: FileDTO }>(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(resolved.id)}`,
        { method: "PATCH", body: { name: newName } }
      );
      if (wantsJson(flags)) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(
        pc.green(
          `Renamed ${sanitizeInline(resolved.name)} → ${sanitizeInline(result.file.name)} (id: ${shortId(resolved.id)}).`
        )
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        console.error(
          pc.red("Extension cannot be changed. Use the same extension as the original.")
        );
        process.exitCode = 1;
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        console.error(pc.red(`File ${sanitizeInline(resolved.id)} not found.`));
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  } catch (err) {
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}
