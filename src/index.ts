#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Two roles in one file: the `synchain` binary (run main() when invoked as a script) and the
// package entry (`exports["."]`). The CLI itself lives in ./program.js, which the `exports` map
// does not open, so importing the package never exposes the CLI's wiring as API.
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import path from "node:path";

import { main } from "./program.js";

// Invoke only when run as a script (not when imported by tests). Resolve both
// sides to real, absolute paths before comparing — argv[1] can be relative or a
// symlink (e.g. under `npm link`), otherwise the CLI silently exits with code 0.
const invokedAsScript = (() => {
  try {
    if (!process.argv[1]) return false;
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const invokedPath = realpathSync(path.resolve(process.argv[1]));
    return modulePath === invokedPath;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    // 不用 process.exit(1):强制退出会跳过事件循环排水,undici 连接/uv handle 在 Windows 上
    // 触发 libuv 竞态断言(exit-crash)。设 exitCode 让事件循环排空后按码自然退出。
    process.exitCode = 1;
    return;
  });
}

/**
 * The public API of `@synchain/cli`: the typed error hierarchy, the `--format` values, and the
 * shape of `--help --format json`. `exports` opens only `.` and `./package.json`, so anything
 * not re-exported here exists in dist/ but cannot be imported by anyone. The CLI's own wiring
 * is deliberately not re-exported: once exported it would be API to keep stable.
 */
export {
  ApiError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  ServerError,
} from "./api.js";
export type { OutputFormat } from "./output-format.js";
export type { CommandTree, CommandTreeNode, CommandTreeOption } from "./help-json.js";
