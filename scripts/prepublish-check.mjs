#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// prepublishOnly guard: `npm publish` runs this before it packs anything. The release order it
// enforces is docs/RELEASING.md: the version is cut on dev, dev is merged into prod by PR, the
// tag vX.Y.Z goes on that prod commit, and npm publishes exactly that commit.
//
// What it checks, in order (every failure is listed, then the run stops before building):
//   1. the working tree is clean (tracked changes and untracked files both count; dist/,
//      node_modules/ and coverage/ are git-ignored and do not);
//   2. the first `## ` heading of CHANGELOG.md is `## <package.json version> - YYYY-MM-DD`
//      (an `Unreleased` heading on top means the release cut was not made, so it fails), and
//      package-lock.json carries the same version;
//   3. the tag v<version> exists locally and on origin, and both peel to HEAD;
//   4. HEAD is on origin/prod (the prod tip or one of its ancestors). origin is read live with
//      `git ls-remote`, not from a possibly stale refs/remotes/origin/prod; if origin cannot be
//      read, or has no prod branch, that is reported as such and the check fails.
// Then it deletes dist/ and runs `npm run build`, so the tarball holds only what this commit
// builds (tsc never removes outputs of deleted sources, and npm packs whatever dist/ holds).
//
// When it runs, and when it does not:
//   - `npm publish`: runs, strict. Any failed check exits 1 and npm publishes nothing.
//   - `npm publish --dry-run`: npm still runs prepublishOnly, with npm_config_dry_run=true.
//     A dry run cannot publish, so checks 1-4 only warn there; the build still runs and still
//     fails hard, so the file list npm prints is that of a fresh build. This keeps the dry run
//     usable as a health check on any ref, which is how the publish workflow proposed on
//     feat/C09-publish-workflow uses it: its preflight job runs `npm ci`, `npm run gates` and
//     `npm publish --dry-run`, and only warns about the tag when dry_run is set.
//   - That workflow's real publish job (`npm ci --ignore-scripts`, `npm run build`, then
//     `npm publish --provenance` on a checkout of the tag): runs, strict. actions/checkout of a
//     tag ref fetches the tag itself; origin is the public repository, so `git ls-remote` needs
//     no credentials; if the prod commit is missing from a shallow clone it is fetched below.
//   - `npm publish --ignore-scripts`: skips this guard *and* the build. Never publish that way.
//   - `npm ci` (with or without --ignore-scripts), `npm install`, `npm pack`,
//     `npm pack --dry-run`, `npm run gates`: prepublishOnly is not part of those lifecycles, so
//     CI and the local gates never run this file.
//   - `node scripts/prepublish-check.mjs`: runs, strict -- a preflight before `npm publish`.
//
// This is a guard against mistakes, not a security boundary: --ignore-scripts bypasses it.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REMOTE = "origin";
const PROD = "refs/heads/prod";

// npm exports a non-default config as npm_config_<key> for lifecycle scripts; a user can also
// set it in the environment as NPM_CONFIG_DRY_RUN, which npm reads case-insensitively.
const DRY_RUN = Object.entries(process.env).some(
  ([key, value]) => key.toLowerCase() === "npm_config_dry_run" && /^(true|1)$/i.test(value ?? "")
);

const problems = [];
const notes = [];

// Never let git wait for credentials on a terminal: stdin is not ours during `npm publish`, and a
// hung guard looks like a hung publish. A remote that needs credentials is reported instead.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

/**
 * Runs git in the repository root; returns stdout without its trailing newline, or throws with
 * git's stderr. Only the end is trimmed: `status --porcelain` lines start with a space.
 */
function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

/** git's exit status for commands whose answer is the status (0 = yes, 1 = no). */
function gitStatus(args) {
  return spawnSync("git", args, { cwd: ROOT, env: GIT_ENV, stdio: "ignore" }).status;
}

function stderrOf(err) {
  const text = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
  return text.trim() || String(err && err.message ? err.message : err);
}

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
}

// ---- version -------------------------------------------------------------------------------

const version = readJson("package.json").version;
if (typeof version !== "string" || version === "") {
  console.error("prepublish-check: package.json has no version");
  process.exit(1);
}
const tag = `v${version}`;

// ---- 1. clean working tree -----------------------------------------------------------------

let head = "";
try {
  head = git(["rev-parse", "HEAD"]);
  const dirty = git(["status", "--porcelain", "--untracked-files=normal"]);
  if (dirty !== "") {
    problems.push(
      "工作区不干净(git status --porcelain 非空)。只从干净的 checkout 发布:\n" +
        dirty
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n")
    );
  }
} catch (err) {
  problems.push(`读不到 git 状态(不在 git 工作区里?):${stderrOf(err)}`);
}

// ---- 2. CHANGELOG and package-lock agree with package.json ---------------------------------

const VERSION_HEADING =
  /^##\s+\[?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\]?\s+-\s+\d{4}-\d{2}-\d{2}\s*$/;
