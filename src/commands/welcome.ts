/** First-run welcome banner for the Synchain CLI. */

export const WELCOME_TEXT = [
  "╔══════════════════════════════════════════════════════════╗",
  "║                   Welcome to Synchain CLI                 ║",
  "╠══════════════════════════════════════════════════════════╣",
  "║  Manage Synchain project files, calendar events, and      ║",
  "║  discussion posts from your terminal — built for humans    ║",
  "║  and AI agents alike.                                      ║",
  "║                                                            ║",
  "║  1. Generate a CLI key in Settings → CLI Access            ║",
  "║  2. Run:  synchain login                                   ║",
  "║  3. Run:  synchain --help                                  ║",
  "╚══════════════════════════════════════════════════════════╝",
].join("\n");

// 默认写 stderr（(内部编号)）：banner 是给人看的提示、不是命令数据，写 stderr 从根本上不污染
// stdout / 管道 / --json 输出。
export function printWelcomeBanner(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(WELCOME_TEXT + "\n");
}
