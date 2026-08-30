
import { useTranslation } from "../hooks/useTranslation";// Monochrome spinning globe used as a branded loader. Renders on a
// <canvas> so it paints before three.js / deck.gl finish booting; the
// country TopoJSON lives as a static /public asset to keep it off the
// JS bundle. Reads --text-primary / --bg-base / --accent live so it
// reacts to dark-mode toggles without a remount.

import { useEffect, useMemo, useRef } from "react";
import { geoOrthographic, geoPath, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";

type TopoCache =
  | { status: "pending"; promise: Promise<FeatureCollection<Geometry>> }
  | { status: "ready"; data: FeatureCollection<Geometry> }
  | { status: "error" }
  | null;

let topoCache: TopoCache = null;

async function loadCountries(): Promise<FeatureCollection<Geometry>> {
  if (topoCache?.status === "ready") return topoCache.data;
  if (topoCache?.status === "pending") return topoCache.promise;

  const promise = fetch("/countries-110m.json")
    .then((r) => {
      if (!r.ok) throw new Error(`globe topojson: HTTP ${r.status}`);
      return r.json() as Promise<Topology<{ countries: GeometryCollection }>>;
    })
    .then((world) => {
      const fc = feature(world, world.objects.countries) as unknown as FeatureCollection<Geometry>;
      topoCache = { status: "ready", data: fc };
      return fc;
    })
    .catch((err) => {
      topoCache = { status: "error" };
      throw err;
    });

  topoCache = { status: "pending", promise };
  return promise;
}

interface GlobeLoaderProps {
  /** Diameter of the globe in px. Whirl rings extend ~20% beyond this. */
  size?: number;
  /** Optional visible + aria label. Inherits --text-muted. */
  label?: string;
  /** Override accent ring color. Defaults to var(--accent). */
  accent?: string;
  className?: string;
}

export function GlobeLoader({
  size = 200,
  label,
  accent,
  className,
}: GlobeLoaderProps): JSX.Element {
  const { t } = useTranslation(["common"]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // `buffer` is a pure function of `size`; memoising it keeps the effect
  // dep array stable and prevents a teardown/re-init churn when a parent
  // re-renders with the same size value.
  const buffer = useMemo(() => size * 1.2, [size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = buffer * dpr;
    canvas.height = buffer * dpr;
    canvas.style.width = `${buffer}px`;
    canvas.style.height = `${buffer}px`;
    ctx.scale(dpr, dpr);

    const readTokens = (): { fg: string; bg: string } => {
      const styles = getComputedStyle(document.documentElement);
      return {
        fg: styles.getPropertyValue("--text-primary").trim() || "#1f2328",
        bg: styles.getPropertyValue("--bg-base").trim() || "#f6f8fa",
      };
    };
    let tokens = readTokens();

    const themeObserver = new MutationObserver(() => {
      tokens = readTokens();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const projection = geoOrthographic()
      .scale(size * 0.36)
      .translate([buffer / 2, buffer / 2])
      .clipAngle(90);
    const path = geoPath(projection, ctx);
    const sphere = { type: "Sphere" as const };
    const graticule = geoGraticule10();

    let countries: FeatureCollection<Geometry> | null = null;
    let cancelled = false;
    loadCountries()
      .then((fc) => {
        if (!cancelled) countries = fc;
      })
      .catch(() => {
        // Fail soft — globe still spins as sphere + graticule.
      });

    const start = performance.now();
    const speed = 32; // deg/s
    let rafId = 0;

    const drawFeature = (geom: Feature | FeatureCollection | { type: "Sphere" }): void => {
      ctx.beginPath();
      path(geom as Parameters<typeof path>[0]);
    };

    const draw = (now: number): void => {
      const t = (now - start) / 1000;
      const lambda = (t * speed) % 360;
      projection.rotate([lambda, -18, 0]);

      ctx.clearRect(0, 0, buffer, buffer);

      drawFeature(sphere);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = tokens.fg;
      ctx.globalAlpha = 0.85;
      ctx.stroke();

      drawFeature(graticule as unknown as Feature);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = tokens.fg;
      ctx.globalAlpha = 0.22;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (countries) {
        drawFeature(countries);
        ctx.fillStyle = tokens.fg;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;

        drawFeature(countries);
        ctx.lineWidth = 0.4;
        ctx.strokeStyle = tokens.bg;
        ctx.stroke();
      }

      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelled = true;
      themeObserver.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [size, buffer]);

  const accentColor = accent ?? "var(--accent)";

  return (
    <div
      role="status"
      aria-label={label ?? t("common:accessibility.loading")}
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ position: "relative", width: buffer, height: buffer }}>
        <svg
          viewBox={`0 0 ${buffer} ${buffer}`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            animation: "ts-globe-spin 2.4s linear infinite",
          }}
        >
          <circle
            cx={buffer / 2}
            cy={buffer / 2}
            r={size * 0.55}
            fill="none"
            stroke="var(--text-primary)"
            strokeWidth={1}
            strokeDasharray="2 10"
            strokeLinecap="round"
            opacity={0.5}
          />
        </svg>

        <svg
          viewBox={`0 0 ${buffer} ${buffer}`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            animation: "ts-globe-spin-rev 3.6s linear infinite",
          }}
        >
          <circle
            cx={buffer / 2}
            cy={buffer / 2}
            r={size * 0.49}
            fill="none"
            stroke={accentColor}
            strokeWidth={1.5}
            strokeDasharray={`${size * 0.6} ${size * 2.4}`}
            strokeLinecap="round"
            opacity={0.95}
          />
          <circle
            cx={buffer / 2}
            cy={buffer / 2}
            r={size * 0.49}
            fill="none"
            stroke="var(--text-primary)"
            strokeWidth={1}
            strokeDasharray={`${size * 0.2} ${size * 2.8}`}
            strokeDashoffset={-size * 1.0}
            strokeLinecap="round"
            opacity={0.45}
          />
        </svg>

        <svg
          viewBox={`0 0 ${buffer} ${buffer}`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            animation: "ts-globe-spin 5.2s linear infinite",
          }}
        >
          <circle
            cx={buffer / 2}
            cy={buffer / 2}
            r={size * 0.43}
            fill="none"
            stroke="var(--text-primary)"
            strokeWidth={1.2}
            strokeDasharray="1 14"
            strokeLinecap="round"
            opacity={0.3}
          />
        </svg>

        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0 }} />
      </div>
      {label && (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            letterSpacing: 0.2,
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
