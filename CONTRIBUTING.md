# Contributing to Synchain CLI

感谢你的关注。本仓库是 Synchain CLI 的公开客户端,欢迎 issue 与 PR。以下是协作约定。

## 0. 语言政策

issue/PR 接受中文或英文;维护者内部沟通用中文。

## 1. 行为准则

参与本项目即视为同意 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 2. 开发者原创声明(DCO)

每个 commit 必须带 `Signed-off-by:` 尾行 —— 用 `git commit -s`。本项目不采用 CLA(不需要额外基础设施,MIT 项目同样适用)。此条由 branch-gate 的 DCO step 机器强制;补救:`git commit -s --amend` 或 `git rebase --signoff`。

## 3. 分支模型

- 内部:主支线 `feature/extraction`,子支线 `feat/<TASK-ID>-<slug>`;子 PR base = `feature/extraction`。
- 外部贡献者:fork → 任意分支名(请不要用 `dev`/`stage`/`prod`/`feature/v1`/`feature/extraction`)→ PR 到 `dev`。维护者会手工加 `external` label 并人工 review;自动化 review 只在维护者分支上运行,首次响应可能较慢。大改动请先开 issue 讨论。

## 4. Commit 规范

`type(scope): 描述`,type 取值:fix / feat / docs / chore / refactor / test / ci / style / perf / revert / harden。描述可中可英。

## 5. 环境搭建

Node.js ≥ 20。`npm ci` 安装依赖,`npm run build` 产出 `dist/`,`npm link` 暴露全局 `synchain` 命令。

## 6. 提 PR 前的本地 gates

与 [CLAUDE.md](./CLAUDE.md) §2 同一份命令清单(单一真源):

```bash
npm ci
npm run typecheck
npm test -- --coverage
npm run build
npm pack --dry-run
npm audit --audit-level=high
```

一键 `npm run gates`。合规扫描(`gitleaks detect` + `pipx run reuse lint`)见 CLAUDE.md §6。

## 7. 评审流程与期望响应时间

维护者会逐条处理 PR 上的所有 comment(包括自动化 review)。首次响应一般在 3 个工作日内;小改动更快,大改动请先开 issue 对齐。

## 8. ★ 冻结契约:哪些 PR 一定不会被接受

- 不接受降低安全测试覆盖的 PR。
- 不接受把 CLI key 打印到 stdout / 日志 / 错误信息的 PR。
- 不接受绕过 URL scheme 白名单的 PR。

## 9. 发布流程(仅维护者)

见 `docs/reference.md` 的「Publishing (maintainers)」一节;版本号在 `package.json`。
