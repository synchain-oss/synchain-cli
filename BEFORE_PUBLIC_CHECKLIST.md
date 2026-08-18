# ⚠️ Before Making This Repository Public — Checklist

> 本文件是自动添加的安全提醒。把仓库改成 public 之前，请逐项完成。
> 一旦公开：历史提交、Secrets、CI 行为全部暴露；公开前没做的防护，事后补会有泄露窗口。

## 1. Secret Scanning 与 Push Protection（最重要）
- Settings → Code security and analysis：
  - 开启 **Secret scanning**（public 仓库免费，且会回溯扫描历史提交）
  - 开启 **Push protection**（防止未来误推密钥）
- 开启后到 **Security 标签页**检查历史扫描命中项并逐个处理。
- 本仓库当前有 2 个 Actions secrets：公开前确认没有密钥出现在代码或历史中。

## 2. 分支保护
- 给默认分支 `dev` 与未来的生产分支加保护（Settings → Branches）：
  - 强制 PR 合并（单人开发时 required approvals = 0，否则自己无法批准自己的 PR，永久卡死）
  - enforce_admins = true（禁强推、禁删分支，对管理员同样生效）
  - required status checks 先确认该 CI 在目标分支真的会触发再加，否则 PR 会卡住

## 3. GitHub Actions
- `allowed_actions` 保持 `selected`（现已配置）
- fork PR 审批改为 **all_external_contributors**（Settings → Actions → General）
- 第三方 action 全部锁定 commit SHA（本仓库已 pin，后续升级时保持 pin）
- 绝不使用 `pull_request_target`（本仓库已禁用，请保持）

## 4. 依赖安全
- Dependabot alerts + security updates 保持开启（现已配置）

## 5. 历史清扫
- 公开前扫描 git 历史中的敏感信息（secret scanning 回溯 + gitleaks/trufflehog）
- 确认历史中从未提交过 .env、私钥、数据库连接串等