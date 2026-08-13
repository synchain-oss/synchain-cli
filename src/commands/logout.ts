import pc from "picocolors";
import { clearConfig, loadConfig } from "../config.js";
import { promptConfirm } from "../util/prompt.js";
import { apiFetch } from "../api.js";
import { userLabel, type MeResponse } from "./login.js";

export async function runLogout(flags?: { yes?: boolean }): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg || !cfg.token) {
    console.log("You are not logged in.");
    return;
  }

  let who = "the current account";
  try {
    const me = await apiFetch<MeResponse>("/api/user/me");
    who = userLabel(me.user);
  } catch {
    // Fall back to a generic message if we can't reach the server.
  }

  // Confirm interactively, but skip it for `--yes` or when stdin isn't a TTY
  // (CI/agent). Without a TTY, `prompts` can't enter raw mode → returns undefined
  // → the old code printed "Cancelled." and stranded the token file, so scripted
  // logout was impossible. NOTE: this clears only the LOCAL credential; it does
  // not revoke the CLI key server-side (revoke that from Settings).
  const needConfirm = !flags?.yes && Boolean(process.stdin.isTTY);
  if (needConfirm) {
    const ok = await promptConfirm(`Log out of ${who}?`, true);
    if (!ok) {
      console.log("Cancelled.");
      return;
    }
  }

  await clearConfig();
  console.log(pc.green("Logged out."));
}
