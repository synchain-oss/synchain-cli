// SPDX-License-Identifier: MIT
import pc from "picocolors";
import { promises as fs } from "node:fs";

import { EXIT_CODES } from "../api.js";
import { DEFAULT_BASE_URL, getConfigPath } from "../config.js";
import { evaluateDoctor, type DoctorInput } from "../doctor.js";

export interface DoctorFlags {
  json?: boolean;
}

/**
 * The config file as it is on disk -- not through loadConfig, which turns a parse error into a
 * warning and carries on as if there were no file. Telling those two apart is doctor's job.
 */
async function readRawConfig(p: string): Promise<DoctorInput["config"]> {
  let raw: string;
  let mode: number | undefined;
  try {
    raw = await fs.readFile(p, "utf8");
    mode = (await fs.stat(p)).mode;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return { parseError: (err as Error).message };
  }
  try {
    return { value: JSON.parse(raw) as unknown, mode };
  } catch (err) {
    return { parseError: (err as Error).message, mode };
  }
}

export async function runDoctor(flags: DoctorFlags): Promise<void> {
  const configPath = getConfigPath();
  const report = evaluateDoctor({
    configPath,
    config: await readRawConfig(configPath),
    env: process.env,
    nodeVersion: process.version,
    platform: process.platform,
    defaultBaseUrl: DEFAULT_BASE_URL,
  });

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const c of report.checks) {
      const tag =
        c.status === "ok"
          ? pc.green("ok  ")
          : c.status === "warn"
            ? pc.yellow("warn")
            : pc.red("FAIL");
      console.log(`${tag}  ${c.id.padEnd(18)} ${c.detail}`);
    }
    console.log(
      pc.dim("Offline check only: no request was made. `synchain whoami` verifies the key.")
    );
  }
  // A failed check belongs to none of the request categories: the catch-all code.
  if (!report.ok) process.exitCode = EXIT_CODES.error;
}
