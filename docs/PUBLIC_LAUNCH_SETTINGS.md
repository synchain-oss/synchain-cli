# 公开仓库设置(维护者)

本文件列出 `@synchain/cli` 这个仓库作为**公开**仓库时,GitHub 侧应当保持的设置。

它写的是**目标状态**,刻意不记录任何一项当前是否已经启用,也不记录 Actions secrets 的
名称或数量 —— 那类信息属于仓库配置面,写进一份会随仓库分发的文件里,等于替读者做了一遍
攻击面盘点。需要核对现状的人请直接打开 Settings。

下面几节按建议的执行顺序排列:前两节决定「误推进来的凭据会不会被拦下」,越早生效,窗口越短。
改这些设置需要仓库 admin 权限。

## 1. Code security

- **Secret scanning** — 开启。公开仓库免费,并且会回溯扫描既有提交。
- **Push protection** — 开启,拦下未来误推的凭据。
- **Private vulnerability reporting** — 开启。`SECURITY.md` 把它列为首选上报通道;
  未开启时 Security 标签页不会出现 "Report a vulnerability" 按钮,报告者就只剩
  `SECURITY.md` 第一句禁止的那条路(开 public issue)。
- 开启 secret scanning 之后,回 Security 标签页把回溯命中项逐条处理掉。

## 2. 分支保护(默认分支 `dev`)

- 强制经 PR 合并。
- required approvals = **0**。单人维护时若要求 ≥ 1,维护者无法批准自己的 PR,分支会永久卡死。
- enforce_admins = **true**(禁强推、禁删分支,对 admin 同样生效)。
- required status checks 用两个稳定 context:
  - `cli-gate` —— `.github/workflows/ci.yml` 的聚合 job,`needs` 列全了其余各 job;
  - `branch-gate` —— `.github/workflows/branch-gate.yml`,该 job 名标注为永不改名。

  两者在 base = `dev` 的 PR 上都会触发,不会把 PR 卡在 "Expected — Waiting for status"。

## 3. Actions

- `allowed_actions` 保持 `selected`,白名单只留仓内 workflow 真正引用的 action;
  引用被删掉之后,白名单条目也一并删掉。
- **Fork pull request workflows from outside collaborators** = **Require approval for all
  external contributors**。`ci.yml` 会对 fork PR 跑 `npm ci`,这条审批是其中一层防线
  (另一层是 `ci.yml` 里的 `--ignore-scripts`)。
- 第三方 action 一律 pin 到 40 位 commit SHA,行尾注释写版本号便于 dependabot 升级;
  升级时保持 pin。规则原文见 `CLAUDE.md` §0。
- 不使用 `pull_request_target`。

## 4. General / Features

- **Allow forking** — 开启。`CONTRIBUTING.md` 与 `branch-gate.yml` 的外部贡献者流程都以
  fork 为前提;仓库从私有转公开时这个开关不会自动改。
- **Discussions** — 开启;若不打算开,就把 `.github/ISSUE_TEMPLATE/config.yml` 里指向
  Discussions 的 contact link 删掉,否则那是一条 404,而 `blank_issues_enabled: false`
  正把不想用模板的人推向它。
- **Automatically delete head branches** — 开启,并顺手清掉已合并的远端分支。

## 5. 依赖与账号

- Dependabot alerts + security updates 保持开启。
- org 层面开启 **Require two-factor authentication**。

## 6. 凭据扫描的覆盖面

- `ci.yml` 的 `compliance` job 用 `gitleaks detect --no-git` —— 只扫**工作树**;
- 全历史由 `ci.yml` 的 `secret-history` job 覆盖(同一份 `.gitleaks.toml`,不带 `--no-git`,
  需要完整克隆)。
- 开启 secret scanning 后 GitHub 侧还会独立回溯扫一遍。三者结论不一致时以人工复核为准,
  误报请登记进 `.gitleaks.toml` 的 `[allowlist]` 并写明理由,不要用 `--no-verify` 绕过。
