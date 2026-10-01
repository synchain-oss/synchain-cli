#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Two roles in one file: the `synchain` binary (run main() when invoked as a script) and the
// package entry (`exports["."]`). The CLI itself lives in ./program.js, which the `exports` map
// does not open, so importing the package never exposes the CLI's wiring as API.
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import path from "node:path";

import { reportError } from "./api.js";

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
  // Imported here rather than at the top: a library consumer's
  // `import { NotFoundError } from "@synchain/cli"` then loads api.js and its helpers only, not
  // every command module plus commander / prompts / mime-types. An import failure lands in the
  // same catch as a failure inside main().
  import("./program.js")
    .then(({ main }) => main())
    .catch((err) => {
      // 没有被任何命令接住的异常也走 reportError:结构化模式下同样是一行信封。
      // reportError 只设 process.exitCode、不调 process.exit():强制退出会跳过事件循环排水,
      // undici 连接/uv handle 在 Windows 上触发 libuv 竞态断言(exit-crash)。
      reportError(err);
      return;
    });
}

/**
 * The public API of `@synchain/cli`: the typed error hierarchy, the `--format` values, the
 * shape of `--help --format json`, and the shape of the JSON error line on stderr
 * (`ErrorEnvelope`). `exports` opens only `.` and `./package.json`, so anything
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
export type { ErrorEnvelope } from "./api.js";
export type { OutputFormat } from "./output-format.js";
export type { CommandTree, CommandTreeNode, CommandTreeOption } from "./help-json.js";
