# CLAUDE.md — Synchain CLI 工作规范

本文件是本仓库内 AI 编码代理的工作规范;与用户口头/书面指令冲突时以用户为准。

## 0. 基本约定

- 沟通语言:中文。面向外部贡献者的 issue/PR 回复,用对方使用的语言。
- Git 提交身份:`DLsnows`。
- 技术栈:Node.js ≥ 20、TypeScript(ESM)、commander、vitest。

### §0 安全铁律(三仓逐字相同,真源 = 12 §2.1 / 06 §8.4)

1. 任何 key/token 绝不明文入库,包括测试用的假 key(secret scanning push protection 会直接拒推)。
2. workflow 里引用 secret 只能用 ${{ secrets.X }};禁止 echo 到日志、禁止写进 artifact。
3. 新增第三方 action 必须 pin 到 40 位 commit SHA(注释写版本号便于 dependabot 升级);
   @v2 / @main 这类可变 ref 一律不接受,org 白名单里的 owner/repo@* 通配不构成防护。
4. 【J20 安全禁令,ADR-011 v1 新增安全条款】任何 workflow 一律不得使用 pull_request_target。
   这不是"不推荐"、不是"审计过就能用" —— 本项目不接受逐版本审计作为豁免理由。
   fork PR 的 AI 审查只走 §6.2 方案 D(维护者 /review 显式触发)或方案 C(workflow_run 两阶段,
   全程不 checkout PR 代码);其余情况 fork PR 只跑无 secrets 的构建/测试(J31)。
   机器检查:grep -r pull_request_target .github/workflows 零命中(06 §2.4 checklist + CI 断言)。
5. 所有消费仓库外部文本的自动化(review bot、issue 分流、release notes 生成)的 prompt 末尾
   必须带「不可信数据声明」(06 §3.4 固定结尾);issue 分流 agent 额外受操作白名单约束(§6.1)。

## 1. 分支模型与工作流程

- dev 为默认主干(无 stage/prod)。主支线 = `feature/extraction`(J13);子支线 = `feat/<TASK-ID>-<slug>`(ADR-013)。
- same-repo PR:仅接受 `feat/*` | `feature/*` 来源;另放行 `dependabot/*`。
- fork PR(J31/J41):免除 `feat/*` 命名规则,但 head 分支名不得为 `dev`/`stage`/`prod`/`feature/v1`/`feature/extraction`;只跑无 secrets 的构建/测试,review bot 不自动跑,维护者手工加 `external` label。
- branch-gate(required context)还承担 DCO(Signed-off-by)与冻结契约 path guard 两条断言。
- commit 规范:`type(scope): 描述`,描述可中可英;必须 `git commit -s`(DCO)。

## 2. 提 PR 前的本地 Gates

子 PR(base = `feature/extraction`)不触发完整 CI(D2),本地必须跑:

```bash
npm ci
npm run typecheck
npm test -- --coverage        # vitest + 覆盖率阈值(见 §8)
npm run build
npm pack --dry-run
npm audit --audit-level=high
```

一键:`npm run gates`(package.json 里串起来,C02 交付)。合规扫描(gitleaks + reuse lint)见 §6,不进 `npm run gates` 字符串。

## 3. 评审规则

处理完所有 comment(不止 review bot 的),逐条回复/修改/标记 Resolve(D2)。子 PR 上未 Resolve 的 comment 会禁用 merge 按钮(`feature/extraction` 生命周期保护)。

## 4. 各 Workflow 触发范围一览

