import axios from "axios";

export type SearchErrorKind = "network" | "rateLimit" | "auth" | "server" | "bad";

/** Which of the user-facing reasons a failed search is — never "no matches". */
export function classifySearchError(error: unknown): SearchErrorKind {
  if (!axios.isAxiosError(error)) return "server";
  const status = error.response?.status;
  if (status === undefined) return "network";
  if (status === 429) return "rateLimit";
  if (status === 401 || status === 403) return "auth";
  if (status === 400) return "bad";
  return "server";
}
