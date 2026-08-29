import { createOpenRouteService } from "../openRouteService";
import { createGraphHopper } from "../graphHopper";
import { createCustomOsrm } from "../customOsrm";
import { RouteRequest } from "../types";

/**
 * Fixture bodies are shaped against each provider's current documentation
 * (verified 2026-08 — see task-2-report.md for the exact pages / excerpts
 * used). A stub `fetchImpl` stands in for the network in every test; the
 * global `fetch` is never touched.
 */

const FROM = { lat: 52.517037, lon: 13.38886 };
const TO = { lat: 52.529407, lon: 13.397634 };

function roadRequest(): RouteRequest {
  return { from: FROM, to: TO, mode: "road" };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function malformedResponse(status: number): Response {
  return new Response("not json{{{", { status });
}

describe("createOpenRouteService", () => {
  const orsFixture = {
    features: [
      {
        geometry: {
          coordinates: [
            [13.38886, 52.517037],
            [13.390006, 52.520008],
            [13.397634, 52.529407],
          ],
        },
        properties: {
          summary: { distance: 1500.4, duration: 210.7 },
        },
      },
    ],
  };

  it("decodes a successful response into waypoints/distanceKm/drivingMinutes", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, orsFixture));
    const provider = createOpenRouteService("test-key", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).not.toBeNull();
    expect(result?.waypoints).toEqual([
      [13.38886, 52.517037],
      [13.390006, 52.520008],
      [13.397634, 52.529407],
    ]);
    expect(result?.distanceKm).toBeCloseTo(1.5004, 6);
    expect(result?.drivingMinutes).toBeCloseTo(210.7 / 60, 6);
  });

  it("puts the mapped profile in the request path and the coordinates in the body", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, orsFixture));
    const provider = createOpenRouteService("test-key", fetchImpl as unknown as typeof fetch);

    await provider.route(roadRequest());

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/directions/hgv/geojson");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.coordinates).toEqual([
      [FROM.lon, FROM.lat],
      [TO.lon, TO.lat],
    ]);
  });

  it("never puts the API key in the URL or body", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, orsFixture));
    const provider = createOpenRouteService("super-secret-key", fetchImpl as unknown as typeof fetch);

    await provider.route(roadRequest());

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).not.toContain("super-secret-key");
    expect((init as RequestInit).body as string).not.toContain("super-secret-key");
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({ Authorization: "super-secret-key" }),
    );
  });

  it("returns null on a non-200 response", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(500, { error: "boom" }));
    const provider = createOpenRouteService("test-key", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).toBeNull();
  });

  it("returns null on a 200 with a malformed body", async () => {
    const fetchImpl = jest.fn(async () => malformedResponse(200));
    const provider = createOpenRouteService("test-key", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).toBeNull();
  });

  it("returns null on a 200 with a well-formed but wrong-shaped body", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { features: [] }));
    const provider = createOpenRouteService("test-key", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).toBeNull();
  });

  it("returns null when fetch itself rejects", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("network down");
    });
    const provider = createOpenRouteService("test-key", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).toBeNull();
  });

  it("returns null for a non-routable mode without calling fetch", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, orsFixture));
    const provider = createOpenRouteService("test-key", fetchImpl as unknown as typeof fetch);

    const result = await provider.route({ from: FROM, to: TO, mode: "ferry" });

    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createGraphHopper", () => {
  const graphHopperFixture = {
    paths: [
      {
        points: {
          type: "LineString",
          coordinates: [
            [13.38886, 52.517037, 34.2],
            [13.390006, 52.520008, 35.1],
            [13.397634, 52.529407, 33.8],
          ],
        },
        distance: 1500.4,
        time: 210700, // milliseconds
      },
    ],
  };

  it("decodes a successful response, converting metres/ms to km/minutes", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, graphHopperFixture));
    const provider = createGraphHopper("test-key", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).not.toBeNull();
    expect(result?.waypoints).toEqual([
      [13.38886, 52.517037],
      [13.390006, 52.520008],
      [13.397634, 52.529407],
    ]);
    expect(result?.distanceKm).toBeCloseTo(1.5004, 6);
    expect(result?.drivingMinutes).toBeCloseTo(210700 / 1000 / 60, 6);
  });

  it("requests points_encoded=false and the mapped profile", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, graphHopperFixture));
    const provider = createGraphHopper("test-key", fetchImpl as unknown as typeof fetch);

    await provider.route(roadRequest());

    const [url] = fetchImpl.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get("points_encoded")).toBe("false");
    expect(parsed.searchParams.get("profile")).toBe("hgv");
    expect(parsed.searchParams.getAll("point")).toEqual([
      `${FROM.lat},${FROM.lon}`,
      `${TO.lat},${TO.lon}`,
    ]);
  });

  it("returns null on a non-200 response", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(401, { message: "invalid key" }));
    const provider = createGraphHopper("test-key", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).toBeNull();
  });

  it("returns null on a 200 with a malformed body", async () => {
    const fetchImpl = jest.fn(async () => malformedResponse(200));
    const provider = createGraphHopper("test-key", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).toBeNull();
  });

  it("returns null on a 200 with a well-formed but wrong-shaped body", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { paths: [] }));
    const provider = createGraphHopper("test-key", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).toBeNull();
  });

  it("returns null for an encoded-polyline shape (points as a bare string)", async () => {
    const encodedFixture = {
      paths: [{ points: "ghrlHir~s@?BIC", distance: 1500.4, time: 210700 }],
    };
    const fetchImpl = jest.fn(async () => jsonResponse(200, encodedFixture));
    const provider = createGraphHopper("test-key", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).toBeNull();
  });
});

