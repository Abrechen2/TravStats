/** Isolated self-hosted provider contract. Not connected to live settings/routes yet.
 * Only operator-reviewed endpoints may be passed in; never accept an arbitrary
 * client-supplied host. No credentials, external fallback or coordinate logging.
 */
export type Bounds = readonly [number, number, number, number];
export type Point = readonly [number, number]; // longitude, latitude
export type Mode = "road" | "foot" | "bike";
export type Release = {
  origin: string;
  datasetId: string;
  datasetSha256: string;
  dataAsOf: string;
  bounds: Bounds;
  timeoutMs: number;
  maxResponseBytes: number;
};
export type RoutingRelease = Release & {
  builtMode: Mode;
  profile: string;
  profileSha256: string;
};
export type Capability<T> = { policy: "disabled" } | { policy: "own-only"; release: T };

export class GeoUnavailable extends Error {
  constructor(code: string) {
    super(code);
    this.name = "GeoUnavailable";
  }
}

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const hash = /^[a-f0-9]{64}$/;
function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
export function contains(bounds: Bounds, point: unknown): point is Point {
  return (
    Array.isArray(point) &&
    point.length === 2 &&
    point.every(finite) &&
    point[0] >= bounds[0] &&
    point[0] <= bounds[2] &&
    point[1] >= bounds[1] &&
    point[1] <= bounds[3]
  );
}

function validateRelease(input: Release): Release {
  const url = new URL(input.origin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new GeoUnavailable("invalid_origin");
  }
  const b = input.bounds;
  if (
    !Array.isArray(b) ||
    b.length !== 4 ||
    !b.every(finite) ||
    b[0] < -180 ||
    b[2] > 180 ||
    b[1] < -85.0511 ||
    b[3] > 85.0511 ||
    b[0] >= b[2] ||
    b[1] >= b[3] ||
    b[2] - b[0] > 2 ||
    b[3] - b[1] > 2 ||
    !id.test(input.datasetId) ||
    !hash.test(input.datasetSha256) ||
    !Number.isFinite(Date.parse(input.dataAsOf)) ||
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 100 ||
    input.timeoutMs > 10000 ||
    !Number.isInteger(input.maxResponseBytes) ||
    input.maxResponseBytes < 128 ||
    input.maxResponseBytes > 2 * 1024 * 1024
  ) {
    throw new GeoUnavailable("invalid_release");
  }
  return Object.freeze({ ...input, origin: url.origin, bounds: Object.freeze([...b]) as Bounds });
}

function releaseOf<T extends Release>(config: Capability<T>): T {
  if (config.policy !== "own-only") throw new GeoUnavailable("disabled");
  return validateRelease(config.release) as T;
}

async function request(
  release: Release,
  path: string,
  query: Record<string, string>,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const url = new URL(path, release.origin);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), release.timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (
      !response.ok ||
      response.redirected ||
      (response.url && new URL(response.url).origin !== release.origin) ||
      !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
      !response.body
    ) {
      throw new GeoUnavailable("invalid_response");
    }
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > release.maxResponseBytes))
      throw new GeoUnavailable("response_too_large");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > release.maxResponseBytes) throw new GeoUnavailable("response_too_large");
      chunks.push(part.value);
    }
    const raw = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      raw.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch (error) {
    if (error instanceof GeoUnavailable) throw error;
    throw new GeoUnavailable(controller.signal.aborted ? "timeout" : "upstream_unavailable");
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        /* no raw upstream errors in logs */
      }
    }
  }
}

