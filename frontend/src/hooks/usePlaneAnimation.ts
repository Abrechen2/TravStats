import { useState, useEffect, useRef, useMemo } from "react";
import { TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Flight } from "../types";
import { arcPosition, easeInOut } from "../utils/mapAnimationHelpers";

const LEG_DURATION = 1500;
const DELAY_AFTER_FLYTO = 500;

export function usePlaneAnimation(selectedFlights: Flight[]): Layer[] {
  const [planePositions, setPlanePositions] = useState<Array<[number, number]>>([]);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setPlanePositions([]);

    if (selectedFlights.length === 0) return;

    const legs: Array<{ source: [number, number]; target: [number, number] }> = selectedFlights
      .filter((f) => f.depLon != null && f.depLat != null && f.arrLon != null && f.arrLat != null)
      .map((f) => ({
        source: [f.depLon, f.depLat] as [number, number],
        target: [f.arrLon, f.arrLat] as [number, number],
      }));

    if (legs.length === 0) return;

    const totalDuration = legs.length * LEG_DURATION;
    let startTime: number | null = null;

    const animate = (ts: number): void => {
      if (startTime === null) startTime = ts;
      const elapsed = ts - startTime - DELAY_AFTER_FLYTO;
      if (elapsed < 0) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const positions: Array<[number, number]> = legs.map((leg, i) => {
        const legElapsed = elapsed - i * LEG_DURATION;
        if (legElapsed < 0) return leg.source;
        if (legElapsed >= LEG_DURATION) return leg.target;
        return arcPosition(leg.source, leg.target, easeInOut(legElapsed / LEG_DURATION));
      });

      setPlanePositions(positions);
      if (elapsed < totalDuration) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [selectedFlights]);

  return useMemo((): Layer[] => {
    if (planePositions.length === 0) return [];
    return [
      new TextLayer({
        id: "plane-marker",
        data: planePositions.map((position, i) => ({ position, index: i })),
        getText: () => "✈",
        getPosition: (d: { position: [number, number] }) => d.position,
        getSize: 20,
        getColor: [255, 255, 255, 230] as [number, number, number, number],
        getAngle: 0,
        fontFamily: "Arial, sans-serif",
        billboard: true,
        // The airplane glyph (U+2708) sits well outside deck.gl's default
        // ASCII-only characterSet (32-127), so without this the marker's
        // font atlas has no glyph for it and nothing renders (same root
        // cause as #185 — non-ASCII text dropped from the atlas).
        characterSet: "auto",
      }),
    ];
  }, [planePositions]);
}
