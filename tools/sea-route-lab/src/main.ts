import { Map as MapLibre, NavigationControl } from "maplibre-gl";
import type { Layer, MapViewState } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";

import type { PortPair, RouteMethod, RouteResult } from "./types";
import { PORT_PAIRS } from "./ports";
import { greatCircleMethod } from "./methods/greatCircle";
import { bezierMethod } from "./methods/bezier";
import { aStar01Method } from "./methods/aStar01";
import { aStar01ChaikinMethod } from "./methods/aStar01Chaikin";
import { aStar01CatmullRomMethod } from "./methods/aStar01CatmullRom";
import { aStar005Method } from "./methods/aStar005";
import { waypointGraphMethod } from "./methods/waypointGraph";
import { searouteTsMethod } from "./methods/searouteTs";

const METHODS: readonly RouteMethod[] = [
  greatCircleMethod,
  bezierMethod,
  aStar01Method,
  aStar01ChaikinMethod,
  aStar01CatmullRomMethod,
  aStar005Method,
  waypointGraphMethod,
  searouteTsMethod,
];

const INITIAL_VIEW: MapViewState = {
  longitude: 10,
  latitude: 55,
  zoom: 4,
  pitch: 0,
  bearing: 0,
};

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const hexToRgba = (hex: string, alpha = 220): [number, number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, alpha];
};

interface LabState {
  pair: PortPair;
  enabled: Set<string>;
  results: Map<string, RouteResult>;
}

const state: LabState = {
  pair: PORT_PAIRS[0],
  enabled: new Set(METHODS.filter((m) => m.defaultOn).map((m) => m.id)),
  results: new Map(),
};

const map = new MapLibre({
  container: "map",
  style: MAP_STYLE,
  center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
  zoom: INITIAL_VIEW.zoom,
  pitch: INITIAL_VIEW.pitch,
  bearing: INITIAL_VIEW.bearing,
  attributionControl: false,
});
map.addControl(new NavigationControl(), "top-right");

const overlay = new MapboxOverlay({ layers: [], pickingRadius: 6 });
map.once("load", () => {
  map.addControl(overlay as unknown as maplibregl.IControl);
  render();
  void runAllMethods();
});

function portMarkersLayer(): Layer {
  const pts = [
    { position: [state.pair.from.lon, state.pair.from.lat], name: state.pair.from.name },
    { position: [state.pair.to.lon, state.pair.to.lat], name: state.pair.to.name },
  ];
  return new ScatterplotLayer({
    id: "ports",
    data: pts,
    getPosition: (d) => d.position as [number, number],
    getRadius: 6,
    radiusUnits: "pixels",
    getFillColor: [255, 255, 255, 240],
    getLineColor: [30, 41, 59, 255],
    lineWidthUnits: "pixels",
    getLineWidth: 2,
    stroked: true,
  });
}

function portLabelsLayer(): Layer {
  const pts = [
    { position: [state.pair.from.lon, state.pair.from.lat], text: state.pair.from.name },
    { position: [state.pair.to.lon, state.pair.to.lat], text: state.pair.to.name },
  ];
  return new TextLayer({
    id: "port-labels",
    data: pts,
    getPosition: (d) => d.position as [number, number],
    getText: (d) => d.text,
    getSize: 12,
    sizeUnits: "pixels",
    getColor: [230, 237, 243, 255],
    getPixelOffset: [0, -14],
    getAngle: 0,
    getTextAnchor: "middle",
    getAlignmentBaseline: "bottom",
    fontFamily: "system-ui, -apple-system, sans-serif",
  });
}

function methodLayer(method: RouteMethod, result: RouteResult): Layer {
  return new PathLayer({
    id: `path-${method.id}`,
    data: [{ path: result.coordinates }],
    getPath: (d) => d.path,
    getColor: hexToRgba(method.color, 220),
    getWidth: 2.5,
    widthUnits: "pixels",
    billboard: false,
  });
}

function buildLayers(): Layer[] {
  const layers: Layer[] = [];
  for (const method of METHODS) {
    if (!state.enabled.has(method.id)) continue;
    const result = state.results.get(method.id);
    if (!result) continue;
    layers.push(methodLayer(method, result));
  }
  layers.push(portMarkersLayer(), portLabelsLayer());
  return layers;
}

