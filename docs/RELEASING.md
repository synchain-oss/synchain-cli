# 发版手册(维护者)

`@synchain/cli` 每一次发布(正式版与 rc / beta 预发布)都按本篇走。外部贡献者不必读。
命令用 bash(Windows 上用 Git Bash)在本仓的干净 clone 里执行;`REPO=synchain-oss/synchain-cli`,`V` 是要发的版本号。

## 0. 不变量

- **`prod` = 最新一个已发布的版本**(rc / beta 也算)。它只经 `dev` → `prod` 的 PR 前移:不直接推、不 force push、
  不临时关分支保护。不设 `stage`。
- **tag `vX.Y.Z` 只打在 `prod` 上**,打在那次 `dev` → `prod` 的合并提交上;npm 从这个提交发布。
  所以 `npm view @synchain/cli@X.Y.Z gitHead` == tag 指向的提交 == 发布时的 `prod`。
- **每个版本五处一致**:npm、tag、GitHub Release、`prod`、jsDelivr(第 7 节回读)。缺一处就是没发完。
- 本仓没有 tag 触发的 workflow:推 tag 不会构建也不会发布;`npm publish` 与 GitHub Release 都由维护者手工执行。

## 1. 顺序一览

```
feat/* ──PR(squash)──► dev                                   功能,平时就在做
feat/release-X.Y.Z ──PR(squash)──► dev                        §2 切版本
dev ──PR(merge commit)──► prod                                §3
在 prod 的合并提交上打 tag vX.Y.Z                              §4
npm publish(prepublishOnly 守卫)                             §5
GitHub Release(先 draft,核对后发布)                          §6
purge jsDelivr,五处回读                                       §7
```

发版 PR 一合入 `dev`,就一口气做完 §3–§7,不要隔夜:`dev` 上的文档已经在描述新行为,而 npm 上还是旧版。

## 2. 发版 PR:切版本

```bash
V=X.Y.Z
git fetch origin
git switch -c "feat/release-$V" origin/dev
npm version "$V" --no-git-tag-version
```

- **为什么 `--no-git-tag-version`**:不带它,`npm version` 会在当前分支上提交并打 `vX.Y.Z`。`dev` 受保护(只收 PR),
  这个提交推不上去;发版 PR squash 合并后它也不会出现在 `dev` 上,tag 就指向了一个孤立提交。而 tag 本来就只该打在
  `prod` 的合并提交上(§4)。先例(0.9.0、0.10.0)用的是 `npx -y npm@10 version "$V" --no-git-tag-version`,与 CI 的
  Node 20 自带的 npm 10 一致。
- **CHANGELOG**:把顶部的 `## Unreleased` 改成 `## X.Y.Z - YYYY-MM-DD`,内容不动。日期写计划 npm 发布那天的 **UTC** 日期。
- `git diff --stat` 只应有 `CHANGELOG.md`、`package.json`、`package-lock.json` 三个文件。
- 本地 `npm ci && npm run gates && node dist/index.js --version`,最后一行输出 `X.Y.Z`。`src/__tests__/docs-consistency.test.ts`
  会检查「CHANGELOG 第一个带版本号的标题 == `package.json` 的 version」,只改了一边、或标题漏了日期就红。
- **`npm audit --audit-level=high` 是发版前置条件**,它在 `npm run gates` 里,也是 CI `cli-gate` 的一项,覆盖全部依赖(含 dev 依赖)。
  新的 advisory 随时会出:动手前先看 `dev` 上它还绿不绿;红了就先开一个修依赖的 PR 进 `dev`,再切版本。不要为了发版改用
  `--omit=dev` 或跳过 gates。
- README 中英两半的标题骨架:`(cd scripts && pwsh -NoProfile -File check-readme-parity.ps1 -SingleFile ../README.md)`(CI 不跑它)。
- `git commit -s -a -m "chore(release): $V"`,开 PR → `dev`,标题 `chore(release): X.Y.Z`。必需检查 `cli-gate`、`branch-gate`
  全绿、评论全部解决后 squash 合并;squash 提交的正文保留 `Signed-off-by:`。
- 合并后确认这个提交在 `dev` 上的 CI 也是绿的(push 到 `dev` 会再跑一次):

  ```bash
  M=$(gh pr view <PR 号> -R "$REPO" --json mergeCommit -q .mergeCommit.oid)
  gh api "repos/$REPO/commits/$M/check-runs" --jq '.check_runs[] | select(.name=="cli-gate") | .conclusion'   # success
  ```

## 3. `dev` → `prod`

