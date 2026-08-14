// SPDX-License-Identifier: MIT
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/** The active project remembered between commands (Synchain projects are UUID-only). */
export interface ActiveProject {
  id: string;
  name?: string;
}

export interface CliConfig {
  baseUrl?: string;
  token?: string;
  activeProject?: ActiveProject;
}

/**
 * Returns the OS-conventional config directory for the CLI.
 * - Windows: %APPDATA%/synchain
 * - POSIX:   $XDG_CONFIG_HOME/synchain or ~/.config/synchain
 */
export function getConfigDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "synchain");
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "synchain");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function getWelcomeSentinelPath(): string {
  return path.join(getConfigDir(), ".welcomed");
}

/** True when neither the config file nor the welcome sentinel exists yet. */
export function isFirstRun(): boolean {
  return !existsSync(getConfigPath()) && !existsSync(getWelcomeSentinelPath());
}

/** Returns the parsed config, or null if the file doesn't exist / is unparseable. */
export async function loadConfig(): Promise<CliConfig | null> {
  const p = getConfigPath();
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as CliConfig;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    // Corrupt JSON or unreadable file — surface a warning so the user knows
    // their settings aren't being honored, then fall back to a fresh config.
    const msg = e.message ?? String(err);
    process.stderr.write(`synchain: warning — could not parse config at ${p}: ${msg}\n`);
    return null;
  }
}

/** Writes the config atomically and chmod 0600 on POSIX. */
export async function saveConfig(cfg: CliConfig): Promise<void> {
  const dir = getConfigDir();
  const p = getConfigPath();
  // 0700 dir so the token file isn't listable/readable by other users (POSIX).
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // Use a per-invocation temp filename so concurrent `synchain` processes don't
  // race on a shared `config.json.tmp`. Clean up the tmp file in a `finally`
  // block to avoid leaking partial writes if rename ever fails.
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  try {
    // Create the temp file 0600 from the start — a default-mode (0644) write
    // followed by chmod leaves a transient world-readable window on a shared host.
    await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") {
      await fs.chmod(tmp, 0o600);
    }
    await fs.rename(tmp, p);
  } finally {
    try {
      await fs.unlink(tmp);
    } catch {
      // Expected when rename succeeded — tmp no longer exists.
    }
  }
}

/** Removes the config file. Idempotent. */
export async function clearConfig(): Promise<void> {
  const p = getConfigPath();
  try {
    await fs.unlink(p);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }
}

/** Marks the welcome banner as seen even if the user hasn't logged in. */
export async function markWelcomeSeen(): Promise<void> {
  const dir = getConfigDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getWelcomeSentinelPath(), new Date().toISOString(), "utf8");
}

/** Default Synchain host. Overridable per-login via `--base-url`. */
export const DEFAULT_BASE_URL = "https://synchain.vercel.app";
