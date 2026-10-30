import { vi } from "vitest";
import type {
  AccountExternalServices,
  AdminExternalServices,
  AdminService,
} from "../../../lib/api/externalServices";

export const t = (key: string, options?: Record<string, unknown>): string => {
  const rest = { ...(options ?? {}) };
  delete rest.defaultValue;
  return Object.keys(rest).length > 0 ? `${key} ${JSON.stringify(rest)}` : key;
};

export function service(overrides: Partial<AdminService> & { id: string }): AdminService {
  return {
    category: "flight",
    credential: "key",
    keyless: false,
    alwaysOn: false,
    getKeyUrl: null,
    level: "instanceAndAccount",
    recommended: null,
    enabled: true,
    configured: true,
    instanceSource: "instance",
    allowAccountKeys: true,
    lastTest: { at: "2026-10-30T12:14:00Z", ok: true, reason: null },
    quota: null,
    fields: [],
    ...overrides,
  };
}

export function adminOverview(): AdminExternalServices {
  return {
    categories: [
      {
        id: "flight",
        services: [
          service({
            id: "airlabs",
            recommended: "free",
            fields: [
              { key: "apiKey", kind: "secret", value: "•••• 9c2e", masked: true, expert: false },
            ],
          }),
          service({
            id: "adsbx",
            level: "instance",
            configured: false,
            allowAccountKeys: null,
            lastTest: null,
            instanceSource: "none",
            fields: [{ key: "apiKey", kind: "secret", value: "", expert: false }],
          }),
          service({
            id: "aeroapi",
            level: "instance",
            recommended: "freeCredit",
            allowAccountKeys: null,
            quota: { kind: "budget", used: 2.5, limit: 10, unit: "USD" },
          }),
        ],
      },
      {
        id: "mapsRoutes",
        services: [
          service({
            id: "geocoder",
            level: "instance",
            allowAccountKeys: null,
            fields: [
              { key: "photonUrl", kind: "url", value: "https://photon.komoot.io", expert: true },
            ],
          }),
        ],
      },
      {
        id: "ai",
        services: [
          service({
            id: "openai",
            level: "instance",
            enabled: false,
            allowAccountKeys: null,
            consent: { allowedByAdmin: false, accountsConsented: 0 },
            fields: [
              { key: "apiKey", kind: "secret", value: "•••• 19bb", masked: true, expert: false },
            ],
          }),
          service({
            id: "anthropic",
            level: "instance",
            enabled: true,
            allowAccountKeys: null,
            consent: { allowedByAdmin: true, accountsConsented: 3 },
          }),
        ],
      },
    ],
    accountConnections: [
      { id: "dawarich", allowed: true, connectedAccounts: 1 },
      { id: "immich", allowed: true, connectedAccounts: 2 },
      { id: "strava", allowed: false, connectedAccounts: 0 },
      { id: "webdav", allowed: true, connectedAccounts: 0 },
    ],
  };
}

export function accountOverview(): AccountExternalServices {
  return {
    connections: [
      {
        id: "dawarich",
        recommended: null,
        effectiveSource: "none",
        accountDisabled: false,
        configured: false,
        lastTest: null,
        fields: [
          { key: "baseUrl", kind: "url", value: "", expert: false },
          { key: "apiKey", kind: "secret", value: "", expert: false },
        ],
      },
      {
        id: "webdav",
        recommended: null,
        effectiveSource: "account",
        accountDisabled: false,
        configured: true,
        lastTest: { at: "2026-10-30T12:14:00Z", ok: true, reason: null },
        // As built: the account's WebDAV and Strava have no writable fields on this route.
        fields: [],
      },
      {
        id: "strava",
        recommended: null,
        effectiveSource: "account",
        accountDisabled: false,
        configured: true,
        lastTest: null,
        fields: [],
      },
    ],
    ownKeys: [
      {
        id: "airlabs",
        recommended: "free",
        effectiveSource: "account",
        accountDisabled: false,
        configured: true,
        lastTest: { at: "2026-10-30T12:14:00Z", ok: true, reason: null },
        fields: [
          { key: "apiKey", kind: "secret", value: "•••• 9c2e", masked: true, expert: false },
        ],
      },
      {
        id: "aviationstack",
        recommended: null,
        effectiveSource: "instance",
        accountDisabled: false,
        configured: true,
        lastTest: null,
        fields: [{ key: "apiKey", kind: "secret", value: "", expert: false }],
      },
    ],
    aiConsents: [
      { id: "openai", provider: "openai", destination: "api.openai.com", consentedAt: null },
      {
        id: "anthropic",
        provider: "anthropic",
        destination: "api.anthropic.com",
        consentedAt: "2026-10-29T08:00:00Z",
      },
    ],
    instanceProvided: [
      { id: "aeroapi", enabled: true, recommended: "freeCredit" },
      { id: "openData", enabled: false, recommended: "free" },
    ],
  };
}

export function apiError(status: number, code?: string): unknown {
  return Object.assign(new Error("request failed"), {
    isAxiosError: true,
    response: { status, data: code ? { error: "x", code } : {} },
  });
}

export const networkError = Object.assign(new Error("Network Error"), { isAxiosError: true });

export const mockedApi = {
  adminOverview: vi.fn(),
  adminUpdate: vi.fn(),
  adminSetConnection: vi.fn(),
  adminTest: vi.fn(),
  accountOverview: vi.fn(),
  accountUpdate: vi.fn(),
  accountSetAiConsent: vi.fn(),
};