function fitBoundsToRoute(): void {
  const bboxPts: Array<[number, number]> = [
    [state.pair.from.lon, state.pair.from.lat],
    [state.pair.to.lon, state.pair.to.lat],
  ];
  for (const m of METHODS) {
    if (!state.enabled.has(m.id)) continue;
    const r = state.results.get(m.id);
    if (!r) continue;
    for (const c of r.coordinates) bboxPts.push(c);
  }
  if (bboxPts.length < 2) return;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lon, lat] of bboxPts) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: 60, duration: 0 },
  );
}

function render(): void {
  overlay.setProps({ layers: buildLayers() });
  renderMetrics();
}

function renderMetrics(): void {
  const tbody = document.getElementById("metrics-body")!;
  const rows: string[] = [];
  for (const method of METHODS) {
    const on = state.enabled.has(method.id);
    const res = state.results.get(method.id);
    const dot = `<span class="tag" style="background:${method.color}"></span>`;
    const note = res?.note ? ` <span style="color:var(--muted)">— ${res.note}</span>` : "";
    rows.push(`
      <tr style="opacity:${on ? 1 : 0.4}">
        <td>${dot}</td>
        <td>${method.label}${note}</td>
        <td class="num">${res ? res.coordinates.length : "—"}</td>
        <td class="num">${res ? res.distanceKm.toFixed(0) : "—"}</td>
        <td class="num">${res ? res.computeMs.toFixed(1) : "—"}</td>
      </tr>
    `);
  }
  tbody.innerHTML = rows.join("");
}

async function runMethod(method: RouteMethod): Promise<void> {
  try {
    const res = await method.compute(state.pair);
    state.results.set(method.id, res);
  } catch (err) {
    state.results.set(method.id, {
      coordinates: [
        [state.pair.from.lon, state.pair.from.lat],
        [state.pair.to.lon, state.pair.to.lat],
      ],
      distanceKm: 0,
      computeMs: 0,
      note: `error: ${String(err instanceof Error ? err.message : err).slice(0, 100)}`,
    });
  }
}

async function runAllMethods(): Promise<void> {
  state.results.clear();
  render();
  // Serialize A* runs so we don't DOS the single Vite worker thread,
  // but batch the cheap pure-geometry methods upfront.
  const cheap = METHODS.filter((m) => !m.id.startsWith("astar"));
  await Promise.all(cheap.map((m) => runMethod(m)));
  render();
  const heavy = METHODS.filter((m) => m.id.startsWith("astar"));
  for (const m of heavy) {
    await runMethod(m);
    render();
  }
  fitBoundsToRoute();
}

// ---------- UI wiring ----------

const pairSelect = document.getElementById("port-pair") as HTMLSelectElement;
for (const p of PORT_PAIRS) {
  const opt = document.createElement("option");
  opt.value = p.id;
  opt.textContent = p.label;
  pairSelect.appendChild(opt);
}
pairSelect.value = state.pair.id;
pairSelect.addEventListener("change", () => {
  const next = PORT_PAIRS.find((p) => p.id === pairSelect.value);
  if (!next) return;
  state.pair = next;
  void runAllMethods();
});

const methodsContainer = document.getElementById("methods")!;
for (const m of METHODS) {
  const id = `method-${m.id}`;
  const div = document.createElement("label");
  div.className = "method";
  div.htmlFor = id;
  div.innerHTML = `
    <input type="checkbox" id="${id}" ${state.enabled.has(m.id) ? "checked" : ""} />
    <span class="dot" style="background:${m.color}"></span>
    <span class="name">
      ${m.label}
      <div class="note">${m.description}</div>
    </span>
  `;
  methodsContainer.appendChild(div);
  const input = div.querySelector("input") as HTMLInputElement;
  input.addEventListener("change", () => {
    if (input.checked) state.enabled.add(m.id);
    else state.enabled.delete(m.id);
    render();
  });
}

document.getElementById("run")!.addEventListener("click", () => {
  void runAllMethods();
});
