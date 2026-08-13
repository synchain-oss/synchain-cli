# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| latest minor (x.Y.*) | ✅ |
| older | ❌ |

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub Private Vulnerability Reporting:
Security → Report a vulnerability.

备用渠道:security@synchain.ca(仅用于 GitHub 通道不可用时的私下联系)。

## Response targets

- 首次响应:3 个工作日内
- 修复或缓解方案:高危 14 天、中危 30 天
- 披露:修复发布后 7 天公开 advisory(GHSA)

## Scope

- ✅ 本仓库代码中的 CLI key(`synch_live_sk_*`)泄漏路径、路径穿越(files upload/download)、
      ANSI 注入(终端转义)、SSRF(baseUrl 覆盖)、构建脚本/CI 的供应链问题
- ❌ Synchain 平台服务端(闭源)的问题(请通过平台内渠道报告)
- ❌ 用户自行搭建/配置的服务端问题(那是使用问题,见 docs/reference.md)
