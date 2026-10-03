# 变更文档:`--help` 写明鉴权方式与环境变量(文本 help 三段 + 命令树根节点 `auth` / `environment`)(2026-10-03)

> 状态:**设计内容已获所有者批准**(2026-10-03:文本 `--help` 在命令列表之后加
> Authentication / Environment / Examples 三段;`--help --format json` 的根节点加 `auth` 与
> `environment` 两个字段;`--dry-run` 只出现在一条示例里,并指向 `synchain help safety`;
> `program.description` 不变;包入口不新增导出的类型名)。
> ⚠️ 与之相区分:PR 上的 `status/frozen-contract` 标签是 branch-gate 要求的**流程门**,
> 它的解除是维护者动作,与本行的内容批准是两件事 —— 两者状态不同不构成矛盾。
> 性质:**CLI 表面新增(help 输出与命令树根节点的两个字段);HTTP API 契约零变化**。

## 背景

第一次接触 CLI 的人或 agent,最先要解决的是「怎么登录」。此前顶层 `synchain --help` 只列命令与
文档链接,没有一个字提到鉴权:key 长什么样、在哪生成、CI 里怎么免交互登录、哪些命令读
`SYNCHAIN_TOKEN`,都要再跑 `synchain help login`、或者去翻 README / reference 才知道。
`--help --format json` 同样只有命令树,agent 拿到全部命令,却不知道第一条命令为什么会 `401`。

本次把这些信息放进 `--help` 本身:文本 help 多三段,JSON 命令树的根节点多两个字段。两者由
同一份数据(`src/help-auth.ts`)生成,不会各说各的。

## 逐文件改动明细

### 1. `docs/reference.md`(冻结面)

| 位置 | 改动 | 原因 |
| --- | --- | --- |
| §Machine-readable help | 示例补一行 `synchain --help --format json \| jq '.auth'`;正文在 `version` 那段之后,以「仅根节点」的说明写入 `auth`(逐项说明 `scheme`、`credential`、`env`、`envReadBy`、`login.interactive` / `login.nonInteractive`、`obtain.url` / `obtain.steps`、`verify.offline` / `verify.online`)与 `environment`(`[{ name, description }]`);说明文本 `--help` 在命令列表之后打印同样的内容,JSON 模式下文档之后不再输出任何东西 | 新增输出字段。与 `version` 一样只在根节点出现,所以写进正文,**不加进**「每个节点都有」的字段表 |
| §Global options | 环境变量表的引导句补「`synchain --help` 列出同一组变量,命令树里是 `environment`」 | 两处列表互相指认;表格本身核对过,四个变量与 `environment` 一致,未改 |

- 影响:纯文档。命令名、端点、scope 表**未动**。

### 2. `src/constants.ts`(冻结面)

**未触碰。**

### 3. 其余(非冻结面)

- **`src/help-auth.ts`(新增)**:鉴权说明与环境变量的唯一数据源。`AUTH_HELP` / `ENVIRONMENT_HELP`
  供 JSON 命令树使用,`AUTH_HELP_TEXT` 由同一份数据生成文本 help 的三段,行宽不超过 80 列
  (stdout 不是终端时 commander 也按 80 列折行)。key 只出现省略形态 `synch_live_sk_…`。
  获取地址由 `DEFAULT_BASE_URL` 拼出,不写死主机名。`TOKEN_ENV_VAR` 从 `src/commands/login.ts`
  移到这里,`login.ts` 原样转导出。这个文件不 import `commands/` 下的任何模块:测试会把
  `commands/login.js`、`commands/help.js` 整个替换成桩,经由桩读到的常量是 undefined。
- **`src/help-json.ts`**:`CommandTree` 新增两个必填字段 `auth`、`environment`,类型直接内联在
  `CommandTree` 上,不新增导出的类型名。`buildHelpJson` 把两者放在 `options` 之后、`commands`
  之前(命令树很长,只读开头的 agent 也能看到怎么登录),并返回副本。
- **`src/program.ts`**:根命令文本 help 的 after 段改为「三段 + 原有文档链接」;JSON 模式下仍为空串。
  `program.description` 未改。
- **`src/commands/login.ts`**:`TOKEN_ENV_VAR` 改为从 `help-auth.ts` 导入并转导出,行为不变。
- **`docs/install-for-agents.md`**:§1 根节点字段列表补 `auth`、`environment`;§2 补一句「`--help`
  与 `jq .auth` 给出同样的信息」;§10 汇总表补 `XDG_CONFIG_HOME` / `APPDATA` 一行(与 reference
  的环境变量表、与 `environment` 对齐)。
- **`README.md`**:英文 `## Quick start` 改为 `## Quickstart`,中文「快速上手」同步;两边都是同一条
  从 `npm install -g @synchain/cli` 经 `login`、`whoami`、`project ls`、`project use` 到
  `files upload` 的完整序列,并给出无终端时的 `SYNCHAIN_TOKEN=synch_live_sk_… synchain login`。
  标题层级两侧对称。
