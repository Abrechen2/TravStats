import { describe, expect, it } from "vitest";
import { LUCIDE } from "../../components/ui/icons/lucide";
import { PURPOSE_ICONS } from "../../shared/purposeCatalogue";
import { PURPOSE_ICON_NAME } from "../purposeDisplay";

describe("purpose icons are line icons, not emoji", () => {
  it("maps every stored purpose icon to an icon the app ships (purposes rendered emoji)", () => {
    for (const icon of PURPOSE_ICONS) {
      const name = PURPOSE_ICON_NAME[icon];
      expect(name, icon).toBeTruthy();
      expect(name in LUCIDE, `${icon} -> ${name}`).toBe(true);
      expect(name).toMatch(/^[a-z-]+$/);
    }
  });
});
