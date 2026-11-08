/** One independently loaded section: its own failure never hides the others. */
export type Loaded<T> = { status: "loading" } | { status: "error" } | { status: "ok"; value: T };
export const LOADING: Loaded<never> = { status: "loading" };