- **`CHANGELOG.md`**:新建 `## Unreleased`,Added 记 help 三段、命令树两个字段与 `CommandTree`
  类型的变化,Changed 记 README Quickstart。
- **测试**:
  - `src/__tests__/help-json.test.ts`:根节点有 `auth` / `environment` 且只在根节点、位于
    `commands` 之前;stdout 仍是一份可解析的 JSON;`auth` 里的命令行都指向真实存在的命令;
    `environment` 恰好等于源码实际读取的环境变量;任何格式的 help 都不出现完整形态的 key;
    文本 help 包含 `SYNCHAIN_TOKEN`、`Settings → CLI Access`、`Examples:`,与 JSON 内容一致,
    新增各行不超过 80 列;`--dry-run` 只出现在示例命令行里;子命令的文本 help 不带这三段。
    原 describe「text `--help` is unchanged」改名。
  - `src/__tests__/docs-consistency.test.ts`:字段表比对时把 `auth`、`environment` 与 `version`
    一起当作仅根节点字段排除,并另行断言根节点有这三个字段、正文提到了它们、`auth` /
    `environment` 的每一层字段名都在正文里;reference 与 install-for-agents 的环境变量表都与
    `environment` 一致;README 两半的 Quickstart 命令序列相同;本记录文件存在且写明
    contract-impact。
  - `src/__tests__/default-base-url.test.ts`:`help-auth.ts` 加入「面向用户、不得写死主机名」的
    文件清单。

### 4. PR #54 审查后的补充

- **`src/help-auth.ts`**:`auth.login` 增加 `nonInteractivePowerShell`
  (`$env:SYNCHAIN_TOKEN = "synch_live_sk_…"; synchain login`)。`nonInteractive` 的
  `NAME=value command` 是 POSIX shell 写法,PowerShell 不认。文本 help 把两行并列,
  行尾用 `#` 注释标明 shell(两种 shell 里都是注释,照抄整行仍可运行)。「Without a terminal」
  一句写明 CI 里从 secret 注入 `SYNCHAIN_TOKEN`,不要在 shell 里手敲 key(会留在 history 里)。
  占位符常量 `KEY_PLACEHOLDER` 改为导出。
- **`src/commands/help.ts`**:`synchain help login` 的免交互示例改为读取 `help-auth.ts` 的同一组
  命令行,占位符统一为 Unicode 省略号 `synch_live_sk_…`(原为 ASCII `...`)。
- **`docs/reference.md`**(冻结面):§Non-interactive 补 PowerShell 写法与「CI 从 secret 注入」;
  §Machine-readable help 的 `login` 一项补 `nonInteractivePowerShell`。
- **`docs/install-for-agents.md`**、**`README.md`**(两半)、**`CHANGELOG.md`**:同步上述内容。
- **测试**:`help-json.test.ts` 断言两种写法都在 JSON 与文本 help 里、命令都指向 `login`;
  `login.test.ts` 断言 `help login` 与 `--help` 的命令行和占位符一致;`docs-consistency.test.ts`
  断言 README 两半都给出两种写法(字段名出现在 reference 正文由已有用例覆盖)。

## HTTP API 契约影响

**contract-impact: none。**

- 无端点变化,无字段语义变化,无 scope 语义变化;鉴权方式不变(仍是 `Authorization: Bearer`)。
- 改动只涉及 help 的输出:文本 help 多三段,`--help --format json` 的根节点多两个字段。help 不发
  任何网络请求。
- 没有任何命令的行为、参数、退出码或错误信封发生变化。

### 对 CLI 使用方的影响

1. **文本 `--help`**:根命令的输出变长(命令列表与文档链接之间多三段)。子命令的 `--help` 不变。
   文本 help 不是契约,只供人读。
2. **`--help --format json`**:根节点多 `auth`、`environment` 两个键,位于 `options` 与 `commands`
   之间;原有键的含义与相对顺序不变,子节点不变。按键名读取的使用方不受影响。
3. **TypeScript 类型**:`CommandTree` 多两个必填字段。只读取命令树的代码不受影响;自己构造
   `CommandTree` 字面量的代码(例如测试桩)需要补上这两个字段。包入口导出的名字不变。

版本号走 minor(下一个版本 0.10.0),由维护者在发版时切出版本段。

### 判定:不满足 CLAUDE.md §5 的 breaking 定义

§5 把 breaking 定义为「改动端点/字段/scope 语义」,本次三项都不涉及。但仍按 §5 ②③ 同步了
`docs/reference.md`、`docs/install-for-agents.md` 与 CHANGELOG。

## 批准记录

- 2026-10-03 所有者批准本轮设计(见本文开头的「状态」)。
- 本文件入库即视为该批准的机器可验证留痕。
