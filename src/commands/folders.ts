// SPDX-License-Identifier: MIT
import pc from "picocolors";
import { apiFetch, ApiError, formatApiError, resolveActiveProject, wantsJson } from "../api.js";
import { loadConfig } from "../config.js";
import { sanitizeInline, shortId } from "../util/sanitize.js";
import { renderTable } from "../util/table.js";
import { resolveByPrefix } from "../util/resolve-id.js";

// Mirrors the server's file-name rule (no path separators, no control chars); the server
// validates independently and has the final say.
// eslint-disable-next-line no-control-regex
const FOLDER_NAME_FORBIDDEN_RE = /[\\/\x00-\x1f\x7f]/;

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  projectId: string;
  createdAt: string;
  createdBy: string | null;
}

interface FoldersListResponse {
  folders: Folder[];
}

interface FileDTO {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  uploaderName: string | null;
}

interface FilesListResponse {
  files: FileDTO[];
}

export interface FoldersFlags {
  parent?: string;
  project?: string;
  json?: boolean;
}

async function fetchAllFolders(projectId: string): Promise<Folder[]> {
  const res = await apiFetch<FoldersListResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/folders`
  );
  return res.folders;
}

/**
 * `<name> (<8-char id>)` -- the tail every folders success line shares.
 *
 * Extracted, like `renderMembersTable`, so the sanitizing has a regression net: `src/commands`
 * is outside the coverage `include` and `commander.test.ts` mocks this module wholesale, so a
 * string built inline here could lose its `sanitizeInline` with every test still green.
 */
export function folderLabel(f: { id: string; name: string }): string {
  return `${sanitizeInline(f.name)} (${shortId(f.id)})`;
}

/** Resolve a folder id (full UUID or prefix) to its record. */
async function resolveFolder(projectId: string, input: string): Promise<Folder> {
  return resolveByPrefix(input, () => fetchAllFolders(projectId), "folder");
}

/**
 * Render folders as a tree; orphans (unknown parent) render at root.
 *
 * ⚠ This is the one listing in the CLI that builds its own lines instead of going through
 * `renderTable`, so it does **not** inherit `toCell`'s sanitizing -- and folder names are
 * content any member of the project can set. That makes this the most reachable terminal-escape
 * injection point in the whole tool: no hostile server, no compromised deployment, no `--base-url`
 * needed. One member renames a folder; the next person to run `synchain folders ls` wears it.
 * (`files ls` in the same file is safe precisely because it goes through `renderTable`.)
 *
 * Exported so the sanitizing is testable at all -- see `folderLabel` for why that matters.
 */
export function renderTree(folders: Folder[]): string {
  const byParent = new Map<string | null, Folder[]>();
  const ids = new Set(folders.map((f) => f.id));
  for (const f of folders) {
    const parentKey = f.parentId && ids.has(f.parentId) ? f.parentId : null;
    const arr = byParent.get(parentKey) ?? [];
    arr.push(f);
    byParent.set(parentKey, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name));

  const lines: string[] = ["/"];
  function walk(parent: string | null, prefix: string) {
    const children = byParent.get(parent) ?? [];
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1;
      const connector = isLast ? "└── " : "├── ";
      lines.push(
        `${prefix}${connector}${sanitizeInline(child.name)}  ${pc.dim(shortId(child.id))}`
      );
      walk(child.id, `${prefix}${isLast ? "    " : "│   "}`);
    });
  }
  walk(null, "");
  return lines.join("\n");
}

export async function runFoldersLs(
  folderId: string | undefined,
  flags: FoldersFlags
): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);

    if (folderId) {
      // List the files inside a specific folder (resolve prefix → full UUID).
      const resolved = await resolveFolder(projectId, folderId);
      const result = await apiFetch<FilesListResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/files?folderId=${encodeURIComponent(resolved.id)}`
      );
      if (wantsJson(flags)) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.files.length === 0) {
        console.log(pc.dim("(folder is empty)"));
        return;
      }
      console.log(
        renderTable(
          [
            { header: "id", key: "id" },
            { header: "name", key: "name" },
            { header: "size", key: "size" },
            { header: "uploadedAt", key: "uploadedAt" },
          ],
          result.files.map((f) => ({
            id: shortId(f.id),
            name: f.name,
            size: f.size,
            uploadedAt: f.uploadedAt,
          }))
        )
      );
      return;
    }

    const result = await apiFetch<FoldersListResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/folders`
    );
    if (wantsJson(flags)) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.folders.length === 0) {
      console.log(pc.dim("(no folders)"));
      return;
    }
    console.log(renderTree(result.folders));
  } catch (err) {
    if (err instanceof Error && /No folder matches|prefix.*ambiguous/.test(err.message)) {
      console.error(pc.red(err.message));
      process.exitCode = 1;
      return;
    }
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

export async function runFoldersMkdir(name: string, flags: FoldersFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);
    const body: { name: string; parentId?: string } = { name };
    if (flags.parent) body.parentId = (await resolveFolder(projectId, flags.parent)).id;
    const created = await apiFetch<{ folder: Folder }>(
      `/api/projects/${encodeURIComponent(projectId)}/folders`,
      { method: "POST", body }
    );
    if (wantsJson(flags)) {
      console.log(JSON.stringify(created, null, 2));
    } else {
      console.log(
        pc.green(`Created folder ${folderLabel(created.folder)}`)
      );
    }
  } catch (err) {
    if (err instanceof Error && /No folder matches|prefix.*ambiguous/.test(err.message)) {
      console.error(pc.red(err.message));
      process.exitCode = 1;
      return;
    }
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

export async function runFoldersRm(folderId: string, flags: FoldersFlags): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);
    const resolved = await resolveFolder(projectId, folderId);
    await apiFetch(
      `/api/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(resolved.id)}`,
      { method: "DELETE" }
    );
    console.log(pc.green(`Deleted folder ${folderLabel(resolved)}.`));
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const body = err.body as { error?: string } | null;
      if (body?.error === "folder_not_empty") {
        console.error(pc.red(`Folder is not empty. Delete its files / sub-folders first.`));
        process.exitCode = 1;
        return;
      }
    }
    if (err instanceof Error && /No folder matches|prefix.*ambiguous/.test(err.message)) {
      console.error(pc.red(err.message));
      process.exitCode = 1;
      return;
    }
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}

export async function runFoldersRename(
  folderId: string,
  newName: string,
  flags: FoldersFlags
): Promise<void> {
  const cfg = await loadConfig();
  try {
    const projectId = resolveActiveProject(cfg, flags.project);

    if (!newName || newName.length === 0) {
      console.error(pc.red("New name cannot be empty."));
      process.exitCode = 1;
      return;
    }
    if (newName.length > 200) {
      console.error(pc.red("New name is too long (max 200 chars)."));
      process.exitCode = 1;
      return;
    }
    if (FOLDER_NAME_FORBIDDEN_RE.test(newName)) {
      console.error(pc.red("Invalid name — no path separators or control characters."));
      process.exitCode = 1;
      return;
    }

    const resolved = await resolveFolder(projectId, folderId);
    const result = await apiFetch<{ folder: Folder }>(
      `/api/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(resolved.id)}`,
      { method: "PATCH", body: { name: newName } }
    );
    if (wantsJson(flags)) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(
      pc.green(
        `Renamed folder → ${sanitizeInline(result.folder.name)} (id: ${shortId(resolved.id)}).`
      )
    );
  } catch (err) {
    if (err instanceof Error && /No folder matches|prefix.*ambiguous/.test(err.message)) {
      console.error(pc.red(err.message));
      process.exitCode = 1;
      return;
    }
    if (err instanceof ApiError && err.status === 404) {
      // argv-sourced, so self-inflicted rather than cross-tenant -- sanitized anyway, because an
      // unsanitized exception sitting among sanitized neighbours is how the rule erodes.
      console.error(pc.red(`Folder ${sanitizeInline(folderId)} not found.`));
      process.exitCode = 1;
      return;
    }
    console.error(pc.red(formatApiError(err)));
    process.exitCode = 1;
    return;
  }
}
