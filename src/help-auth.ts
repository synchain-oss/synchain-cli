// SPDX-License-Identifier: MIT
/**
 * How to authenticate, and which environment variables the CLI reads: what someone meeting the
 * CLI for the first time -- a person or an agent -- needs before any other command will work.
 *
 * One source for both renderings of the root help. Text `synchain --help` prints it as the
 * "Authentication:", "Environment:" and "Examples:" blocks; `synchain --help --format json`
 * carries the same data as the root's `auth` and `environment`. However `--help` is asked, the
 * answer to "how do I log in" is the same one.
 *
 * Imports nothing from `commands/`: tests replace `commands/login.js` and `commands/help.js` with
 * stubs, and a constant read through such a stub is undefined. That is also why `TOKEN_ENV_VAR`
 * lives here and `commands/login.ts` re-exports it.
 */
import { DEFAULT_BASE_URL } from "./config.js";
import type { CommandTree } from "./help-json.js";

/**
 * Env var used by CI / agents to pass a CLI key without an argv flag. Only `login` takes the key
 * from it; `doctor` reads it too, but only to check it against the stored key and point at `login`.
 */
export const TOKEN_ENV_VAR = "SYNCHAIN_TOKEN";

/**
 * The key's shape with the secret part elided. Never a full-length key, not even a fake one:
 * secret scanning rejects the full form, and this elided form is the documented placeholder.
 */
const KEY_PLACEHOLDER = "synch_live_sk_…";

/** The root's `auth` in `--help --format json`; the text help's "Authentication:" block. */
export const AUTH_HELP: CommandTree["auth"] = {
  scheme: "Bearer",
  credential: `CLI key (${KEY_PLACEHOLDER})`,
  env: TOKEN_ENV_VAR,
  envReadBy: ["login"],
  login: {
    interactive: "synchain login",
    nonInteractive: `${TOKEN_ENV_VAR}=${KEY_PLACEHOLDER} synchain login`,
  },
  obtain: {
    url: `${DEFAULT_BASE_URL}/settings`,
    steps: "Settings → CLI Access → Generate. The key is shown once: copy it then.",
  },
  verify: {
    offline: "synchain doctor",
    online: "synchain whoami",
  },
};

/**
 * The root's `environment`; the text help's "Environment:" block. Every variable the CLI reads,
 * and only those (help-json.test.ts checks the list against the source).
 */
export const ENVIRONMENT_HELP: CommandTree["environment"] = [
  {
    name: TOKEN_ENV_VAR,
    description:
      "CLI key for a non-interactive login. Only synchain login takes the key from it; every " +
      "other command uses the stored key.",
  },
  {
    name: "SYNCHAIN_ERROR_FORMAT",
    description:
      "json | text: the format of errors on stderr. Unset: json when stderr is not a terminal, " +
      "text when it is.",
  },
  {
    name: "XDG_CONFIG_HOME",
    description:
      "POSIX: the config lives in $XDG_CONFIG_HOME/synchain (default ~/.config/synchain).",
  },
  {
    name: "APPDATA",
    description: "Windows: the config lives in %APPDATA%\\synchain.",
  },
];

/**
 * Example command lines for the text help. `--dry-run` appears here and nowhere else in the root
 * help; what it does and does not rehearse is `synchain help safety`'s job, so the help points
 * there rather than restating it.
 */
const EXAMPLES = [
  "synchain login",
  "synchain project ls --json",
  "synchain files upload ./mix.wav --dry-run",
] as const;

/**
 * Line width of the blocks below. Commander wraps its own help to the terminal, or to 80 columns
 * when stdout is not one (a pipe, an agent reading the output); text written after it is printed
 * as is, so it keeps to the narrower of the two by itself.
 */
export const HELP_TEXT_WIDTH = 80;

/** `text` broken at spaces into lines of at most `room` characters (a longer word stays whole). */
function wrap(text: string, room: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (current && current.length + 1 + word.length > room) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Two columns laid out the way commander lays out its option and command lists: names padded to
 * a shared width, descriptions wrapped and continued under themselves.
 */
function columns(rows: ReadonlyArray<readonly [string, string]>): string[] {
  const width = Math.max(...rows.map(([left]) => left.length));
  const room = HELP_TEXT_WIDTH - 2 - width - 2;
  return rows.flatMap(([left, right]) =>
    wrap(right, room).map((line, i) => `  ${(i === 0 ? left : "").padEnd(width)}  ${line}`)
  );
}

/**
 * The "Authentication:", "Environment:" and "Examples:" blocks of the text `synchain --help`,
 * each followed by a blank line. Built from `AUTH_HELP` / `ENVIRONMENT_HELP`, so the text and the
 * JSON cannot say different things.
 */
export const AUTH_HELP_TEXT = [
  "Authentication:",
  `  Requests carry a ${AUTH_HELP.credential} as Authorization: ${AUTH_HELP.scheme} <key>.`,
  // Static help cannot know a `login --base-url` deployment, so the URL says whose page it is.
  `  Get a key at ${AUTH_HELP.obtain.url} (default host)`,
  `  ${AUTH_HELP.obtain.steps}`,
  "",
  "  On a terminal (prompts for the key, input hidden):",
  `    ${AUTH_HELP.login.interactive}`,
  "  Without a terminal (CI, agents; never prompts):",
  `    ${AUTH_HELP.login.nonInteractive}`,
  "",
  `  Only ${AUTH_HELP.envReadBy.map((command) => `synchain ${command}`).join(", ")} takes the ` +
    `key from ${AUTH_HELP.env};`,
  "  every other command uses the stored key.",
  `  Check: ${AUTH_HELP.verify.offline} (offline), then ${AUTH_HELP.verify.online} ` +
    "(asks the server).",
  "",
  "Environment:",
  ...columns(ENVIRONMENT_HELP.map(({ name, description }) => [name, description] as const)),
  "",
  "Examples:",
  ...EXAMPLES.map((line) => `  ${line}`),
  "  Preview a change before making it: synchain help safety",
  "",
].join("\n");
