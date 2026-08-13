import pc from "picocolors";
import { apiFetch, ApiError, formatApiError } from "../api.js";
import { DEFAULT_BASE_URL, loadConfig, saveConfig, type CliConfig } from "../config.js";
import { promptPassword, promptText } from "../util/prompt.js";
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
  projects: Array<{ id: string; name: string; role: string }>;
}

/** A friendly label for the signed-in user (display name → username → email → id). */
export function userLabel(user: MeResponse["user"]): string {
  return user.displayName || user.username || user.email || user.id;
}

export async function runLogin(flags: LoginFlags): Promise<void> {
  const existing = (await loadConfig()) ?? ({} as CliConfig);

  // Resolve baseUrl.
  let baseUrl = flags.baseUrl;
  if (!baseUrl) {
    baseUrl = await promptText("Base URL", { initial: existing.baseUrl ?? DEFAULT_BASE_URL });
    if (!baseUrl) {
      console.error(pc.red("Login cancelled."));
      process.exit(1);
    }
  }
  baseUrl = baseUrl.replace(/\/+$/, "");

  // Reject a cleartext-http remote base URL before the key is ever sent/saved.
  try {
    assertSafeBaseUrl(baseUrl);
  } catch (e) {
    console.error(pc.red(e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }

  // Resolve the CLI key. Precedence:
  //   1. SYNCHAIN_TOKEN env var (CI-friendly, no argv leakage).
  //   2. Interactive hidden prompt (the default for humans).
  // We intentionally do NOT accept a `--token` flag: argv ends up in shell
  // history and /proc/<pid>/cmdline, which would leak the bearer.
  let token = process.env[TOKEN_ENV_VAR]?.trim();
  if (!token) {
    token = await promptPassword("CLI key (input hidden, from Settings → CLI Access)");
    if (!token) {
      console.error(pc.red("Login cancelled."));
      process.exit(1);
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
    const suffix = me.user.email ? ` (${me.user.email})` : "";
    console.log(pc.green(`Logged in as ${userLabel(me.user)}${suffix}.`));
    if (me.projects.length > 0) {
      console.log(
        pc.dim(
          `Access to ${me.projects.length} project${me.projects.length === 1 ? "" : "s"}. Run \`synchain project ls\` to list.`
        )
      );
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      console.error(pc.red("Login failed: invalid CLI key."));
    } else if (err instanceof ApiError && err.status === 404) {
      console.error(pc.red("Login failed: /api/user/me not found. Is the server up to date?"));
    } else {
      console.error(pc.red(`Login failed: ${formatApiError(err)}`));
    }
    process.exit(1);
  }
}
