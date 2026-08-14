# 变更文档:C10 · CLI 抽取期冻结面触碰记录(2026-08-14)

> 状态:已获用户批准(2026-08-14,C10 path-guard 决策选项 A「补变更文档」)。
> 性质:**非 API 契约变更** —— 无端点/字段/scope 语义变化,零 breaking;
> 触碰冻结面(src/constants.ts、docs/reference.md)的动因是仓库搬迁,非契约演进。

## 背景

Synchain CLI 从单体仓库 `DLsnows/Synchain`(目录 `cli/`)抽取为独立仓库
`synchain-oss/synchain-cli`(C01/C02/C03)。抽取期间对两份冻结面文件做了路径与
URL 真源修正,以及两处文案澄清。由于 dev 长期停在抽取首 commit,这些改动会整体
出现在 C10 收口 PR(feature/extraction → dev)的 diff 中,触发 branch-gate 的
冻结契约 path guard —— 本文件即其要求的配套变更文档。

## 逐文件改动明细

### 1. src/constants.ts(新增)

dev 首 commit 无此文件;feature/extraction 上由 C02 落地:

```ts
export const REPO_URL = "https://github.com/synchain-oss/synchain-cli";
export const DOCS_AGENTS = `${REPO_URL}/blob/dev/docs/install-for-agents.md`;
export const DOCS_README = `${REPO_URL}/blob/dev/docs/reference.md`;
```

- 变化:仓库 URL 真源从旧单仓改为新仓;文档深链改用 `blob/dev`(09 §1.3 定论)。
- 影响:仅影响帮助/文档链接的展示,不影响任何 HTTP API 端点、字段或鉴权语义。

### 2. docs/reference.md(3 处,19+/10−)

| 位置 | 改动 | 原因 |
| --- | --- | --- |
| §开篇 Source | `cli/` → `src/` 相对路径 | 新仓无 `cli/` 前缀目录 |
| §From source | `cd cli` → `git clone https://github.com/synchain-oss/synchain-cli && cd synchain-cli` | 新仓独立克隆入口 |
| §Errors | `/api/user/me not found` 措辞改为「部署早于 CLI 鉴权端点」类表述 | 原文「deploy the branch that adds them」指向旧单仓分支,新仓下无此分支 |
| §发布说明 | 移除一行 `publishConfig.access` 描述 | 该说明随 C07 版本决策整理,移入 CHANGELOG 口径 |

- 影响:文档措辞与路径,零行为变化。所有命令、端点表、scope 表未动。

## 契约影响判定

- **contract-impact: none**(非契约变更;仅搬迁性修正与文案澄清)。
- 不满足 CLAUDE.md §5「改动端点/字段/scope 语义 = breaking」的定义,故不需要
  CHANGELOG 条目与主仓同步。

## 批准记录

- 2026-08-14 用户裁决 C10 path-guard 红灯处理方式 = 选项 A(补变更文档,合规路径)。
- 本文件入库即视为该裁决的机器可验证留痕。
