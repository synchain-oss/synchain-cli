# Maintainer notes

几条只对本仓维护者有意义的口径。外部贡献者不必读这一篇 —— 你需要的都在
[CONTRIBUTING.md](../CONTRIBUTING.md) 与 [CLAUDE.md](../CLAUDE.md) 里。

## 内部规划编号

本仓的 workflow 注释、配置文件与变更文档里曾散布一批形如 `J20` / `C10` / `ADR-013` /
`12 §2.1` 的编号。它们指向维护者的内部规划文档 —— 不在本仓库内,外部读者无从追溯,
所以已经从公开文本里清掉:对外部读者承重的那几处改写成了自含说明(理由直接写出来),
纯索引的删掉。

需要溯源时参见内部规划文档。写新注释时请把理由本身写出来,不要只留编号 ——
一条读者打不开的引用等于没写理由,而它读起来像写了。

同类的还有 commit message:本仓早期的 commit message 里也有这类编号与内部文档路径。
历史不改,但后续提交不再带。

## runner 版本

所有 workflow 目前固定 `runs-on: ubuntu-latest`,不钉具体镜像版本。是否改为钉版本待定,
口径参见内部规划文档。

## `scripts/check-readme-parity.ps1` 的双文件模式

本仓 README 是单文件双语,只用 `-SingleFile` 模式;脚本里的双文件模式(`-A` / `-B`)
在本仓是死代码。保留而不删,是为了与维护者其他项目共用的同一份脚本保持一致;
要删改这一半,先参见内部规划文档。

## 公开仓库设置

见 [PUBLIC_LAUNCH_SETTINGS.md](./PUBLIC_LAUNCH_SETTINGS.md)。
