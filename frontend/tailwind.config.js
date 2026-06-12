/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        display: ["Syne", "sans-serif"],
        mono: ['"IBM Plex Mono"', "monospace"],
        sans: ["Inter", "sans-serif"],
      },
      colors: {
        // NOTE: never add a color key named like a core font-size suffix
        // (`base`, `sm`, `lg`, …) — it generates a `text-<key>` COLOR utility
        // that shadows the `text-<key>` font-size utility. A `base` key here
        // once turned every `text-base` element near-black on dark surfaces.
        surface: "var(--bg-surface)",
        elevated: "var(--bg-elevated)",
        border: "var(--color-border)",
        accent: {
          DEFAULT: "var(--accent)",
          dim: "var(--accent-dim)",
          glow: "var(--accent-glow)",
        },
        success: "var(--success)",
        danger: "var(--danger)",
        warning: "var(--warning)",
      },
      backgroundImage: {
        noise:
          "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E\")",
      },
      boxShadow: {
        "glow-accent": "0 0 20px var(--accent-glow)",
        "glow-sm": "0 0 8px var(--accent-glow)",
      },
    },
  },
  plugins: [],
};
