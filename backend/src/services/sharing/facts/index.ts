/**
 * The facts of each shareable entry type (design 2026-10-09, decision 2):
 * one module per type, each a field whitelist plus the function that copies
 * exactly those fields. S1 copies with them; S2's propagation reads the same
 * lists to decide whether a write touched a fact at all.
 */
export * from "./flight";
export * from "./lodgingStay";
export * from "./cruise";
export * from "./rail";
export * from "./rental";
export * from "./stop";
export * from "./trip";
export { pickFacts, jsonForWrite } from "./pick";
