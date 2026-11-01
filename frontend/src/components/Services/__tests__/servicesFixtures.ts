import type {
  AccountExternalServices,
  AdminExternalServices,
  AdminService,
} from "../../../lib/api/externalServices";

export const admin = (id: string, over: Partial<AdminService> = {}): AdminService => ({
  id,
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
  lastTest: null,
  quota: null,
  fields: [{ key: "apiKey", kind: "secret", value: "•••• 9c2e", masked: true, expert: false }],
  ...over,
});

export function adminOverview(over: Partial<AdminExternalServices> = {}): AdminExternalServices {
  return {
    categories: [
      { id: "flight", services: [admin("airlabs"), admin("opensky", { fields: [] })] },
      {
        id: "ai",
        services: [
          admin("openai", {
            level: "instance",
            enabled: false,
            allowAccountKeys: null,
            consent: { allowedByAdmin: false, accountsConsented: 0 },
          }),
        ],
      },
      {
        id: "openData",
        services: [
          admin("geocoder", {
            level: "instance",
            alwaysOn: true,
            keyless: true,
            allowAccountKeys: null,
            fields: [
              { key: "photonUrl", kind: "url", value: "https://photon.example", expert: true },
            ],
          }),
        ],
      },
    ],
    accountConnections: [{ id: "immich", allowed: true, connectedAccounts: 2 }],
    ...over,
  };
}

export function accountOverview(
  over: Partial<AccountExternalServices> = {}
): AccountExternalServices {
  return {
    connections: [
      {
        id: "immich",
        recommended: null,
        effectiveSource: "none",
        accountDisabled: false,
        configured: false,
        lastTest: null,
        fields: [
          { key: "baseUrl", kind: "url", value: null, expert: false },
          { key: "apiKey", kind: "secret", value: null, masked: true, expert: false },
        ],
      },
    ],
    ownKeys: [
      {
        id: "airlabs",
        recommended: null,
        effectiveSource: "instance",
        accountDisabled: false,
        configured: false,
        lastTest: null,
        fields: [{ key: "apiKey", kind: "secret", value: null, masked: true, expert: false }],
      },
    ],
    aiConsents: [],
    instanceProvided: [{ id: "geocoder", enabled: true, recommended: null }],
    blocked: [],
    ...over,
  };
}