try {
  let inFence = false;
  let first = null;
  for (const line of readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    if (!inFence && /^##\s/.test(line)) {
      first = line.trim();
      break;
    }
  }
  if (first === null) {
    problems.push("CHANGELOG.md 里没有任何 `## ` 标题");
  } else if (/^##\s+\[?unreleased\]?\s*$/i.test(first)) {
    problems.push(
      `CHANGELOG.md 顶部还是「${first}」:发版 PR 要把它切成 \`## ${version} - YYYY-MM-DD\``
    );
  } else {
    const m = VERSION_HEADING.exec(first);
    if (!m) {
      problems.push(
        `CHANGELOG.md 的第一个 \`## \` 标题「${first}」不是 \`## ${version} - YYYY-MM-DD\` 的形式`
      );
    } else if (m[1] !== version) {
      problems.push(
        `CHANGELOG.md 最新的版本节是 ${m[1]},package.json 是 ${version}:两者必须相同`
      );
    }
  }
} catch (err) {
  problems.push(`读不到 CHANGELOG.md:${stderrOf(err)}`);
}

try {
  const lock = readJson("package-lock.json");
  const lockVersions = [lock.version, lock.packages?.[""]?.version];
  if (lockVersions.some((v) => v !== version)) {
    problems.push(
      `package-lock.json 的版本(${lockVersions.join(" / ")})与 package.json(${version})不一致:` +
        "用 npm version <版本> --no-git-tag-version 改版本号,它会同时改两处"
    );
  }
} catch (err) {
  problems.push(`读不到 package-lock.json:${stderrOf(err)}`);
}

// ---- 3 and 4. the tag and origin/prod --------------------------------------------------------

if (head !== "") {
  let localTag = "";
  try {
    localTag = git(["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`]);
  } catch {
    problems.push(`本地没有 tag ${tag}(先 git fetch ${REMOTE} --tags)`);
  }
  if (localTag !== "" && localTag !== head) {
    problems.push(`tag ${tag} 指向 ${localTag.slice(0, 7)},不是 HEAD ${head.slice(0, 7)}`);
  }

  let remote = null;
  try {
    const out = git(["ls-remote", REMOTE, PROD, `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
    remote = new Map(
      out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha, ref] = line.split("\t");
          return [ref, sha];
        })
    );
  } catch (err) {
    problems.push(
      `读不到远端 ${REMOTE}(网络?权限?),无法确认 HEAD 在 ${REMOTE}/prod 上、` +
        `${tag} 已推送:${stderrOf(err)}`
    );
  }

  if (remote) {
    const remoteTag = remote.get(`refs/tags/${tag}^{}`) ?? remote.get(`refs/tags/${tag}`);
    if (!remoteTag) {
      problems.push(`${REMOTE} 上没有 tag ${tag}:先在 prod 的合并提交上打 tag 并推送`);
    } else if (remoteTag !== head) {
      problems.push(
        `${REMOTE} 上的 tag ${tag} 指向 ${remoteTag.slice(0, 7)},不是 HEAD ${head.slice(0, 7)}`
      );
    }

    const prod = remote.get(PROD);
    if (!prod) {
      problems.push(`${REMOTE} 上没有 prod 分支:发版提交必须先经 dev → prod 的 PR 进入 prod`);
    } else {
      if (gitStatus(["cat-file", "-e", `${prod}^{commit}`]) !== 0) {
        try {
          git(["fetch", "--quiet", "--no-tags", REMOTE, PROD]);
        } catch (err) {
          problems.push(`取不到 ${REMOTE}/prod 的提交 ${prod.slice(0, 7)}:${stderrOf(err)}`);
        }
      }
      const onProd = gitStatus(["merge-base", "--is-ancestor", head, prod]);
      if (onProd === 1) {
        problems.push(
          `HEAD ${head.slice(0, 7)} 不在 ${REMOTE}/prod(${prod.slice(0, 7)})上:` +
            "只发布经 dev → prod 合并进 prod 的提交"
        );
      } else if (onProd !== 0) {
        problems.push(`无法判断 HEAD 是否在 ${REMOTE}/prod(${prod.slice(0, 7)})上`);
      } else if (prod !== head) {
        notes.push(`HEAD ${head.slice(0, 7)} 在 ${REMOTE}/prod 的历史里,prod 已前移到 ${prod.slice(0, 7)}`);
      }
    }
  }
}

// ---- verdict -------------------------------------------------------------------------------

if (problems.length > 0) {
  const label = DRY_RUN ? "warning (dry run, not blocking)" : "error";
  for (const p of problems) console.error(`prepublish-check ${label}: ${p}`);
  if (!DRY_RUN) {
    console.error(
      `prepublish-check: ${problems.length} 项未通过,不发布 ${version}。流程见 docs/RELEASING.md`
    );
    process.exit(1);
  }
} else {
  console.log(`prepublish-check: ${tag} == HEAD,在 ${REMOTE}/prod 上,CHANGELOG 与版本一致`);
}
for (const n of notes) console.log(`prepublish-check: ${n}`);

// ---- build ---------------------------------------------------------------------------------

rmSync(path.join(ROOT, "dist"), { recursive: true, force: true });
// npm sets npm_execpath to its own CLI for lifecycle scripts; run directly, fall back to PATH.
const build = process.env.npm_execpath
  ? spawnSync(process.execPath, [process.env.npm_execpath, "run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
    })
  : spawnSync("npm run build", { cwd: ROOT, stdio: "inherit", shell: true });
if (build.status !== 0) {
  console.error("prepublish-check: npm run build 失败,不发布");
  process.exit(build.status || 1);
}
