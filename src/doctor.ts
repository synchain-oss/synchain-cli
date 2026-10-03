// SPDX-License-Identifier: MIT
/**
 * `synchain doctor`: an offline preflight. Pure evaluation -- everything it looks at is passed
 * in, so every check is testable without a file system, a network or a real config.
 *
 * It never makes a request. Whether a key is still valid is a question for the server, and
 * `whoami` asks it. What doctor answers is the part an agent can settle before spending a round
 * trip: is there a credential, does it look like one, is the base URL one the CLI will send it
 * to, is a project selected.
 */

import { isUuid } from "./util/resolve-id.js";
import { sanitizeInline } from "./util/sanitize.js";
import { assertSafeBaseUrl } from "./util/url.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  status: CheckStatus;
  detail: string;
}

/** `ok` is false when any check failed; a warning is advice and leaves it true. */
export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorInput {
  configPath: string;
  /** null when the file does not exist. */
  config: { parseError?: string; mode?: number; value?: unknown } | null;
  env: Record<string, string | undefined>;
  nodeVersion: string;
  platform: string;
  defaultBaseUrl: string;
}

/** CLI keys look like `synch_live_sk_<48 hex>`. */
const KEY_SHAPE = /^synch_live_sk_[0-9a-f]{48}$/;

/**
 * Below this length a value is shown as asterisks only: the 12 characters the mask keeps must be
 * at most half of it. With a bare "more than 12" rule a 13-character value lost one character.
 */
const MASK_MIN_LENGTH = 24;

/**
 * First 8 + last 4 characters: the only form in which a key is ever shown. A value too short to
 * show 12 characters without showing most of it is shown as asterisks only.
 */
export function maskKey(key: string): string {
  return key.length < MASK_MIN_LENGTH
    ? "*".repeat(key.length)
    : `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export function evaluateDoctor(input: DoctorInput): DoctorReport {
  const checks: DoctorCheck[] = [];
  // Everything below may quote the config file or its path, which are not ours to trust: a
  // poisoned value written by an earlier, older CLI would be replayed to the terminal.
  const add = (id: string, status: CheckStatus, detail: string): void => {
    checks.push({ id, status, detail: sanitizeInline(detail) });
  };

  const major = Number(input.nodeVersion.replace(/^v/, "").split(".")[0]);
  add(
    "node_version",
    major >= 20 ? "ok" : "fail",
    major >= 20 ? `Node ${input.nodeVersion}` : `Node ${input.nodeVersion}; the CLI needs >= 20`
  );

  const cfg = input.config;
  const value = (cfg?.value ?? {}) as {
    baseUrl?: unknown;
    token?: unknown;
    activeProject?: unknown;
  };

  if (!cfg) {
    add("config_file", "warn", `no config at ${input.configPath} (run \`synchain login\`)`);
  } else if (cfg.parseError) {
    add("config_file", "fail", `${input.configPath} is not valid JSON: ${cfg.parseError}`);
  } else {
    add("config_file", "ok", input.configPath);
    if (input.platform !== "win32" && cfg.mode !== undefined && (cfg.mode & 0o077) !== 0) {
      add(
        "config_permissions",
        "warn",
        `mode ${(cfg.mode & 0o777).toString(8)}; it holds a key, run chmod 600 on it`
      );
    }
  }

  // Every command except `login` uses the stored key; SYNCHAIN_TOKEN is read by `login` alone.
  // Saying so is the point of this check: it is the misunderstanding an agent makes most often,
  // and nothing else would tell it why a freshly exported key is being ignored.
  const stored = typeof value.token === "string" ? value.token : "";
  const envKey = input.env.SYNCHAIN_TOKEN?.trim() ?? "";
  if (stored) {
    if (!KEY_SHAPE.test(stored)) {
      add(
        "credential",
        "warn",
        `stored key ${maskKey(stored)} does not look like synch_live_sk_<48 hex>`
      );
    } else if (envKey && envKey !== stored) {
      add(
        "credential",
        "warn",
        `stored key ${maskKey(stored)} is the one in use; SYNCHAIN_TOKEN holds another ` +
          `(${maskKey(envKey)}), but only \`synchain login\` reads it: run login to switch`
      );
    } else {
      add("credential", "ok", `stored key ${maskKey(stored)}`);
    }
  } else if (envKey) {
    add(
      "credential",
      "warn",
      "SYNCHAIN_TOKEN is set but no key is stored, and only `synchain login` reads it: " +
        "run `synchain login` first"
    );
  } else {
    add("credential", "fail", "no key stored and SYNCHAIN_TOKEN is unset (run `synchain login`)");
  }

  const baseUrl = typeof value.baseUrl === "string" && value.baseUrl ? value.baseUrl : "";
  const effective = baseUrl || input.defaultBaseUrl;
  try {
    assertSafeBaseUrl(effective);
    add("base_url", "ok", `${effective}${baseUrl ? "" : " (default)"}`);
  } catch (err) {
    add("base_url", "fail", err instanceof Error ? err.message : String(err));
  }

  const active = value.activeProject as { id?: unknown } | undefined;
  if (active && typeof active.id === "string" && isUuid(active.id)) {
    add("active_project", "ok", "set");
  } else if (active) {
    add("active_project", "warn", "stored id is not a UUID; run `synchain project use` again");
  } else {
    add("active_project", "warn", "none selected (run `synchain project use <id>`)");
  }

  return { ok: checks.every((c) => c.status !== "fail"), checks };
}
