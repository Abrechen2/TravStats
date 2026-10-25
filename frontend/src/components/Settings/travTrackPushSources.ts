/** Whether OwnTracks / Overland tokens are offered on this server (`capabilities.sources`). */
export const hasPushSources = (sources: readonly string[] | undefined): boolean =>
  (sources ?? []).some((s) => s === "owntracks" || s === "overland");