```bash
gh pr create -R "$REPO" --base prod --head dev --title "release: v$V" --body "<这一版的 CHANGELOG 小节,或指向它的链接>"
```

- `branch-gate` 在 base = `prod` 时**只放行本仓的 `dev`**:其他分支、fork、机器人开到 `prod` 的 PR 一律红。它也是 `prod`
  唯一的必需检查。`ci` 不在这个 PR 上跑(它的 PR 触发面只有 `dev`):同一批提交进 `dev` 时已经验过,§2 最后一步确认的
  `cli-gate` 就是放行依据。
- **DCO** 照常检查这个 PR 的每一个提交,即 `dev` 上自上次晋升以来的全部提交,**merge commit 也不豁免**。把 `feature/*`
  支线以 merge commit 合进 `dev` 时,merge 提交的正文要带 `Signed-off-by:`(`gh pr merge <号> --merge --body "…"`),
  否则要到这一步才红,而那时已无法补签。DCO 读的 commits 接口最多返回 250 个提交,超出的部分不会被检查;每发一版就晋升一次
  `prod`,一个晋升 PR 远到不了这个量。真要攒到接近 250 个提交,先分几次晋升。
- **冻结契约守卫**:这批改动碰了 `src/constants.ts` 或 `docs/reference.md` 时,同一批里必须有新增的
  `docs/contract-changes/<YYYYMMDD>-<slug>.md`。它在进 `dev` 的那个 PR 里已经要求过,正常情况下自然满足。
- **合并用 merge commit**:`gh pr merge <PR 号> -R "$REPO" --merge --body "<一句说明>"`,`--body` 末尾同样带一行
  `Signed-off-by:`。不要 squash(本仓也不允许 rebase):squash 会让 `prod` 与 `dev` 的历史分叉,下一次 `dev` → `prod`
  会把已经发布的提交再带一遍。
- 本仓开了「合并后自动删除 head 分支」;`dev` 的分支保护禁止删除,合并后照样用 `git ls-remote origin refs/heads/dev` 看一眼。

## 4. 打 tag

本仓用注解 tag(v0.9.0、v0.10.0 都是),打在 `prod` 的合并提交上:

```bash
git fetch origin
M=$(git rev-parse origin/prod)
git log -1 --format='%H %s' "$M"                       # 应为刚合并的 dev → prod 合并提交
git tag -a "v$V" "$M" -m "Synchain CLI v$V"
git push origin "v$V"
test "$(gh api "repos/$REPO/commits/v$V" -q .sha)" = "$M" && echo "tag -> prod OK"
```

`npm publish` 之前 tag 打错了,可以 `git push origin :refs/tags/vX.Y.Z && git tag -d vX.Y.Z` 删了重打;publish 之后不再移动。

## 5. `npm publish`

在一个**新的** clone 里、detach 到 tag 上发布。旧工作区里残留的 `dist/`、未提交的改动都可能混进 tarball:

```bash
P=$(mktemp -d)/synchain-cli
git clone --quiet "https://github.com/$REPO.git" "$P"
git -C "$P" switch --detach "v$V"
(cd "$P" && npm ci && npm run gates && npm publish)          # 预发布改用 npm publish --tag next(§8)
```

`npm run gates` 的最后一步是 `npm audit --audit-level=high`:发版 PR 合入之后才出的 advisory 也会让它在这里红,`npm publish`
就不会执行。照 §2 的前置条件处理:停下,先修依赖,不要绕过 gates 去发布。

`npm publish` 在打包之前先跑 `prepublishOnly`,即 `scripts/prepublish-check.mjs`。下面任何一项不过就不发布:

1. 工作区干净(已跟踪文件的改动与未跟踪文件都算;`dist/`、`node_modules/`、`coverage/` 是 ignore 的,不算);
2. `CHANGELOG.md` 的第一个 `## ` 标题就是 `## <package.json 的 version> - YYYY-MM-DD`(顶部还是 `Unreleased` 就失败),
   `package-lock.json` 的版本与之相同;
3. tag `v<version>` 在本地和 `origin` 上都存在,并且都指向 HEAD;
4. HEAD 在 `origin/prod` 上(是 `prod` 的末端或它的祖先)。`origin` 用 `git ls-remote` 现读;读不到、或没有 `prod`,
   都明确报错。

都通过后删掉 `dist/` 重新 `npm run build`,tarball 里只有这个提交构建出来的东西。

- 想提前看结果:`node scripts/prepublish-check.mjs`(严格模式,与真发布相同)。
- `npm publish --dry-run` 也会跑这个守卫:干跑发不出任何东西,所以 1–4 只告警,build 照跑、失败照样红。这样干跑在任何 ref 上
  都能当体检用。