| workflow | runner | 触发 | 说明 |
| --- | --- | --- | --- |
| `ci` | `ubuntu-latest` × node 20/22 + `windows-latest` × node 20 | PR → dev;push → dev、feature/** | jobs:checks / smoke / no-stale-refs / audit / compliance / secret-history / 聚合 cli-gate。fork PR 允许运行(无 secrets) |
| `branch-gate` | `ubuntu-latest` | PR → dev | 分支命名 + DCO + 冻结契约 path guard;fork PR 免除命名但不得用保留长期分支名 |
| `claude-review` / `deepseek-review` | `ubuntu-latest` | same-repo PR | 二选一 enable(U8);fork PR 不跑 |
| `pr-agent` | `ubuntu-latest` | same-repo PR | docker action,必须 latest;fork PR 不跑 |
| `review-dispatch` | `ubuntu-latest` | `issue_comment`(`/review`,评论者 ∈ {OWNER,MEMBER,COLLABORATOR}) | fork PR 唯一 AI 审查通道 |

成本纪律:runner 就低不就高;按量计费 bot 克制。

## 5. API 契约变更规范

CLI 与 Synchain 主应用之间没有代码级 import,只有一份运行时 HTTP API 契约。所有端点/字段/scope 语义以 `docs/reference.md`(公开命令参考)为准。改动端点/字段/scope 语义 = breaking change,必须:① 先获用户明确批准;② 同步 `docs/reference.md` 与 `src/constants.ts`(冻结面)与 `docs/install-for-agents.md`;③ 记 CHANGELOG。鉴权基础设施(CLI key 生成、Bearer 校验、scope 判定)位于闭源主仓,本仓不得假设其实现。

## 6. 环境与依赖

| 项 | 值 |
| --- | --- |
| 运行时 | Node ≥ 20、npm |
| 本地 gates | npm ci / typecheck / test --coverage / build / pack --dry-run / audit(§2) |
| 合规扫描 | 工作树:`gitleaks detect --no-git --redact --config .gitleaks.toml`;git 历史(HEAD 可达祖先):同命令去掉 `--no-git`(需完整 clone)。版本钉 .gitleaks-version。另 `pipx run reuse lint`。三条都不进 npm run gates 字符串 |
| CI secrets | CLAUDE_CODE_OAUTH_TOKEN、DEEPSEEK_KEY(review bot)。发布目前由维护者本地手工执行,不经 CI(仓内无 publish workflow) |
| 为什么强调本地 | 子 PR 不触发完整 CI;npm audit 与覆盖率阈值是 CI 硬门禁,本地先过 |

## 7. 安全铁律

1. 凭据 —— CLI key 形如 synch_live_sk_<48 hex>。
   · 绝不打印完整 key 到 stdout/stderr/日志/错误信息/调试输出,一律掩码(前 8 + 后 4)。
   · 绝不把 Authorization 头或完整响应体回显到错误信息里。
   · 配置文件在 POSIX 上创建后必须 chmod 0600;Windows 上写入用户 profile 目录。
   · 禁止把 key 作为命令行参数接收(会进 shell history 与进程列表);
     只接受环境变量(CI 免交互)或 prompts 的隐藏输入。
2. URL —— baseUrl 可被用户覆盖 ⇒ SSRF 面。
   scheme 白名单只允许 http/https;禁止 file:/javascript:/data:;
   拒绝带凭据的 URL(user:pass@);重定向不得跨 origin 自动跟随。
3. 路径 —— files upload/download 的本地路径必须做穿越校验:
   规范化后不得逃出用户指定的目标目录;拒绝绝对路径与 ..\ / ../ 组合;
   远端返回的文件名不得直接用于本地落盘(需消毒)。
4. 终端输出 —— 一切来自服务端的字符串(文件名、讨论内容、成员昵称)
   在打印前必须过 ANSI 转义消毒,防止终端转义注入。
5. 依赖 —— 新增运行时依赖必须在 PR 描述里论证必要性,且 npm audit --audit-level=high 通过。

## 8. 测试规则

每新增或修改一个子命令 / 一个网络调用 / 一处用户输入解析,必须同时补齐对应的测试:

| 改动类型 | 必补测试(沿用现有文件的模式) |
| --- | --- |
| 新命令 / 改参数解析 | src/__tests__/commander.test.ts |
| 任何网络调用 | api.test.ts(鉴权头、错误码、超时) |
| 任何打印服务端字符串 | sanitize.test.ts(ANSI 注入用例) |
| 任何接受 URL / baseUrl | url.test.ts(scheme 白名单 + 拒绝用例) |
| 任何接受本地路径 | files.test.ts(路径穿越用例) |
| 任何接受 id / 前缀 | resolve-id.test.ts(歧义前缀、空匹配) |
| 任何读写配置 | config.test.ts(权限、掩码、缺省) |

覆盖率门槛(vitest,仿主仓"只卡纯逻辑"的思路):
· 纯逻辑安全模块(sanitize / url / resolve-id / config)≥ 90%
· src/ 整体 ≥ 80%
· 交互式 prompts 与 process.exit 路径排除在 include 之外
不达标 → CI 红,不得合并。
