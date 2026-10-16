// "pending" until /api/v1/geo-server/runtime confirms the mode. Only a confirmed
// "own" mode uses the own map server (frontend/src/lib/ownGeoServer.ts).
window.__TRAVSTATS_GEO__ = Object.freeze({ mode: "pending" });
