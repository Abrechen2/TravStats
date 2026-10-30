import { describe, expect, it } from "vitest";
import de from "../../../i18n/resources/de/externalServices.json";
import en from "../../../i18n/resources/en/externalServices.json";
import { failureText, fieldLabel, testReasonText } from "../serviceText";
import { apiError, networkError } from "./fixtures";

// A t that behaves like i18next: a missing key answers its defaultValue.
const known: Record<string, string> = {
  "externalServices:fields.airlabs.apiKey": "AirLabs-Schlüssel",
  "externalServices:fields.common.url": "URL",
  "externalServices:test.reasons.auth": "Anmeldung abgelehnt",
  "externalServices:errors.CONSENT_REQUIRED": "Freigabe fehlt",
  "externalServices:errors.network": "offline",
  "externalServices:errors.generic": "generisch",
};
const t = (key: string, options?: Record<string, unknown>): string =>
  known[key] ?? (options?.defaultValue as string | undefined) ?? key;

describe("service copy and failure text", () => {
  it("labels a field with the service's wording, then the common one, then the raw key", () => {
    expect(fieldLabel(t, "airlabs", { key: "apiKey" })).toBe("AirLabs-Schlüssel");
    expect(fieldLabel(t, "other", { key: "url" })).toBe("URL");
    expect(fieldLabel(t, "other", { key: "somethingNew" })).toBe("somethingNew");
  });

  it("translates a known test reason and shows an unknown one as sent, never as nothing", () => {
    expect(testReasonText(t, "auth")).toBe("Anmeldung abgelehnt");
    expect(testReasonText(t, "weird_reason")).toBe("weird_reason");
  });

  it("maps the server's stable code to copy and distinguishes 'no response' from 'refused'", () => {
    expect(failureText(t, apiError(400, "CONSENT_REQUIRED"))).toBe("Freigabe fehlt");
    expect(failureText(t, networkError)).toBe("offline");
    expect(failureText(t, apiError(500))).toBe("generisch");
  });

  it("carries name, purpose and the info rows for every service in German", () => {
    for (const [id, copy] of Object.entries(de.services)) {
      for (const part of ["name", "purpose", "why", "cost", "dataOut"] as const) {
        expect(copy[part], `${id}.${part}`).toBeTruthy();
      }
    }
    expect(Object.keys(en.services).sort()).toEqual(Object.keys(de.services).sort());
  });
});
