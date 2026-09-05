# 变更文档:项目自定义 ID 的 CLI 解析支持(2026-09-05)

> 状态:已获用户批准(2026-09-05,用户裁决「我移植到独立仓再发 0.7.0」)。
> 性质:**additive,零 breaking** —— 新增一个可选响应字段的消费,无端点新增/删除、
> 无字段语义变更、无 scope 变更。老 CLI ↔ 新服务端、新 CLI ↔ 老服务端两个方向都兼容。

## 背景

Synchain 主应用上线了「项目自定义 ID」特性:36 字符的 uuid 念不出口,用户只能复制粘贴,
所以项目在 uuid 之外**再**获得一个可选的短 ID(slug),例如 `my-band`。

关键约束(主应用侧的设计,本仓只需知道结论):

- **uuid 仍然是唯一的 canonical 身份**,自定义 ID 只是入口便利,解析完立刻被丢弃;
- 自定义 ID 的唯一性建在**去连字符**的形态上 —— 认领 `my-band` 同时锁住 `myband`,
  两种写法解析到同一个项目(理由是口语信道:电话里念「my band」听不出有没有连字符);
- 自定义 ID **可变**,uuid 永不改变。

CLI 侧此前完全不认这种串:`synchain project use my-band` 报 `No project matches`,
而同一个串在浏览器里打得开。本次变更补上这条解析通道。

## 契约面改动明细

### 1. `docs/reference.md`(冻结面,2 处)

| 位置 | 改动 | 性质 |
| --- | --- | --- |
| §Projects | 补充自定义 ID 的接受形态、`ref` 列语义、以及三条使用要点(连字符不计入、只做精确匹配、uuid 仍是 canonical) | 文档补充 |
| §Troubleshooting | 新增一条跨命名空间歧义错误的说明 | 文档补充 |

命令名、端点表、scope 表**未动**。

### 2. `src/constants.ts`(冻结面)

**未触碰。** 本次无 URL / 文档深链变化。

## HTTP API 契约影响

**contract-impact: additive(消费侧)。**

CLI 新增消费 `/api/user/me` 响应中 `projects[]` 的一个**可选**字段:

```jsonc
{
  "projects": [
    { "id": "…uuid…", "name": "…", "role": "admin", "customId": "my-band" }
    //                                               ^^^^^^^^ 新增消费;未设置时为 null;
    //                                                        老服务端整个键都不返回
  ]
}
```

- **无端点变化**:仍然只打 `/api/user/me`,方法、鉴权头、scope 全部不变。
- **无字段语义变化**:既有字段一个都没动。
- **类型声明为可选**(`customId?: string | null`)是承重的:CLI 独立发版、无自动发版 CI,
  「新 CLI 打老服务端」是长期常态,那边根本不返回这个键;`apiFetch` 是裸
  `res.json() as T`、没有运行时 schema 校验,声明成必填只会让类型撒谎。
- **两个方向都兼容**:老 CLI 打新服务端会安静忽略这个多出来的键;新 CLI 打老服务端
  拿到 `undefined`,`projectRefLabel` 退回 uuid 前 8 位、解析退回纯 uuid 通道,
  与本次变更之前的行为逐字相同。

### 判定:不满足 CLAUDE.md §5 的 breaking 定义

§5 把 breaking 定义为「改动端点/字段/scope 语义」。本次是**新增消费一个已存在的可选字段**,
三项都不满足。但仍按 §5 ②③ 同步了 `docs/reference.md`、`docs/install-for-agents.md`
与 CHANGELOG。

## 行为影响

| 输入 | 变更前 | 变更后 |
| --- | --- | --- |
| `project use my-band` | `No project matches "my-band".` | 解析到该项目 |
| `project use myband` | 同上 | 同上(去连字符同一口径) |
| `project ls` 的 id 列 | 恒为 uuid 前 8 位 | 改名为 `ref` 列:有自定义 ID 就印它,否则仍是前 8 位 |
| `project use <uuid>` / `<前缀>` | 解析到该项目 | **逐字不变** |
| `synchain-<uuid>` | 不认 | 认(Web 端 Copy ID 在无自定义 ID 的项目上给的就是这个形态) |

`project use` 落盘的 `activeProject.id` **始终是 canonical uuid**,自定义 ID 永远不会
进入任何 API 路径 —— `src/commands/project.ts` 里有一条 `isUuid(resolved.id)` 断言钉住。

## 安全考量

自定义 ID 与 uuid 是两套语义不同的命名空间,**绝不能落进同一个 `startsWith` 候选池**。
混池的后果不是报错,而是**静默切到错误的项目**:一个恰好由十六进制字符组成的短自定义 ID
会同时「精确匹配 A 的自定义 ID」与「前缀匹配 B 的 uuid」,`project use` 之后每一条
`files rm` 都打在别人的项目上。

处置:两条通道各有独立候选池;命中自定义 ID 后**仍然**再查一次 uuid 池,撞上就停下来报
歧义并念出两边的完整 uuid。两个遮蔽方向(自定义 ID 遮 uuid 前缀、uuid 前 8 位被别人的
自定义 ID 遮)都有用例钉住。

主应用今天其实已经整体禁掉了「可能是某个 uuid 合法前缀」的自定义 ID,两个命名空间在设计上
不相交 —— 但本仓**刻意不依赖那条保证**:CLI 独立发版、用户机器上的版本会无限期滞后于服务端
规则,服务端规则也可能再放宽,而更早写进库里的老行不会回溯校验。判据留在本地是唯一不依赖
两个发版节奏同步的写法。

## 批准记录

- 2026-09-05 用户裁决:「我移植到独立仓再发 0.7.0」(在得知 npm `latest` 归本仓、
  单体仓 `cli/` 已不是发布源之后)。
- 本文件入库即视为该裁决的机器可验证留痕。
