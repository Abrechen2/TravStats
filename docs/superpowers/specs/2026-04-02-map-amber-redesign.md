# Map Amber Redesign

**Date:** 2026-04-02
**Status:** Approved

---

## Overview

Überarbeitung des Map-Glassmorphism-Designs auf TravStats-Markenfarben (Amber/Orange). Ersetzt das indigo/cyan Farbschema vom ersten Glassmorphism-Durchgang durch konsequentes Amber. Filter-Button wird von Mitte-unten nach unten-rechts als FAB verschoben. Globus erhält Night-Earth-Textur mit Amber-Atmosphäre.

---

## Architektur

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `frontend/public/earth-night.jpg` | Kopieren aus `node_modules/three-globe/example/img/` |
| `frontend/public/night-sky.png` | Kopieren aus `node_modules/three-globe/example/img/` |
| `frontend/src/types/mapTheme.ts` | `MAP_LAYER_COLORS` → Amber-Palette |
| `frontend/src/index.css` | CSS-Tokens auf Amber, CSS-Filter entfernen |
| `frontend/src/components/DeckGLMap.tsx` | Map-Style-Wechsel rückgängig (immer dark-matter im dark mode) |
| `frontend/src/components/layers/layerTypes.ts` | `HEATMAP_COLORS` → Amber-Palette |
| `frontend/src/components/MapContainer3D.tsx` | `filterSlot` Prop, Filter-FAB über Mode-FAB |
| `frontend/src/pages/DashboardPage.tsx` | Bottom-Center-Filter entfernen, `filterSlot` übergeben |
| `frontend/src/components/Filters.tsx` | Trigger-Button → FAB-Stil, Glassmorphism-Spezialfall entfernen |
| `frontend/src/components/GlobeView.tsx` | Night-Textur, Amber-Atmosphäre, Sternfeld, Amber-Arcs |

---

## Komponenten

### 1. Farbpalette (mapTheme.ts + layerTypes.ts)

Amber-Wärme-Gradient für alle Vis-Modi:

```
low:      [100, 116, 139]   slate-500  (unverändert — wenig Aktivität)
mid:      [232, 160,  69]   amber-400  (war indigo-500)
high:     [249, 115,  22]   orange-500 (war violet-500)
peak:     [239,  68,  68]   red-500    (war emerald-400)
airportDot: [232, 160, 69]  amber-400  (war sky-300)
hexRange: 6-stufig amber→orange→rot
```

`HEATMAP_COLORS` in `layerTypes.ts` synchron anpassen:
```
medium: [232, 160, 69]
high:   [249, 115, 22]
critical: [239, 68, 68]
```

### 2. CSS-Tokens (index.css)

`[data-map-theme="glassmorphism"]` Vars auf Amber:

```css
--map-accent:            #e8a045;
--map-fab-gradient:      linear-gradient(135deg, #e8a045, #c8842a);
--map-fab-shadow:        0 4px 20px rgba(232, 160, 69, 0.35);
--map-fab-shadow-open:   0 4px 20px rgba(232, 160, 69, 0.55);
--map-active-bg:         rgba(232, 160, 69, 0.2);
--map-active-border:     rgba(232, 160, 69, 0.45);
--map-active-color:      #fcd99a;
--map-active-label-bg:   rgba(232, 160, 69, 0.15);
--map-active-label-border: rgba(232, 160, 69, 0.35);
--map-badge-bg:          rgba(255, 255, 255, 0.06);
--map-badge-border:      rgba(255, 255, 255, 0.12);
--map-badge-color:       #94a3b8;
```

CSS-Filter auf `canvas.maplibregl-canvas` komplett entfernen.

`[data-map-theme="classic"]` bleibt identisch (amber-Werte dort waren schon korrekt).

### 3. Map-Style (DeckGLMap.tsx)

Revert: `mapStyle` wieder einfach `isDarkMode ? DARK_MAP_STYLE : LIGHT_MAP_STYLE`. Kein glassmorphism-bedingter Style-Wechsel.

### 4. Filter als FAB (MapContainer3D + DashboardPage + Filters)

**MapContainer3D.tsx:**
- Neues optionales Prop: `filterSlot?: React.ReactNode`
- Rendern über dem Mode-FAB im bottom-right Stack:

```tsx
<div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
  {filterSlot}
  <div>/* Mode FAB (VisModeSelector) */</div>
</div>
```

**DashboardPage.tsx:**
- Bottom-center `{visMode !== "trips" && <div ...><Filters /></div>}` entfernen
- Stattdessen `filterSlot={<Filters onFilterChange={handleFilterChange} />}` an `MapContainer3D` übergeben

**Filters.tsx:**
- `useThemeStore` Import und `isGlass`-Logik entfernen (kein Sonderfall mehr nötig)
- Trigger-Button erhält einheitliches FAB-Styling:

```tsx
// Immer frosted-glass, keine bedingte Logik
style={{
  background: "rgba(255, 255, 255, 0.06)",
  color: "var(--text-secondary)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  backdropFilter: "blur(8px)",
}}
```

- `openUpward` ist bei Bottom-Right-Position immer `true` — Default auf `true` setzen oder automatisch ermitteln

### 5. Globus Night Earth (GlobeView.tsx)

```tsx
globeImageUrl="/earth-night.jpg"
bumpImageUrl="/earth-topology.png"          // unverändert
backgroundImageUrl="/night-sky.png"
atmosphereColor="#e8a045"
atmosphereAltitude={0.25}                   // war 0.15 (default)
```

Arc-Farben: `getHeatmapColor` mit Amber-Palette (automatisch durch `layerTypes.ts` Update).

Globus-Legende (Legend-Komponente in GlobeView): Farb-Punkte auf Amber-Palette aktualisieren.

---

## Datenfluss

```
DashboardPage
  ├── filterSlot = <Filters onFilterChange={...} />
  └── MapContainer3D (filterSlot, visMode, ...)
        ├── Info-Pill (amber-frosted)
        ├── Grid-Overlay (bleibt, opacity 0.06)
        ├── DeckGLMap (dark-matter, amber layer colors)
        ├── GlobeView (night texture, amber glow)
        └── Bottom-Right Stack [z-20]
              ├── filterSlot (Filter-FAB, frosted-glass)
              └── VisModeSelector FAB (amber gradient)
```

---

## Was sich NICHT ändert

- FAB-Mechanismus (expand/collapse, Backdrop, ESC-Key)
- VisModeSelector Prop-Interface (`current`, `onChange`, `isOpen`, `onOpenChange`)
- Info-Pill (top-left, routes-Modus)
- CSS-Token-Architektur (`data-map-theme` Attribut auf MapContainer3D)
- Alle 7 Vis-Modi
- Grid-Overlay (dark + glassmorphism)
- Karte volle Breite
- i18n (keine neuen Keys nötig)
- Backend, API, Routing

---

## Out of Scope

- Animated pulse rings (Roadmap)
- Theme-Switcher (Neon Cyberpunk / Dark Premium / Sci-Fi Terminal)
- TimeSlider visuelles Redesign
- Light Mode Änderungen
