import fs from "fs";
import path from "path";

import logger from "../../utils/logger";

/**
 * The web app's own design tokens and fonts for the public share page
 * (owner, 2026-11-22: the page is TravStats, not a look of its own).
 *
 * The page does not keep a palette: it is served the app's generated token
 * file (`frontend/src/theme/tokens.css`, from `design/tokens.json`) and its
 * self-hosted font faces (`frontend/src/theme/fonts.css`, files under
 * `/fonts`), as one stylesheet at `/share/theme.css`. Only the `:root` block
 * of the token file is served — the rest are Tailwind at-rules a browser
 * would ignore anyway.
 *
 * Where the files live: in the repository (dev, tests) next to the backend;
 * in the image under `backend/share-theme/`, copied there by the Dockerfile.
 */

const BACKEND_ROOT = path.resolve(__dirname, "..", "..", "..");
const CANDIDATE_DIRS = [
  path.join(BACKEND_ROOT, "share-theme"),
  path.join(BACKEND_ROOT, "..", "frontend", "src", "theme"),
];

/** The `:root { … }` block of the generated token file, verbatim. */
export function rootTokenBlock(tokensCss: string): string {
  const start = tokensCss.indexOf(":root {");
  if (start < 0) throw new Error("tokens.css has no :root block");
  const end = tokensCss.indexOf("\n}", start);
  if (end < 0) throw new Error("tokens.css :root block is not closed");
  return tokensCss.slice(start, end + 2) + "\n";
}

let cached: string | null = null;

/**
 * The theme stylesheet, read once found. A missing token file is a broken
 * image, not something to paper over with a second palette: it is logged as
 * an error on every request, never cached, and the route answers 503 — so the
 * fault stays visible and a file that appears later is picked up.
 */
export function sharePageThemeCss(): string | null {
  if (cached !== null) return cached;
  for (const dir of CANDIDATE_DIRS) {
    const tokens = path.join(dir, "tokens.css");
    const fonts = path.join(dir, "fonts.css");
    if (!fs.existsSync(tokens) || !fs.existsSync(fonts)) continue;
    cached =
      rootTokenBlock(fs.readFileSync(tokens, "utf8")) + "\n" + fs.readFileSync(fonts, "utf8");
    return cached;
  }
  logger.error({
    operation: "share_page_theme_missing",
    message: "The app's tokens.css/fonts.css were not found for the share page",
    context: { looked: CANDIDATE_DIRS },
  });
  return null;
}
