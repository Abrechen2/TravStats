import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const settingsApiMock = vi.hoisted(() => ({ getApiKeyQuotas: vi.fn() }));
const flightsApiMock = vi.hoisted(() => ({
  bulkRefreshPreview: vi.fn(),
  bulkRefreshRun: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({ settingsApi: settingsApiMock }));
vi.mock("../../../lib/api/flights", () => ({ flightsApi: flightsApiMock }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => true }));

import ApiKeysSection from "../ApiKeysSection";
import { SECTION_LABEL_KEY } from "../../../pages/Settings/sectionLabels";

/**
 * Beta audit 2026-09-19, unlisted finding 3: the settings index offered "Meine
 * externen Dienste" and the anchor it points at was headed "API-SCHLÜSSEL".
 *
 * `sectionLabels.ts` already states the rule this broke — "a section's heading
 * and its index entry are the same words on purpose". So the assertion reads
 * the index's own key rather than naming a heading string, which would be the
 * second copy all over again.
 */
describe("the external-services section", () => {
  beforeEach(() => {
    settingsApiMock.getApiKeyQuotas.mockReset().mockResolvedValue({});
    flightsApiMock.bulkRefreshPreview.mockReset();
  });

  it("is headed by the words the settings index points at", async () => {
    render(
      <ApiKeysSection
        apiKeysStatus={null}
        apiKeys={{
          airlabsApiKey: "",
          aviationstackApiKey: "",
          aerodataboxApiKey: "",
          openskyClientId: "",
          openskyClientSecret: "",
        }}
        loadingApiKeys={false}
        onSetApiKeys={() => {}}
        onSave={() => {}}
      />
    );

    expect(
      await screen.findByRole("heading", { name: SECTION_LABEL_KEY.externalServices })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "settings:apiKeys.title" })
    ).not.toBeInTheDocument();
  });
});
