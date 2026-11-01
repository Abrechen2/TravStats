import type { InstanceSettings } from "../../../lib/api/admin";

export const instance = (over: Partial<InstanceSettings> = {}): InstanceSettings => ({
  instanceName: "TravStats",
  maxUsers: 10,
  allowRegistration: false,
  betaFeaturesEnabled: false,
  openDataEnabled: false,
  operatorLogosOpenDataEnabled: true,
  shareLinksEnabled: true,
  frontendUrl: "https://trav.example",
  publicUrl: null,
  lanUrl: null,
  webauthnRpId: null,
  webauthnOrigins: [],
  photonUrl: "https://photon.example",
  nominatimUrl: "https://nominatim.example",
  countryThreshold: "transited",
  railTransitousEnabled: true,
  railDbRestEnabled: true,
  ...over,
});

/** An Axios-shaped failure: with `status` the server answered, without it nothing did. */
export const httpError = (status?: number, data: unknown = {}): Error =>
  Object.assign(new Error("request failed"), status ? { response: { status, data } } : {});
