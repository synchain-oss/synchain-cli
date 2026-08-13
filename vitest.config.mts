import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts", "src/__tests__/**/*.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // 排除不可单元测试的交互式/退出路径(12 §2.4「只卡纯逻辑」,06 §4.2 / 09 §3.1):
      //   - src/util/prompt.ts     交互式 prompts(包装 prompts 库,依赖真实 TTY)
      //   - src/index.ts           CLI 入口:首启 banner(TTY)+ uncaught error 的 process.exit(1)
      //   - src/commands/**        各命令 handler 的错误路径统一 process.exit(1)/交互确认
      // 这些文件的纯逻辑仍被对应测试覆盖(正确性),但不计入覆盖率阈值。
      exclude: [
        "src/**/*.test.ts",
        "src/__tests__/**",
        "src/util/prompt.ts",
        "src/index.ts",
        "src/commands/**",
      ],
      thresholds: {
        // 全局:lines/statements ≥ 80(12 §2.4 §8)
        lines: 80,
        statements: 80,
        // 纯逻辑安全模块按文件 ≥ 90(12 §2.4 §8)
        "src/util/sanitize.ts": { lines: 90, statements: 90 },
        "src/util/url.ts": { lines: 90, statements: 90 },
        "src/util/resolve-id.ts": { lines: 90, statements: 90 },
        "src/config.ts": { lines: 90, statements: 90 },
      },
    },
  },
});
