/** Everything that leaves the package passes through here: a token must never be printed. */
const PAT_PATTERN = /ts_pat_[0-9a-zA-Z]+/g;

export function redact(text: string, token?: string): string {
  let out = text.replace(PAT_PATTERN, "ts_pat_[redacted]");
  if (token && token.length >= 8) out = out.split(token).join("[redacted]");
  return out;
}