- **不要用 `npm publish --ignore-scripts`**:它同时跳过守卫和 build,npm 会原样打包当时的 `dist/`。
- `npm ci`、`npm pack`、`npm pack --dry-run`、`npm run gates` 都不触发 `prepublishOnly`,CI 不受影响。
- 账号开了 2FA 时 npm 会要一次性验证码。

发布后立刻回读:

```bash
npm view @synchain/cli dist-tags --json                  # 正式版:latest == X.Y.Z
npm view "@synchain/cli@$V" gitHead                      # == §4 的 $M
npm view "@synchain/cli@$V" dist.fileCount               # 与上一版同量级(0.10.0 是 90)
npm view @synchain/cli time --json | grep "\"$V\""       # UTC 发布时刻,Release 正文要写
```

发布时刻若越过了 UTC 零点、与 CHANGELOG 的日期不一致,不改 tag 里的 CHANGELOG,在 Release 正文写明实际发布日。

## 6. GitHub Release

```bash
gh release create "v$V" -R "$REPO" --verify-tag --draft --title "Synchain CLI v$V" --notes-file notes.md
gh release view "v$V" -R "$REPO"                                  # 核对正文;链接都钉 blob/vX.Y.Z
gh release edit "v$V" -R "$REPO" --draft=false --latest           # 正式版
```

- `--verify-tag`:tag 不存在就直接失败,不会顺手在别的提交上新建一个 tag。
- 草稿可以在 tag 推上去之后就建;**发布要等 `npm view` 能看到这个版本**,因为正文里有安装命令。
- 正文照 v0.9.0 的 Release:英文在前,一行 `---`,中文在后;内容只取 CHANGELOG 对应小节,改写成面向用户的句子,
  小节沿用 Added / Changed / Fixed(新增 / 变更 / 修复);首句加粗,一句话说清这一版意味着什么;写明 npm 的实际发布日(UTC);
  链接钉 tag(`https://github.com/synchain-oss/synchain-cli/blob/vX.Y.Z/…`),英文半给 CHANGELOG、命令参考、agent 指南,
  中文半给 CHANGELOG;英文半附安装片段:

  ```bash
  npm i -g @synchain/cli@X.Y.Z      # Node.js >= 20
  synchain --version
  ```
- 正文里不出现任何真实 key,key 一律写 `synch_live_sk_…`。

## 7. jsDelivr purge 与五处回读

官网给 agent 看的说明(`/llms.txt`、`/AGENTS.md`)引用 jsDelivr 上**不带版本号**的 npm README,边缘缓存约 12 小时。
正式版发布后 purge 一次(预发布不改 `latest`,不用 purge):

```bash
curl -s https://purge.jsdelivr.net/npm/@synchain/cli/README.md
curl -sI https://cdn.jsdelivr.net/npm/@synchain/cli/README.md | tr -d '\r' | grep -i '^x-jsd-version:'   # == X.Y.Z
```

然后五处回读:

```bash
T="v$V"
echo "npm      : $(npm view @synchain/cli dist-tags --json | tr -d ' \n')  gitHead=$(npm view "@synchain/cli@$V" gitHead)"
echo "tag      : $(gh api "repos/$REPO/commits/$T" -q .sha)"
echo "prod     : $(git ls-remote "https://github.com/$REPO.git" refs/heads/prod | cut -f1)"
echo "Release  : $(gh release view "$T" -R "$REPO" --json isDraft,isPrerelease -q '"draft=\(.isDraft) pre=\(.isPrerelease)"')  latest=$(gh api "repos/$REPO/releases/latest" -q .tag_name)"
echo "jsDelivr : $(curl -sI https://cdn.jsdelivr.net/npm/@synchain/cli/README.md | tr -d '\r' | grep -i '^x-jsd-version:')"
```

期望(正式版):`latest` == X.Y.Z;`gitHead` == tag == `prod`;Release `draft=false pre=false`,`releases/latest` == `vX.Y.Z`;
`x-jsd-version` == X.Y.Z。

## 8. 预发布(`X.Y.Z-rc.N` / `X.Y.Z-beta.N`)

- 版本号 `npm version X.Y.Z-rc.N --no-git-tag-version`,CHANGELOG 小节 `## X.Y.Z-rc.N - YYYY-MM-DD`。
- `prod` 照样前移(`prod` = 最新已发布,含预发布),tag 照样打在 `prod` 的合并提交上。
- **`npm publish --tag next`**。npm 11 对「预发布版本 + 默认 tag」直接报错(`You must specify a tag using --tag when
  publishing a prerelease version`);更早的 npm 不报错,而是把预发布设成 `latest`,所有 `npm i -g @synchain/cli` 都会装到它。