export function createRegionalRouting(
  config: Capability<RoutingRelease>,
  fetchImpl: typeof fetch = fetch
) {
  const release = releaseOf(config);
  if (
    !["road", "foot", "bike"].includes(release.builtMode) ||
    !id.test(release.profile) ||
    !hash.test(release.profileSha256)
  )
    throw new GeoUnavailable("invalid_graph_profile");
  return {
    async route(mode: Mode, from: Point, to: Point) {
      // The selected graph, not the profile word in the URL, defines transport mode.
      if (mode !== release.builtMode) throw new GeoUnavailable("mode_not_built");
      if (!contains(release.bounds, from) || !contains(release.bounds, to))
        throw new GeoUnavailable("outside_coverage");
      const body = await request(
        release,
        `/route/v1/${release.profile}/${from.join(",")};${to.join(",")}`,
        { geometries: "geojson", overview: "full", steps: "false", alternatives: "false" },
        fetchImpl
      );
      if (
        !object(body) ||
        body.code !== "Ok" ||
        !Array.isArray(body.routes) ||
        !object(body.routes[0])
      )
        throw new GeoUnavailable("no_route");
      const route = body.routes[0];
      const geometry = route.geometry;
      if (
        !object(geometry) ||
        geometry.type !== "LineString" ||
        !Array.isArray(geometry.coordinates) ||
        geometry.coordinates.length < 2 ||
        geometry.coordinates.length > 20000 ||
        !geometry.coordinates.every((p) => contains(release.bounds, p)) ||
        !finite(route.distance) ||
        route.distance < 0 ||
        !finite(route.duration) ||
        route.duration < 0
      )
        throw new GeoUnavailable("invalid_route");
      return {
        waypoints: geometry.coordinates as Point[],
        distanceKm: route.distance / 1000,
        drivingMinutes: route.duration / 60,
        datasetId: release.datasetId,
        datasetSha256: release.datasetSha256,
      };
    },
  };
}

export function createRegionalSearch(config: Capability<Release>, fetchImpl: typeof fetch = fetch) {
  const release = releaseOf(config);
  return {
    async search(query: string) {
      if (typeof query !== "string" || !query.trim() || query.length > 200)
        throw new GeoUnavailable("invalid_query");
      const body = await request(
        release,
        "/api/",
        { q: query.trim(), bbox: release.bounds.join(","), limit: "10" },
        fetchImpl
      );
      if (
        !object(body) ||
        body.type !== "FeatureCollection" ||
        !Array.isArray(body.features) ||
        body.features.length > 100
      )
        throw new GeoUnavailable("invalid_search");
      const features = body.features.filter(
        (f) =>
          object(f) &&
          f.type === "Feature" &&
          object(f.geometry) &&
          f.geometry.type === "Point" &&
          contains(release.bounds, f.geometry.coordinates)
      );
      return { features, datasetId: release.datasetId, datasetSha256: release.datasetSha256 };
    },
  };
}

export function createRegionalElevation(
  config: Capability<Release & { dataset: string }>,
  fetchImpl: typeof fetch = fetch
) {
  const release = releaseOf(config);
  if (!id.test(release.dataset)) throw new GeoUnavailable("invalid_dem");
  return {
    async elevation(points: readonly Point[]) {
      if (
        !Array.isArray(points) ||
        points.length < 1 ||
        points.length > 100 ||
        !points.every((p) => contains(release.bounds, p))
      )
        throw new GeoUnavailable("outside_coverage");
      const body = await request(
        release,
        `/v1/${release.dataset}`,
        {
          locations: points.map(([lon, lat]) => `${lat},${lon}`).join("|"),
          interpolation: "bilinear",
        },
        fetchImpl
      );
      if (
        !object(body) ||
        body.status !== "OK" ||
        !Array.isArray(body.results) ||
        body.results.length !== points.length
      )
        throw new GeoUnavailable("invalid_elevation");
      const elevations = body.results.map((r: unknown, i: number) => {
        if (
          !object(r) ||
          r.dataset !== release.dataset ||
          !object(r.location) ||
          !finite(r.location.lng) ||
          !finite(r.location.lat) ||
          Math.abs(r.location.lng - points[i][0]) > 1e-6 ||
          Math.abs(r.location.lat - points[i][1]) > 1e-6 ||
          (r.elevation !== null &&
            (!finite(r.elevation) || r.elevation < -12000 || r.elevation > 10000))
        )
          throw new GeoUnavailable("invalid_elevation");
        return r.elevation as number | null; // NoData is never fabricated as sea level.
      });
      return { elevations, datasetId: release.datasetId, datasetSha256: release.datasetSha256 };
    },
    cacheNamespace: `elevation:${release.datasetId}:${release.datasetSha256}`,
  };
}
