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
- **Private vulnerability reporting** — 开启。`SECURITY.md` 把它与邮件并列为两条私密通道,
  未开启时 Security 标签页不会出现 "Report a vulnerability" 按钮(此时报告者退回邮件通道)。
  开启的价值在于它自带 GHSA 草稿、私密补丁分支与 CVE 申请,邮件通道没有这些。
- 开启 secret scanning 之后,回 Security 标签页把回溯命中项逐条处理掉。
- **`security@` 别名**:`SECURITY.md` 目前把邮件通道指向 `contact@synchain.ca`。若能建一个
  专用别名,建它并把 `SECURITY.md` 改指过去 —— 专用地址可以单独限定收件人与路由,
  而通用联系箱通常更多人可读。

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
  external contributors**。`pull_request` 下 workflow 定义取自 PR head,fork 作者能加任意
  `run:` 步骤,**这条审批就是那层防线**,没有别的。(`ci.yml` 里的 `--ignore-scripts` 收窄的是
  依赖侧的面,挡不住这一条。)
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
- `ci.yml` 的 `secret-history` job 扫 **git 历史**(完整 clone + 同一份 `.gitleaks.toml`,
  不带 `--no-git`)。口径:它扫的是 **HEAD 可达的祖先**,不是所有 remote ref ——
  只存在于从未合入 `dev` 的旁支上的东西,这条扫不到。
- 所以翻公开**之前**再单独跑一次覆盖全部 ref 的扫描:完整 clone 后
  `gitleaks detect --redact -v --config .gitleaks.toml --log-opts=--all`。
  没把它写进 CI,是因为那样一来,一条从不打算合并的旁支上的命中会让 `cli-gate` 对每个 PR 常红,
  而处置是人的判断。
- 开启 secret scanning 后 GitHub 侧还会独立回溯扫一遍。几者结论不一致时以人工复核为准,
  误报请登记进 `.gitleaks.toml` 的 `[allowlist]` 并写明理由,不要用 `--no-verify` 绕过。

## 7. 翻公开前的一次性处置(不是设置项)

> 本节是一次性动作,不是需要长期保持的设置:它描述的东西一旦处理完就不再成立,而留在一份
> 会随仓库公开分发的文件里,它本身就是一条指路牌。**抹掉它必须由那次历史改写本身完成** ——
> 若等改写之后再另提一个 commit 删掉它,或在改写序列的最后一个 commit 里删掉它,那都只是把
> 它从工作树移走,内容仍留在公开后可读的历史里,正是「git 历史」那一条描述的情况。
> 注意这与「git 历史」那一条**不是同一种操作**:那份 ops 文档整文件从历史里拿掉即可
> (`--path`),而本文件必须留下、要抹的只是其中一节,需要内容级过滤把 §7 从这份文件的
> **每一份 revision** 里去掉 —— 用 blob callback 而不是 `--replace-text`:后者默认把命中
> 替换成占位串而不是删掉,跨行还得自己把正则写成 `[\s\S]*` 这种形态才吃得住。

- **git 历史**:本仓历史里有过一份内部 ops 待办文档,记录了当时的安全配置状态。文件已从
  工作树移除,但内容仍在 git 历史里,仓库一转公开即可取回。上一节的 `secret-history`
  覆盖不到它 —— 那条找的是凭据,不是配置现状。要真正清掉只能改写历史,必须排在
  「点 public」**之前**。
- **PR / issue 讨论区**:仓库转公开时它们一并公开,而历史改写动不到这部分 —— 那是 GitHub
  侧的数据,不在 git 对象库里。上一条那份文档的内容、以及本节自己的全文,在若干 PR 描述与
  review thread 里被复述过。翻公开前按同一口径复核一遍,注意两者的可行动作不同:
  **评论**直接删除,不要编辑 —— 被编辑过的内容会留一份修订历史,任何能看到它的人都点得开,
  编辑等于没删;**PR 描述**删不掉(PR 本身也不能删),只能先编辑掉那段文字,再逐条清掉该
  条目的修订历史 —— 那是第二个动作,不会随编辑自动发生。否则历史清干净了、讨论区还留着。
- 同一次改写里把历史中其他不该公开的内容一并处理掉,别分两次:每次改写都会换掉全部
  commit SHA,连带废掉已有 tag、已合并 PR 的引用,以及任何已存在的 clone/fork。
- 上一节最后那条覆盖全部 ref 的一次性扫描,也在这个时间点做。