- Release:`gh release edit "v$V" -R "$REPO" --draft=false --prerelease --latest=false`。正文首句后加一句
  「Pre-release: `npm i -g @synchain/cli` still installs <当前 latest>.」,安装片段写 `npm i -g @synchain/cli@next` 或完整版本号。
- 回读:`next` == X.Y.Z-rc.N,`latest` 不变;`releases/latest` 不变;`prod` == tag。不用 purge jsDelivr。

## 9. 回滚(npm 上发出了坏版本)

npm 的版本发出去就收不回来。回滚 = 让新安装拿不到它 + 告诉已经装了的人:

```bash
npm dist-tag add @synchain/cli@<上一版> latest                       # 新安装回到上一版
npm deprecate @synchain/cli@<坏版> "<原因;请用 <上一版> 或等待 <修复版>>"
npm view @synchain/cli dist-tags --json                               # 回读
gh release edit v<上一版> -R "$REPO" --latest                          # GitHub 的 Latest 指回上一版
gh release edit v<坏版> -R "$REPO" --notes-file <顶部加了警示的正文>
curl -s https://purge.jsdelivr.net/npm/@synchain/cli/README.md         # README 跟着 latest 回退
```

- **`prod` 不回退**,tag 与 tag 里的 CHANGELOG 不改。修复走前进:下一个补丁版走完整流程,在它的 CHANGELOG 小节与 Release
  正文写明坏版本已 deprecated 及原因。
- 撤销 deprecate:`npm deprecate @synchain/cli@<版本> ""`。
- **unpublish 不是回滚手段**:只在发布后 72 小时内、且没有别的包依赖它时才允许,版本号也永远不能再用。

## 10. 补建 Release(npm 已发、GitHub Release 缺失)

v0.10.0 发布时就漏建了 Release(tag 与 npm 都在)。补建前先确认 tag 就是 npm 发布的那个提交:

```bash
T=vX.Y.Z
test "$(gh api "repos/$REPO/commits/$T" -q .sha)" = "$(npm view "@synchain/cli@${T#v}" gitHead)" && echo "tag == npm gitHead"
npm view @synchain/cli time --json | grep "\"${T#v}\""                # npm 的实际发布时刻
gh release view "$T" -R "$REPO"                                        # release not found(也没有残留的 draft)
gh release create "$T" -R "$REPO" --verify-tag --draft --title "Synchain CLI $T" --notes-file notes.md
gh release view "$T" -R "$REPO"
gh release edit "$T" -R "$REPO" --draft=false --latest                 # 补的不是最新版时改用 --latest=false
```

正文照 §6,并写明 npm 的实际发布日、这个 Release 是事后补建的(tag 与 npm 包都没有变):Release 的发布时间是补建那天,
读者只能从正文知道包是哪天发的。jsDelivr 已经是这个版本时不用 purge。

## 11. 历史缺口(不补)

- **0.7.0、0.8.0** 在 npm 上,但没有 tag,也没有 GitHub Release。0.8.0 的 `gitHead`(44d9164)在 `dev` 的历史里;0.7.0 的
  `gitHead`(70d2f82)不在本仓的公开历史里。
- **0.1.0–0.5.1** 发布于 CLI 抽取成独立仓库之前,本仓没有对应的 tag。
- **v0.6.0** 是轻量 tag,它的 Release 是旧格式(只有中文)。v0.9.0 起是注解 tag + 双语 Release。

## 12. 首次建立 `prod`(只做一次;已经有了就跳过)

`git ls-remote origin refs/heads/prod` 有输出就说明已经建好。没有时,从上一个已发布版本(以 GitHub Releases / npm `latest`
为准)的提交切出,不经 PR:

```bash
git fetch origin --tags
git merge-base --is-ancestor 'vX.Y.Z^{commit}' origin/dev && echo "在 dev 的历史里"   # 不在就停下排查
git push origin 'vX.Y.Z^{commit}:refs/heads/prod'
```

然后给 `prod` 配分支保护:必须经 PR 合并(0 审批)、`enforce_admins`、禁止 force push 与删除,必需检查**只设 `branch-gate`**。
不要照搬 `dev` 的必需检查:`cli-gate` 不在 `prod` 的 PR 上跑,设成必需会让 `dev` → `prod` 的 PR 一直 pending。
