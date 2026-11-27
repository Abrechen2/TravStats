import type { PurposeCatalogue } from "./api/purpose";
import type { Purpose } from "../shared/purpose";
import type { IconName } from "../components/ui/Icon";
import {
  BUILTIN_PREFIX,
  CUSTOM_PREFIX,
  effectivePurposeKey,
  type PurposeIcon,
} from "../shared/purposeCatalogue";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The line icon each stored purpose icon key is drawn as (`<PurposeGlyph>`). */
export const PURPOSE_ICON_NAME: Record<PurposeIcon, IconName> = {
  beach: "umbrella",
  briefcase: "briefcase",
  people: "users",
  backpack: "backpack",
  ticket: "ticket",
  podium: "mic",
  school: "graduation-cap",
  health: "stethoscope",
  box: "package",
  home: "house",
  star: "star",
  heart: "heart",
  sport: "dumbbell",
  camera: "camera",
  music: "music",
  food: "utensils",
};

/** The icon for a stored key; a key this build does not know gets a plain dot. */
export const purposeIconName = (icon: string | undefined): IconName =>
  (icon && PURPOSE_ICON_NAME[icon as PurposeIcon]) || "tag";

export interface PurposeDisplay {
  key: string;
  kind: Purpose;
  label: string;
  icon: string;
  color: string;
  archived: boolean;
}

/**
 * One purpose key in words, with its kind, icon and colour. A built-in is translated; a custom
 * purpose shows the user's name (the English name in English, where given). A custom key the
 * catalogue does not know (deleted, or not loaded yet) falls back to its kind's default.
 */
export function describePurpose(
  t: Translate,
  catalogue: PurposeCatalogue,
  key: string,
  language: string
): PurposeDisplay | null {
  if (key.startsWith(BUILTIN_PREFIX)) {
    const b = catalogue.builtins.find((x) => x.key === key);
    if (!b) return null;
    return {
      key,
      kind: b.kind,
      label: t(`purpose:builtin.${key.slice(BUILTIN_PREFIX.length)}`),
      icon: b.icon,
      color: b.color,
      archived: false,
    };
  }
  if (key.startsWith(CUSTOM_PREFIX)) {
    const c = catalogue.custom.find((x) => x.key === key);
    if (!c) return null;
    const label = language.startsWith("en") && c.nameEn ? c.nameEn : c.name;
    return { key, kind: c.kind, label, icon: c.icon, color: c.color, archived: c.archived };
  }
  return null;
}

/** The key an entry shows: its detail when it still fits its kind, else the kind's default. */
export function entryPurposeKey(
  catalogue: PurposeCatalogue,
  entry: { purpose?: string | null; purposeKey?: string | null } | null | undefined
): string | null {
  return effectivePurposeKey(entry?.purpose, entry?.purposeKey, (id) => {
    const c = catalogue.custom.find((x) => x.id === id);
    // Before the account's own purposes arrived, a stored custom key is taken at its word.
    if (!c && catalogue.loaded === false) return entry?.purpose as Purpose | undefined;
    return c?.kind;
  });
}
