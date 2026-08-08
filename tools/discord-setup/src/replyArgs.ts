export type ReplyInput =
  | { kind: "file"; channel: string; path: string }
  | { kind: "inline"; channel: string; message: string }
  | { kind: "error"; reason: string };

const USAGE =
  "Usage: tsx src/index.ts reply <thread-id-or-title> (<single-line message> | --file <path>) [--dry-run]";

/**
 * Decide what a `reply` invocation is asking for, without touching the disk.
 *
 * A multi-line message is refused outright rather than posted. On Windows an
 * argument containing newlines is truncated at the first one and EVERYTHING
 * after it — including a trailing `--dry-run` — is dropped from argv, so on
 * 2026-08-08 a message meant as a dry run posted its opening line for real and
 * lost the rest. That failure is silent by nature: the process cannot see what
 * it never received. Refusing newlines here removes the only way it can happen.
 */
export function resolveReplyInput(argv: readonly string[]): ReplyInput {
  const channel = argv[3];
  if (!channel || channel.startsWith("--")) {
    return { kind: "error", reason: `No channel or thread given.\n${USAGE}` };
  }

  const fileIdx = argv.indexOf("--file");
  if (fileIdx !== -1) {
    const path = argv[fileIdx + 1];
    if (!path || path.startsWith("--")) {
      return { kind: "error", reason: `--file needs a path.\n${USAGE}` };
    }
    return { kind: "file", channel, path };
  }

  const message = argv
    .slice(4)
    .filter((a) => a !== "--dry-run")
    .join(" ");

  if (message.length === 0) {
    return { kind: "error", reason: `No message given.\n${USAGE}` };
  }
  if (/[\r\n]/.test(message)) {
    return {
      kind: "error",
      reason:
        "A multi-line message cannot be passed as a command-line argument — on Windows it is " +
        "cut at the first newline and any flag after it (such as --dry-run) is lost with it. " +
        `Write the message to a UTF-8 file and pass --file <path>.\n${USAGE}`,
    };
  }

  return { kind: "inline", channel, message };
}
