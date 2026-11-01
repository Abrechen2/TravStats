/** The outcome line a service row shows after a call: what the server really answered. */
export interface RowFeedback {
  kind: "ok" | "error" | "info";
  text: string;
}
