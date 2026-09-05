# Bewegung (§7.11)

Tokens: `motion.fast` 120 ms (Hover, Toggle, Chip) · `motion.base` 200 ms (Panels, Menüs, Tab-Unterstrich, Pillen-Wechsel) · `motion.enter` 260 ms ease-out (Dialog, Sheet, Toast, Stempel).

Keyframes in jedem Screen-Helmet: `ts-enter`, `ts-fade`, `ts-sheet`, `ts-menu`, `ts-stamp`, `ts-pulse` (Skeleton), `ts-rotate` (Globus 180 s), `ts-rise`.

Eingebaut: Toggle (120), Chips/Segmente (120), Tab-Unterstrich gleitet (200), Statuspille Cross-Fade (200), Panels/Gruppen steigen ein (200), Menüs (200, origin oben rechts), Dialog Scrim + Karte (200/260), Bottom-Sheet fährt an (260), Toast (260), Reisepass-Stempel setzen auf, Kopfzahl zählt (400 ms) bei Wechsel der Zählregel, Erfolg-Ring, Statistik-Balken, Vorschau der Auswirkungen gestaffelt (40 ms), Globus rotiert langsam mit Atmosphären-Glow, Karten heben bei Hover 1 px.

Nicht animiert: Tabellenzeilen beim Scrollen, Seitenwechsel, Zahlen in Tabellen, Fokusring. `prefers-reduced-motion` nullt alles.
