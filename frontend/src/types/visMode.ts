export type VisMode = "routes" | "globe" | "heatmap" | "hexagon" | "columns" | "trips";

export const VIS_MODES: VisMode[] = ["routes", "globe", "heatmap", "hexagon", "columns", "trips"];

export const VIS_MODE_LABELS: Record<VisMode, string> = {
  routes: "Routes",
  globe: "Globe",
  heatmap: "Heatmap",
  hexagon: "Hexagon",
  columns: "3D Columns",
  trips: "Trips",
};
