## 这个 PR 做了什么
<!-- 一段话。关联 issue: Closes #___ -->

## 变更类型
- [ ] fix  - [ ] feat  - [ ] docs  - [ ] refactor  - [ ] test  - [ ] ci  - [ ] chore

## 本地 gates(逐项贴结果)
- [ ] `npm run typecheck` 成功
- [ ] `npm test -- --coverage`(vitest,阈值见 CLAUDE.md §8)全绿
- [ ] `npm run build` 成功
- [ ] `npm pack --dry-run` 只含 dist/ + README.md + LICENSE + package.json
- [ ] `npm audit --audit-level=high` 通过

## 安全测试自查(触碰命令/网络/路径/输出时必填)
- [ ] 未打印 CLI key 到 stdout / 日志 / 错误信息(一律掩码)
- [ ] 未把 Authorization 头或完整响应体回显到错误信息
- [ ] 终端输出已过 ANSI 转义消毒
- [ ] 本地路径已做穿越校验(拒绝绝对路径与 ..\ / ../)
- [ ] baseUrl 走 http/https scheme 白名单,拒绝带凭据 URL

## 截图 / 录屏
## DCO
- [ ] 所有 commit 均已 `git commit -s`(Signed-off-by)
