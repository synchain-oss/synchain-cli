# 变更文档:默认 base URL 改为平台自有域名(2026-09-06)

> 状态:**内容已获所有者批准**(2026-09-06,所有者指示「DEFAULT_BASE_URL 改成 www.synchain.ca 吧」)。
> ⚠️ 与之相区分:PR 上的 `status/frozen-contract` 标签是 branch-gate 要求的**流程门**,
> 它的解除是维护者动作,与本行的内容批准是两件事 —— 两者状态不同不构成矛盾。
> 性质:**默认值变更,非 breaking** —— 端点、字段、scope 语义均未变;已登录用户不受影响。

## 背景

`DEFAULT_BASE_URL` 一直是 `https://synchain.vercel.app` —— 那是**部署域名**,不是平台
对外发布的地址。平台对外发布的自有域名是 `https://www.synchain.ca` —— 这一点由平台自己
公布,不需要引用闭源实现来成立(下面的探测结果是独立证据)。

两者服务的是同一个生产环境,所以从来没有「坏掉」过 —— **这正是它长期无人察觉的原因**。
问题在于取向:部署主机名是实现细节,可以在不通知任何人的情况下退役,而这是 CLI 教给
每一个未配置用户去信任的那个值。

## 上线前的核实

改默认值会影响每一次新登录,所以先确认目标域名确实在服务 CLI 需要的 API:

| 探测 | `www.synchain.ca` | `synchain.vercel.app` |
| --- | --- | --- |
| `GET /api/user/me`(带 dev 环境的 key) | `401 {"error":"Unauthorized"}` | `401` |
| `GET /api/definitely-not-a-route` | `404` | `404` |
| `GET /` | `200` | `200` |

401 而非 404 说明路由存在;不存在的路由返回 404 说明这个 401 是针对性的、不是「什么都
401」。两个域名逐项一致。`https://synchain.ca`(无 www)301 到 `https://www.synchain.ca`。

### 补验:上传与下载(评审指出首轮只覆盖了小请求)

首轮只探了 `/api/user/me`。文件传输是另一条路径,而且**上传与下载并不对称**:

- **上传**:`GET …/files/upload-url`(presign,小请求)→ `PUT` 到响应里的 `uploadUrl`
  —— 那是 API 指过去的对象存储主机,**字节不经过 base URL**;→ `POST …/files` 注册
  (小请求)。所以 base URL 只承载两个小请求。
- **下载**:`src/commands/files.ts` 用 base URL 直接拼 `GET …/files/<fileId>`,
  **字节流是真的穿过 base URL 的**。这一条才是评审那句话真正指向的风险。

探测(未鉴权,只判路由存在性):

| 路由 | `www.synchain.ca` | `synchain.vercel.app` |
| --- | --- | --- |
| `GET …/files/upload-url?name=…&size=…&type=…` | `401` | `401` |
| `GET …/files/<fileId>`(下载) | `401` | `401` |
| `GET …/files` | `401` | `401` |

响应头比对(排除 `date`/`x-vercel-id` 等每请求变化项):两域均为 `Server: Vercel`、
`X-Matched-Path` 相同 —— **自有域名前面没有额外的代理/CDN 层**,因此不引入新的
流式传输或请求体积限制。唯二差异与 CLI 无关:`synchain.vercel.app` 多一个
`X-Robots-Tag: noindex, nofollow`(刻意不索引部署域名,反过来印证自有域名才是对外
的那一个),以及两者 HSTS 指令不同。

**未能覆盖的部分(如实记录)**:带鉴权的端到端上传/下载没有对生产环境实测 —— 手头的
CLI key 是 dev 环境的,打生产两个域名都会 401。上面的结论是「路由存在性 + 无额外代理
层」这一层,不是「传过一个真实文件」。

## 改动明细

### 1. `src/config.ts`(**非冻结面**)

```diff
-export const DEFAULT_BASE_URL = "https://synchain.vercel.app";
+export const DEFAULT_BASE_URL = "https://www.synchain.ca";
```

### 2. `src/commands/help.ts` 与 `src/index.ts`(**根因**)

这个值原本存在于**三处**:一个常量 + 两处硬编码的帮助文案。

```diff
-"Interactive prompts: base URL (default https://synchain.vercel.app) and CLI key.",
+`Interactive prompts: base URL (default ${DEFAULT_BASE_URL}) and CLI key.`,

-.option("--base-url <url>", "Base URL (default https://synchain.vercel.app)")
+.option("--base-url <url>", `Base URL (default ${DEFAULT_BASE_URL})`)
```

两处改成读常量。**只改值不改这个结构的话,漂移会原样复发** —— 那两条帮助文案本来就是
这样和常量脱节的。

### 3. `docs/reference.md`(冻结面,1 处)

§Authenticate 里描述登录提示默认值的那句。命令名、端点表、scope 表**未动**。

### 4. `src/constants.ts`(冻结面)

**未触碰。**

### 5. 其余

`docs/install-for-agents.md` 的 `--base-url` 说明、`README.md` 双语各一处服务端地址描述。

### 6. 新增 `src/__tests__/default-base-url.test.ts`(6 条)

- 常量是平台自有 https origin、无尾随斜杠、不含 `vercel.app`;
- **结构性断言**:`index.ts` / `commands/help.ts` / `commands/login.ts` 三个面向用户的文件
  里不允许出现任何主机名字面量 —— 守的是「值又被复刻出去」这个**故障形态**,而不只是
  这一次的值。

## HTTP API 契约影响

**contract-impact: none。**

- 无端点变化:仍是同一组 `/api/...`,方法、鉴权头、scope 全部不变;
- 无字段语义变化;
- **已登录用户不受影响**:`config.json` 里存的 `baseUrl` 是登录当时解析出来的值,它继续
  优先于默认值(`api.ts`:`opts.baseUrl ?? cfg?.baseUrl ?? DEFAULT_BASE_URL`)。升级不会
  把任何人重新指向别处;
- `--base-url` 覆盖行为不变;
- 唯一受影响的是**从未登录过、且不传 `--base-url`** 的调用,它们此后打自有域名 —— 同一个
  生产环境。
- **存量用户不做迁移,这是有意的取舍,不是遗漏。** 已登录用户的 `config.json` 里钉着旧的
  部署域名,升级后仍然打它。之所以不写一段「检测到旧域名就改写 config」的迁移逻辑:那需要
  在用户没有要求的情况下改写用户机器上的凭据文件,而两个域名指向同一个生产环境、旧域名今天
  仍然可用 —— 收益是「配置更整洁」,代价是「CLI 未经许可动了你的 config」。若将来部署域名
  真的要退役,那时的正确做法是给一条明确的提示让用户自己重新 `login`,而不是静默改写。

### 判定:不满足 CLAUDE.md §5 的 breaking 定义

§5 把 breaking 定义为「改动端点/字段/scope 语义」,三项都不满足。但仍按 §5 ②③ 同步了
`docs/reference.md`、`docs/install-for-agents.md` 与 CHANGELOG。

## 批准记录

- 2026-09-06 用户指示:「DEFAULT_BASE_URL 改成 www.synchain.ca 吧」。
- 本文件入库即视为该指示的机器可验证留痕。
