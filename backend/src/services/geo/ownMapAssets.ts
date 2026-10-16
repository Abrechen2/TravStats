const prefix = "/api/v1/geo-server/assets";
const styles = /^\/styles\/(standard|light|dark|voyager)\/style\.json$/;
const tiles = /^\/tiles\/(basemap|terrain)\/(\d{1,2})\/(\d{1,9})\/(\d{1,9})$/;
const sprites = /^\/sprites\/v\d+\/(dark|light|white|grayscale)(@2x)?\.(json|png)$/;
const fonts =
  /^\/fonts\/Noto Sans(?: Regular| Medium| Italic| Devanagari Regular v1)\/(\d{1,7})-(\d{1,7})\.pbf$/;

/** Fixed resources only: this is deliberately not a general-purpose URL proxy. */
export function allowedMapAsset(path: string): boolean {
  // Reject literal control bytes as well as URL delimiters before matching the allowlist.
  // eslint-disable-next-line no-control-regex
  if (path.length > 240 || /[\\?#%\x00-\x1f]/.test(path) || path.includes("..")) return false;
  if (
    styles.test(path) ||
    sprites.test(path) ||
    path === "/tiles/basemap" ||
    path === "/tiles/terrain" ||
    path === "/attribution.json"
  )
    return true;
  const tile = tiles.exec(path);
  if (tile) {
    const [z, x, y] = tile.slice(2).map(Number);
    return z <= 16 && x < 2 ** z && y < 2 ** z;
  }
  const font = fonts.exec(path);
  return (
    !!font &&
    Number(font[1]) % 256 === 0 &&
    Number(font[2]) === Number(font[1]) + 255 &&
    Number(font[2]) <= 1114111
  );
}

function localResource(
  value: unknown,
  kind: "glyphs" | "sprite" | "tile" | "source",
  appOrigin: string
): string {
  if (typeof value !== "string") throw new Error("Invalid map resource");
  const url = new URL(value, "https://geo.invalid");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid map resource");
  const path = decodeURIComponent(url.pathname);
  const valid =
    kind === "glyphs"
      ? path === "/fonts/{fontstack}/{range}.pbf"
      : kind === "sprite"
        ? sprites.test(`${path}.json`)
        : kind === "tile"
          ? /^\/tiles\/(basemap|terrain)\/\{z\}\/\{x\}\/\{y\}$/.test(path)
          : /^\/tiles\/(basemap|terrain)(\.json)?$/.test(path);
  if (!valid) throw new Error("Unsupported map resource");
  return appOrigin + prefix + path.replace(/\/tiles\/(basemap|terrain)\.json$/, "/tiles/$1");
}

/** Rewrite resource fields only; attribution links must remain intact. */
export function rewriteMapDocument(path: string, input: unknown, appOrigin: string): unknown {
  const origin = new URL(appOrigin);
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    origin.origin !== appOrigin ||
    origin.username ||
    origin.password
  )
    throw new Error("Invalid application origin");
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid map document");
  const doc = input as Record<string, unknown>;
  if (styles.test(path)) {
    if (doc.version !== 8 || doc.imports || !doc.sources || !Array.isArray(doc.layers))
      throw new Error("Invalid map style");
    if (doc.glyphs) doc.glyphs = localResource(doc.glyphs, "glyphs", appOrigin);
    if (doc.sprite) doc.sprite = localResource(doc.sprite, "sprite", appOrigin);
    for (const source of Object.values(doc.sources as Record<string, Record<string, unknown>>)) {
      if (!source || !["vector", "raster", "raster-dem"].includes(String(source.type)))
        throw new Error("Unsupported map source");
      if (source.url) source.url = localResource(source.url, "source", appOrigin);
      if (source.tiles) {
        if (!Array.isArray(source.tiles)) throw new Error("Invalid map tiles");
        source.tiles = source.tiles.map((tile) => localResource(tile, "tile", appOrigin));
      }
      if (!source.url && !source.tiles) throw new Error("Missing map tiles");
    }
  } else if (path.startsWith("/tiles/")) {
    if (!Array.isArray(doc.tiles) || !doc.tiles.length) throw new Error("Invalid TileJSON");
    doc.tiles = doc.tiles.map((tile) => localResource(tile, "tile", appOrigin));
  }
  return doc;
}
