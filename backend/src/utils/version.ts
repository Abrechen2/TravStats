// Single source of truth for the runtime version string.
//
// Reads /app/backend/VERSION (written by the Dockerfile from the build-arg)
// once at module load. Eliminates the APP_VERSION env-var as a separate
// drift surface — historically a deploy could update the docker tag without
// also bumping the env-var (or vice versa) and the About / System-Info
// surfaces would lie about which build was actually running.
//
// Two exports:
//   buildVersion — exactly what's in the VERSION file, including any RC /
//     security-rc / beta / alpha suffix (e.g. "1.4.0-rc.1"). Surfaced in
//     diagnostics so we can tell which build artefact a container was
//     promoted from after a byte-identical retag.
//   appVersion   — the cleaned display version with any pre-release suffix
//     stripped (e.g. "1.4.0-rc.1" → "1.4.0"). What the UI shows in About.
//     Lets a promoted RC display its clean release version even though the
//     binary is byte-identical to the RC build.

import fs from "fs";
import path from "path";

const PRERELEASE_SUFFIX = /-(rc|security-rc|beta|alpha)\.\d+$/;

function readVersionFile(): string {
  try {
    const versionFile = path.join(__dirname, "../../VERSION");
    if (fs.existsSync(versionFile)) {
      return fs.readFileSync(versionFile, "utf-8").trim();
    }
  } catch {
    // fall through to "unknown"
  }
  return "unknown";
}

export function stripPrereleaseSuffix(version: string): string {
  return version.replace(PRERELEASE_SUFFIX, "");
}

export const buildVersion: string = readVersionFile();
export const appVersion: string = stripPrereleaseSuffix(buildVersion);
