# Map Glassmorphism Redesign

**Date:** 2026-04-02
**Status:** Approved

---

## Overview

Vollständiges visuelles Redesign der Map-Ansicht im Glassmorphism-Stil. Betrifft Map-Tiles, Daten-Layer-Farben, Airport-Marker, den VisModeSelector (neu als FAB) und alle Map-UI-Elemente.

Roadmap-Vorhaben: Nutzer können später (separates Feature) zwischen Glassmorphism, Neon Cyberpunk, Dark Premium und Sci-Fi Terminal wechseln. Diese Spec betrifft ausschließlich die Glassmorphism-Implementierung als Default.

---

## Architektur

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `components/DeckGLMap.tsx` | Map-Tile-Style + CSS-Filter-Klasse, Grid-Overlay |
| `components/VisModeSelector.tsx` | Komplett ersetzen durch FAB-Komponente |
| `components/MapContainer3D.tsx` | FAB-Integration, Info-Pill, Dim-Overlay |
| `components/layers/layerTypes.ts` | `HEATMAP_COLORS` → Indigo/Cyan Palette |
| `components/layers/routesLayer.ts` | Dritter ScatterplotLayer für äußeren Ring |
| `components/layers/hexagonLayer.ts` | `colorRange` auf neue Palette abstimmen |
| `components/layers/heatmapLayer.ts` | Farb-Intensitäten (colorRange) anpassen |
| `components/layers/columnsLayer.ts` | colorRange auf neue Palette |
| `i18n/resources/de/map.json` | `visMode.contour` Key hinzufügen |
| `i18n/resources/en/map.json` | `visMode.contour` Key hinzufügen |

---

## Komponenten

### 1. Map-Tile Blautönung

**Ansatz:** CSS-Filter auf dem MapLibre-Canvas-Element. Der deck.gl-Canvas liegt auf einer separaten Ebene darüber und wird nicht beeinflusst.

```css
/* Nur auf MapLibre-Canvas anwenden */
.maplibre-blue-tint canvas.maplibregl-canvas {
  filter: hue-rotate(200deg) saturate(1.8) brightness(0.75);
}
```

Die Klasse `maplibre-blue-tint` wird im `Map`-Wrapper-Div gesetzt. Nur im Dark Mode aktiv — Light Mode behält `positron` Style unverändert.

### 2. Subtiles Grid-Overlay

SVG-Pattern als absolutes `<div>` über der Map, `pointer-events: none`, `opacity: 0.06`. Nur im Dark Mode sichtbar.

```
Grid: 40×40px, Stroke #818cf8 (indigo), Stärke 0.5px
```

### 3. Farb-Palette (layerTypes.ts)

Amber/Orange/Rot → Indigo/Violett/Cyan:

```
low:      [100, 116, 139]  → slate-500 (unverändert)
medium:   [232, 160,  69]  → [99, 102, 241]   indigo-500
high:     [249, 115,  22]  → [139, 92, 246]   violet-500
critical: [239,  68,  68]  → [34, 211, 153]   emerald-400 (Akzent)
```

Arc-Farben in `routesLayer.ts` nutzen `getHeatmapColor` — werden automatisch übernommen.

### 4. Airport-Marker (routesLayer.ts)

Drei konzentrische ScatterplotLayer (statisch):

| Layer | Radius | Farbe | Opacity |
|---|---|---|---|
| `routes-dot` | 2200m | `#93c5fd` (per Route-Farbe) | 220 |
| `routes-ring-inner` | dynamisch (3–10km) | gleiche Farbe | 90 |
| `routes-ring-outer` | `inner × 1.8` | gleiche Farbe | 35 |

> Animated Pulse (Rings mit Opacity-Oszillation per `useInterval`) ist als **Follow-up** vorgesehen, nicht Teil dieser Spec.

### 5. VisModeSelector → FAB-Komponente

`VisModeSelector.tsx` wird vollständig neu geschrieben. Interface bleibt identisch (`current`, `onChange` Props).

**Collapsed State:**
- 44×44px Gradient-Button (`indigo-600 → indigo-400`), `border-radius: 14px`
- Icon: aktueller Modus als SVG
- Positionierung: `absolute bottom-4 right-4` (von `top-16 right-3` geändert)
- Badge links daneben: Name des aktiven Modus (z.B. "Routen ◀"), Frosted-Glass

**Expanded State:**
- FAB-Icon wechselt zu `×` (mit framer-motion rotate-Animation)
- Liste klappt nach oben auf (`AnimatePresence` + `motion.div` mit `y`-Animation)
- Pro Modus: Icon-Button (36×36px, Frosted-Glass) + Label-Pill links
- Aktiver Modus: Indigo-Hintergrund + Glow-Shadow + Checkmark im Label
- Klick auf einen Modus: Mode setzen + schließen

**Backdrop:**
- Absolutes `div` in `MapContainer3D`, `opacity: 0` → `opacity: 1` wenn FAB offen
- `background: rgba(10, 8, 30, 0.45)`, `backdrop-filter: blur(1px)`
- Klick auf Backdrop schließt den FAB

**Keyboard:** `Escape` schließt den FAB.

### 6. Info-Pill (MapContainer3D.tsx)

Frosted-Glass-Pill oben links, zeigt Fluganzahl + Routenanzahl:

```
[247 Flüge · 89 Routen]
```

- Nur im `routes`-Modus sichtbar (andere Modi haben keine Routen-Semantik)
- Fluganzahl: `flights.length`
- Routenanzahl: aus `buildRouteData(flights, minRouteCount).arcs.length`

---

## Datenfluss

```
DashboardPage
  └── MapContainer3D (visMode, flights, ...)
        ├── Info-Pill (flights.length, route count) — nur routes-Modus
        ├── Grid-Overlay (dark mode only)
        ├── DeckGLMap
        │     ├── Map (maplibre, blue-tint CSS class)
        │     └── DeckGLOverlay → Layer mit neuer Farbpalette
        ├── GlobeView (unverändert)
        ├── FAB (VisModeSelector, current, onChange)
        └── Backdrop-Overlay (isOpen state)
```

`isOpen`-State für den FAB lebt in `MapContainer3D`, damit der Backdrop darüber gesteuert werden kann.

---

## i18n

Fehlender Key in `de/map.json` und `en/map.json`:

```json
"visMode": {
  ...
  "contour": "Isolinien"   // DE
  "contour": "Contour"     // EN
}
```

---

## Was sich NICHT ändert

- Alle 7 VisModi (routes, globe, heatmap, hexagon, columns, trips, contour) bleiben erhalten
- GlobeView-Komponente ist unverändert
- TimeSlider bleibt funktional (visuelles Restyling optional, nicht in dieser Spec)
- Light Mode: keine Änderungen (nur Dark Mode betroffen)
- Backend, API, Routing: keine Änderungen

---

## Out of Scope (Roadmap)

- Animierte Pulsringe bei Airport-Markern
- Theme-Switcher (Neon Cyberpunk / Dark Premium / Sci-Fi Terminal)
- TimeSlider visuelles Redesign
- GlobeView Glassmorphism-Anpassung