describe("createCustomOsrm", () => {
  const osrmFixture = {
    routes: [
      {
        geometry: {
          type: "LineString",
          coordinates: [
            [13.38886, 52.517037],
            [13.390006, 52.520008],
            [13.397634, 52.529407],
          ],
        },
        distance: 1500.4,
        duration: 210.7,
      },
    ],
  };

  it("decodes a successful response into waypoints/distanceKm/drivingMinutes", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, osrmFixture));
    const provider = createCustomOsrm("http://osrm.local:5000", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).not.toBeNull();
    expect(result?.waypoints).toEqual([
      [13.38886, 52.517037],
      [13.390006, 52.520008],
      [13.397634, 52.529407],
    ]);
    expect(result?.distanceKm).toBeCloseTo(1.5004, 6);
    expect(result?.drivingMinutes).toBeCloseTo(210.7 / 60, 6);
  });

  it("builds the OSRM URL shape with the mapped profile and no key", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, osrmFixture));
    const provider = createCustomOsrm("http://osrm.local:5000/", fetchImpl as unknown as typeof fetch);

    await provider.route(roadRequest());

    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      `http://osrm.local:5000/route/v1/hgv/${FROM.lon},${FROM.lat};${TO.lon},${TO.lat}?geometries=geojson&overview=full`,
    );
  });

  it("returns null on a non-200 response", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(400, { code: "InvalidQuery" }));
    const provider = createCustomOsrm("http://osrm.local:5000", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).toBeNull();
  });

  it("returns null on a 200 with a malformed body", async () => {
    const fetchImpl = jest.fn(async () => malformedResponse(200));
    const provider = createCustomOsrm("http://osrm.local:5000", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).toBeNull();
  });

  it("returns null on a 200 with a well-formed but wrong-shaped body", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { routes: [] }));
    const provider = createCustomOsrm("http://osrm.local:5000", fetchImpl as unknown as typeof fetch);

    const result = await provider.route(roadRequest());

    expect(result).toBeNull();
  });

  it("returns null for a non-routable mode without calling fetch", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, osrmFixture));
    const provider = createCustomOsrm("http://osrm.local:5000", fetchImpl as unknown as typeof fetch);

    const result = await provider.route({ from: FROM, to: TO, mode: "rail" });

    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
