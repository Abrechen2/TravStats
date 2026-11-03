import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import de from "../../../i18n/resources/de/externalServices.json";
import en from "../../../i18n/resources/en/externalServices.json";

const lang = vi.hoisted(() => ({ current: "de" }));

vi.mock("../../../hooks/useTranslation", async () => {
  const deJson = (await import("../../../i18n/resources/de/externalServices.json")).default;
  const enJson = (await import("../../../i18n/resources/en/externalServices.json")).default;
  const lookup = (key: string): unknown => {
    const path = key.replace(/^externalServices:/, "").split(".");
    let node: unknown = lang.current === "de" ? deJson : enJson;
    for (const part of path) node = (node as Record<string, unknown> | undefined)?.[part];
    return node;
  };
  return {
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        const v = key.startsWith("externalServices:") ? lookup(key) : undefined;
        if (typeof v === "string") return v;
        return options && "defaultValue" in options ? String(options.defaultValue) : key;
      },
      i18n: undefined,
    }),
  };
});

import FieldsGroup from "../FieldsGroup";
import type { ServiceField } from "../../../lib/api/externalServices";

const fields = (primary: string): ServiceField[] => [
  {
    key: "primarySource",
    kind: "select",
    value: primary,
    expert: false,
    options: ["frankfurter", "allratestoday", "custom"],
  },
  {
    key: "fallbackSource",
    kind: "select",
    value: "none",
    expert: false,
    options: ["none", "frankfurter", "allratestoday", "custom"],
  },
];

const mount = (primary: string) =>
  render(
    <MemoryRouter>
      <FieldsGroup
        id="fx-test"
        label="fx"
        serviceId="fx"
        fields={fields(primary)}
        secretTemplate="instKey"
        write={vi.fn(async () => {})}
        tests={false}
        errorText={null}
      />
    </MemoryRouter>
  );

describe("FX source picker (#391)", () => {
  afterEach(() => {
    cleanup();
    lang.current = "de";
  });

  it("shows the AllRatesToday link and the German attribution note when it is chosen", () => {
    mount("allratestoday");
    expect(
      screen.getByText(
        /Kostenlos ohne Schlüssel\. Werden Kurse öffentlich angezeigt, verlangt der Anbieter einen Link\./
      )
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: "allratestoday.com" });
    expect(link.getAttribute("href")).toBe("https://allratestoday.com");
  });

  it("shows the English mirror of the note", () => {
    lang.current = "en";
    mount("allratestoday");
    expect(screen.getByText(/Free, no key needed/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "allratestoday.com" })).toBeTruthy();
  });

  it("shows no note for Frankfurter", () => {
    mount("frankfurter");
    expect(screen.queryByRole("link", { name: "allratestoday.com" })).toBeNull();
  });

  it("shows the note after picking AllRatesToday", async () => {
    mount("frankfurter");
    await userEvent.click(screen.getAllByRole("radio", { name: "AllRatesToday" })[0]);
    expect(screen.getByRole("link", { name: "allratestoday.com" })).toBeTruthy();
  });

  it("carries the labels and the note in both languages", () => {
    for (const j of [de, en]) {
      expect(j.fieldOptions.fx.primarySource.custom).toBeTruthy();
      expect(j.fieldOptions.fx.fallbackSource.none).toBeTruthy();
      expect(j.fieldNotes.fx.allratestoday.linkUrl).toBe("https://allratestoday.com");
    }
  });
});
