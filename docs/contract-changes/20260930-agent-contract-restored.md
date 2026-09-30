# 变更文档:恢复 agent 契约(`--format json`、`--dry-run`、结构化错误、退出码、doctor)(2026-09-30)

> 状态:**设计内容已获所有者批准**(2026-09-30:恢复 agent 契约、结构化错误与退出码分类、
> `--dry-run` 三部分全部做,出 0.9.0;stderr 不是终端时错误默认 JSON,`SYNCHAIN_ERROR_FORMAT`
> 可覆盖;退出码按类别区分;不做 sandbox 模式)。
> ⚠️ 与之相区分:PR 上的 `status/frozen-contract` 标签是 branch-gate 要求的**流程门**,
> 它的解除是维护者动作,与本行的内容批准是两件事 —— 两者状态不同不构成矛盾。
> 性质:**CLI 表面新增 + 两项默认行为变化;HTTP API 契约零变化**。

## 背景

0.4.0–0.5.1 从旧单体仓库发布时,CLI 已经带有一组面向 agent 的能力:全局 `--format json|text`、
`synchain --help --format json`(整棵命令树输出为 JSON)、写命令的 `--dry-run`、按 HTTP 状态
区分的错误子类、随包类型声明。本仓库抽取时的基线取自更早的快照,这组能力在 0.6.0 起**静默
丢失** —— CHANGELOG 与本目录都没有任何删除记录,0.5.1 升到 0.6.0 对脚本是一次无声的倒退。

0.9.0 把它们恢复回来,并补上当年缺的两块:错误的 JSON 信封在 stderr 不是终端时默认生效(当年
只在显式 `--json` 时才有),以及按类别区分的退出码。恢复时刻意没有照搬 0.5.1 的一处实现:当年
靠扫描 argv 里的 `-h` 来拦截 `--help --format json`,会把 `--title -h` 这种**选项取值**误判成
求助、跳过写操作并以 0 退出;现在改由 help 渲染器自己判断格式,`-h` 作为取值时命令照常执行。

## 逐文件改动明细

### 1. `docs/reference.md`(冻结面)

| 位置 | 改动 | 原因 |
| --- | --- | --- |
| §Install | 「From npm (once published)」→「From npm」 | 包早已发布在 npm 上 |
| §Base URL、§Non-interactive | 去掉 `--base-url https://your-synchain.example` 示例;说明默认已是 `https://www.synchain.ca`,只有指向别的部署(测试环境、本机 mock)时才需要 `--base-url`;`http://` 只允许回环地址 | 虚构主机名会被照抄;而非交互 `login` 仍需显式 `--base-url` 才能跳过提示,所以示例改写成默认值本身 |
| §Commands | 帮助说明补 `--help --format json`、`--format json`、`--dry-run`;13 个写命令的用法行加 `[--dry-run]`,并补齐用法行里漏写的 `[--json]`(三个 `rm` 的 `--json` 是新增);Auth 块补 `logout [--yes]` 与 `doctor [--json]` | 与命令树一致 |
| §JSON output & scripting | 补 `--format json`;失败时的描述改为指向分类退出码与 JSON 信封 | 原文「exit non-zero … human-readable message」已不完整 |
| 新增 §Global options | `--format`、`--json`、`--dry-run`、`--base-url`、`--project`、`--yes` 各自的适用范围;环境变量 `SYNCHAIN_TOKEN`、`SYNCHAIN_ERROR_FORMAT`、配置目录变量 | 集中说明跨命令的选项 |
| 新增 §Machine-readable help | 命令树 JSON 的字段 | 新增输出形态 |
| 新增 §Dry runs | 13 个命令与各自的 `action`、文本 / JSON 输出、预演能与不能告诉你什么 | 新增选项 |
| 新增 §Errors | 信封形状、JSON 模式的判定顺序、四个字段、`code` 的来源与对应退出码、孤儿存储 key 的 `warning` 行、导出的错误类 | 新增输出形态 |
| 新增 §Exit codes | 0–8 的类别表 | 默认行为变化 |
| 新增 §`synchain doctor` | 各项检查、`ok` 与退出码、JSON 形状 | 新增命令 |
| §Troubleshooting | 补「stderr 上是一行 JSON」与「脚本里的 `login` 什么都没存」两条 | 默认行为变化带来的新问题 |
| §Publishing | `files` 清单改为 `dist/`、`README.md`、`LICENSE`;`npm pack` → `npm pack --dry-run` | 原文漏了 `LICENSE` |

- 影响:纯文档。命令名、端点、scope 表**未动**。

### 2. `src/constants.ts`(冻结面)

**未触碰。**

### 3. 其余(非冻结面)

`docs/install-for-agents.md`(命令树发现、`doctor`、`--format json`、新增「Safe trial runs」段、
退出码与错误段重写)、`README.md` 中英两段(新增「For scripts and AI agents / 面向脚本与 AI agent」)、
`CHANGELOG.md`(`## Unreleased`)、新增 `context7.json`、`src/util/resolve-id.ts` 一处注释(原先指向
一个不存在的文档段落),以及新增 `src/__tests__/docs-consistency.test.ts`(把上述文档里可机器核对
的部分钉住:两份退出码表一致、`--dry-run` 命令清单、示例 JSON 可解析、`files` 清单与
`package.json` 一致、源码注释引用的文档段落存在)。

## HTTP API 契约影响

**contract-impact: none。**

- 无端点变化,无字段语义变化,无 scope 语义变化;鉴权方式不变(仍是 `Authorization: Bearer`)。
- `--dry-run` 只发真实命令本来就会发的**只读**请求(解析 id 前缀的列表 GET、`files upload` 的
  预签名 GET、`notifications read --all` 读未读数),不发任何写请求。
- `synchain doctor` 不发任何网络请求。
- 结构化错误只改变 CLI 在 stderr 上如何**呈现**服务端的错误,不改变请求本身;`code` 直接取自
  服务端返回体里既有的 `error` 字段,没有新造一张服务端词汇表。

### 两项默认行为变化(CLI 层面,非 HTTP 契约)

1. **stderr 不是终端时,错误默认是一行 JSON**(脚本、CI、agent);`SYNCHAIN_ERROR_FORMAT=text`
   恢复彩色散文。
2. **退出码按类别区分**(2 用法、3 未认证、4 无权限、5 不存在、6 冲突 / 校验、7 限流、8 服务端、
   1 其它);此前所有失败都是 1。只判断「是否为 0」的脚本不受影响,比较 `== 1` 的脚本需要更新。

两项都记入 CHANGELOG 的「Changed」,版本号走 minor(0.9.0)。

### 判定:不满足 CLAUDE.md §5 的 breaking 定义

§5 把 breaking 定义为「改动端点/字段/scope 语义」,三项都不满足。但仍按 §5 ②③ 同步了
`docs/reference.md`、`docs/install-for-agents.md` 与 CHANGELOG。

## 批准记录

- 2026-09-30 所有者批准本轮设计(见本文开头的「状态」)。
- 本文件入库即视为该批准的机器可验证留痕。
