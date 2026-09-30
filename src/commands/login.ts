// SPDX-License-Identifier: MIT
import pc from "picocolors";
import { apiFetch, ApiError, formatApiError, reportError } from "../api.js";
import { DEFAULT_BASE_URL, loadConfig, saveConfig, type CliConfig } from "../config.js";
import { promptPassword, promptText } from "../util/prompt.js";
import { sanitizeInline } from "../util/sanitize.js";
import { assertSafeBaseUrl } from "../util/url.js";

export interface LoginFlags {
  baseUrl?: string;
}

/** Env var used by CI / agents to pass a CLI key without an argv flag. */
export const TOKEN_ENV_VAR = "SYNCHAIN_TOKEN";

export interface MeResponse {
  user: {
    id: string;
    email: string | null;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  // `customId` is the short custom ID claimed on the web (null when never set).
  // **Declaring it optional is load-bearing**: the CLI is released independently with no
  // auto-publish, so "new CLI against an older server" is a permanent condition, and such
  // a server does not return the key at all. `apiFetch` is a bare `res.json() as T` with
  // no runtime schema validation, so marking it required would just make the type lie —
  // consumers have to handle `undefined` themselves. The converse holds too: an older CLI
  // against a newer server quietly ignores the extra key, which makes the server side of
  // this purely additive.
  projects: Array<{ id: string; name: string; role: string; customId?: string | null }>;
}

/** A friendly label for the signed-in user (display name → username → email → id). */
export function userLabel(user: MeResponse["user"]): string {
  return user.displayName || user.username || user.email || user.id;
}

export async function runLogin(flags: LoginFlags): Promise<void> {
  const existing = (await loadConfig()) ?? ({} as CliConfig);
  const envToken = process.env[TOKEN_ENV_VAR]?.trim();

  // Without a terminal on stdin (CI, an agent harness, `</dev/null`) nobody can answer a prompt.
  // Opening one anyway printed it, ended the process with exit 0 and saved nothing: a scripted
  // login that reported success and left the machine logged out. So this path never prompts --
  // the key must come from the environment, and a missing one is a usage error up front, before
  // any request.
  const interactive = process.stdin.isTTY === true;
  if (!interactive && !envToken) {
    reportError(
      new Error(
        `No CLI key: stdin is not a terminal, so the key cannot be prompted for. Set ${TOKEN_ENV_VAR} in the environment (a key is never accepted as a command-line argument).`
      ),
      { code: "missing_argument" }
    );
    return;
  }

  // Resolve baseUrl. Without a terminal, take the answer the prompt would have defaulted to.
  let baseUrl = flags.baseUrl;
  if (!baseUrl) {
    const fallback = existing.baseUrl ?? DEFAULT_BASE_URL;
    baseUrl = interactive ? await promptText("Base URL", { initial: fallback }) : fallback;
    if (!baseUrl) {
      reportError(new Error("Login cancelled."), { code: "login_cancelled" });
      return;
    }
  }
  baseUrl = baseUrl.replace(/\/+$/, "");

  // Reject a cleartext-http remote base URL before the key is ever sent/saved.
  try {
    assertSafeBaseUrl(baseUrl);
  } catch (e) {
    reportError(e, { code: "insecure_base_url" });
    return;
  }

  // Resolve the CLI key. Precedence:
  //   1. SYNCHAIN_TOKEN env var (CI-friendly, no argv leakage).
  //   2. Interactive hidden prompt (the default for humans; only reached on a terminal).
  // We intentionally do NOT accept a `--token` flag: argv ends up in shell
  // history and /proc/<pid>/cmdline, which would leak the bearer.
  let token = envToken;
  if (!token) {
    token = await promptPassword("CLI key (input hidden, from Settings → CLI Access)");
    if (!token) {
      reportError(new Error("Login cancelled."), { code: "login_cancelled" });
      return;
    }
  }

  try {
    const me = await apiFetch<MeResponse>("/api/user/me", { baseUrl, token });
    // When logging into a *different* server, a stored activeProject belongs to
    // the old host and would target an unrelated project. Carry it over only
    // when the baseUrl is unchanged.
    const cfg: CliConfig = {
      baseUrl,
      token,
      activeProject: existing.baseUrl === baseUrl ? existing.activeProject : undefined,
    };
    await saveConfig(cfg);
    // Same output-boundary rule as `whoami`: these are the user's own profile fields, but an
    // unsanitized exception next to a sanitized neighbour is how the rule erodes.
    const suffix = me.user.email ? ` (${sanitizeInline(me.user.email)})` : "";
    console.log(pc.green(`Logged in as ${sanitizeInline(userLabel(me.user))}${suffix}.`));
    if (me.projects.length > 0) {
      console.log(
        pc.dim(
          `Access to ${me.projects.length} project${me.projects.length === 1 ? "" : "s"}. Run \`synchain project ls\` to list.`
        )
      );
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      reportError(err, { message: "Login failed: invalid CLI key." });
    } else if (err instanceof ApiError && err.status === 404) {
      reportError(err, {
        message: "Login failed: /api/user/me not found. Is the server up to date?",
      });
    } else {
      reportError(err, { message: `Login failed: ${formatApiError(err)}` });
    }
    return;
  }
}
