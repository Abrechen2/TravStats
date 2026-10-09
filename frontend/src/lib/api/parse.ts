import type { ParsedBooking } from "../../types";
import type { RentalImportCandidate, RentalParseFallbackCode } from "../../types/rental";
import type { CruiseInput, Port, Ship } from "../../types/cruise";
import type { LodgingImportCandidate } from "../../types/lodgingImport";
import type { RailImportBooking, RailParseFallbackCode } from "../../types/rail";

import { parserApi } from "./client";
import type {
  Airport,
  BoardingPassParseResult,
  EmailParseResult,
  ProviderAvailability,
} from "./types";

/** A flight bundled with a fly & cruise booking. Tentative — exact times come
 *  ~4 months out. Airports are pre-filled by the backend (home airport on the
 *  home side, nearest airport to the embarkation/disembarkation port on the
 *  cruise side) and are editable in the import preview. */
export interface ParsedFlightSuggestion {
  flightNumber?: string;
  airline?: string;
  direction?: "outbound" | "return";
  date?: string;
  cabinClass?: "economy" | "premium_economy" | "business" | "first";
  departureAirport?: Airport | null;
  arrivalAirport?: Airport | null;
}

export interface ParsedCruiseEntry {
  input: CruiseInput;
  shipMatched: boolean;
  unmatchedPorts: { dayNumber: number; portName: string }[];
  /** Fly & cruise flights detected in the same booking. */
  flights?: ParsedFlightSuggestion[];
  /** Resolved display objects for the matched ids in `input`, so the import
   *  editor can show + edit the matched ship/ports inline (the /ships and
   *  /ports routes are search-only — no get-by-id). `stopPorts` is keyed by
   *  the stop's `dayNumber`. Absent on older backends. */
  ship?: Ship | null;
  departurePort?: Port | null;
  arrivalPort?: Port | null;
  stopPorts?: Record<number, Port>;
}

export interface ParsePdfFlightResult {
  domain?: "flight";
  flights: ParsedBooking[];
  parserUsed: string;
  ollamaAvailable: boolean;
  fallbackUsed?: boolean;
  /** Nothing found AND the configured AI parser could not be asked. */
  llmUnreachable?: boolean;
  pdfTextLength: number;
  bcbpDetected: boolean;
}

export interface ParsePdfCruiseResult {
  domain: "cruise";
  cruises: ParsedCruiseEntry[];
  parserUsed: string;
  ollamaAvailable: boolean;
  pdfTextLength: number;
}

export interface ParsePdfLodgingResult {
  domain: "lodging";
  candidates: LodgingImportCandidate[];
  parserUsed: "template" | "ollama" | "none";
  ollamaAvailable: boolean;
  fallbackReason?: string;
  pdfTextLength: number;
}

/** A rail ticket's reading: one booking, or none and a code saying why. */
interface RailParseFields {
  domain: "rail";
  bookings: RailImportBooking[];
  parserUsed: "template" | "ollama" | "none";
  ollamaAvailable: boolean;
  fallbackCode?: RailParseFallbackCode;
  /** English, for the log — never shown. */
  fallbackReason?: string;
  /** The DB order a legless mail named. */
  orderReference?: string | null;
  /** The document clearly is another domain; read by `detectedOtherDomain`. */
  domainMismatch?: { detected: ParseDomain; confidence: number };
}

/** A rental document's reading: one candidate, or none and a code saying why (rental spec §4). */
interface RentalParseFields {
  domain: "rental";
  candidates: RentalImportCandidate[];
  parserUsed: "template" | "ollama" | "none";
  ollamaAvailable: boolean;
  fallbackCode?: RentalParseFallbackCode;
  /** English, for the log — never shown. */
  fallbackReason?: string;
  domainMismatch?: { detected: ParseDomain; confidence: number };
}

export interface ParsePdfRentalResult extends RentalParseFields {
  pdfTextLength: number;
}

export interface ParseEmailRentalResult extends RentalParseFields {
  subject?: string;
  text?: string;
  html?: string;
}

export interface ParsePdfRailResult extends RailParseFields {
  pdfTextLength: number;
}

export interface ParseEmailRailResult extends RailParseFields {
  subject?: string;
  text?: string;
  html?: string;
}

/**
 * A package tour's reading (plan 2026-10-09 P3) — the names the backend's
 * `services/trip/package/contract.ts` fixes. Dates are `YYYY-MM-DD`, times
 * `HH:MM`, calendar strings with no zone.
 */
export interface PackageFlightReading {
  flightNumber: string;
  date: string;
  depIata?: string | null;
  arrIata?: string | null;
  depCity?: string | null;
  arrCity?: string | null;
  depTime?: string | null;
  arrTime?: string | null;
  arrDayOffset?: number | null;
  airline?: string | null;
}

export interface PackageStayReading {
  name: string;
  checkIn: string;
  checkOut: string;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  board?: string | null;
  room?: string | null;
}

export interface PackageReading {
  bookingReference: string;
  issuedOn: string;
  tripName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travellers?: number | null;
  totalPrice?: number | null;
  currency?: string | null;
  flights: PackageFlightReading[];
  stays: PackageStayReading[];
  cruiseShip?: string | null;
  cruiseFrom?: string | null;
  cruiseTo?: string | null;
  cruiseCabin?: string | null;
  cruiseStart?: string | null;
  cruiseEnd?: string | null;
}

/** Why a package document came back empty — worded by the client. */
export type PackageParseFallbackCode = "noTemplate" | "invalidReading";

interface PackageParseFields {
  domain: "package";
  package: PackageReading | null;
  template: { id: string; version: string; issuer: string } | null;
  parserUsed: "template" | "none";
  ollamaAvailable: boolean;
  fallbackCode?: PackageParseFallbackCode;
  /** English, for the log — never shown. */
  fallbackReason?: string;
  /** The contract paths a recognising template failed. */
  issues?: string[];
  /** Present when the document was kept (`retain: true`). */
  documentId?: string;
  /** Present when a mail's PDF attachment was read (and kept), not its body. */
  readFromAttachment?: { filename: string | null };
  domainMismatch?: { detected: ParseDomain; confidence: number };
}

export interface ParsePdfPackageResult extends PackageParseFields {
  pdfTextLength: number;
}

export interface ParseEmailPackageResult extends PackageParseFields {
  subject?: string;
  text?: string;
  html?: string;
}

export type ParsePdfResult =
  | ParsePdfFlightResult
  | ParsePdfCruiseResult
  | ParsePdfLodgingResult
  | ParsePdfRailResult
  | ParsePdfRentalResult
  | ParsePdfPackageResult;

export function isCruisePdfResult(r: ParsePdfResult): r is ParsePdfCruiseResult {
  return r.domain === "cruise";
}

export function isLodgingPdfResult(r: ParsePdfResult): r is ParsePdfLodgingResult {
  return r.domain === "lodging";
}

export function isRailPdfResult(r: ParsePdfResult): r is ParsePdfRailResult {
  return r.domain === "rail";
}

export function isRentalPdfResult(r: ParsePdfResult): r is ParsePdfRentalResult {
  return r.domain === "rental";
}

export function isPackagePdfResult(r: ParsePdfResult): r is ParsePdfPackageResult {
  return r.domain === "package";
}

interface ParserCheckResult {
  available: boolean;
  provider?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface ParseEmailFlightResult extends EmailParseResult {
  domain?: "flight";
}

export interface ParseEmailCruiseResult {
  domain: "cruise";
  cruises: ParsedCruiseEntry[];
  parserUsed: string;
  ollamaAvailable: boolean;
  subject?: string;
  text?: string;
  html?: string;
}

export interface ParseEmailLodgingResult {
  domain: "lodging";
  candidates: LodgingImportCandidate[];
  parserUsed: "template" | "ollama" | "none";
  ollamaAvailable: boolean;
  fallbackReason?: string;
  subject?: string;
  text?: string;
  html?: string;
}

export type ParseEmailResult =
  | ParseEmailFlightResult
  | ParseEmailCruiseResult
  | ParseEmailLodgingResult
  | ParseEmailRailResult
  | ParseEmailRentalResult
  | ParseEmailPackageResult;

/**
 * The domains a document can be parsed for — `components/import/types.ts`
 * mirrors it. `package` is a parse target, not a domain: its reading becomes
 * a trip proposal (`lib/api/tripPackage.ts`).
 */
export type ParseDomain = "flight" | "cruise" | "lodging" | "rail" | "rental" | "package";

/** What every parse call may also ask for. */
export interface ParseOptions {
  /** Keep the uploaded document; the answer then carries its `documentId`. */
  retain?: boolean;
}

export function isCruiseEmailResult(r: ParseEmailResult): r is ParseEmailCruiseResult {
  return r.domain === "cruise";
}

export function isLodgingEmailResult(r: ParseEmailResult): r is ParseEmailLodgingResult {
  return r.domain === "lodging";
}

export function isRailEmailResult(r: ParseEmailResult): r is ParseEmailRailResult {
  return r.domain === "rail";
}

export function isRentalEmailResult(r: ParseEmailResult): r is ParseEmailRentalResult {
  return r.domain === "rental";
}

export function isPackageEmailResult(r: ParseEmailResult): r is ParseEmailPackageResult {
  return r.domain === "package";
}

// Parse API (Email & Boarding Pass) - Uses parserApi with 180s timeout
export const parseApi = {
  parseEmail: (async (emailContent: string, subject?: string, domain: ParseDomain = "flight") => {
    const { data } = await parserApi.post<ParseEmailResult>("/parse-email", {
      emailContent,
      subject,
      domain,
    });
    return data;
  }) as {
    (emailContent: string, subject?: string): Promise<ParseEmailFlightResult>;
    (
      emailContent: string,
      subject: string | undefined,
      domain: "flight"
    ): Promise<ParseEmailFlightResult>;
    (
      emailContent: string,
      subject: string | undefined,
      domain: "cruise"
    ): Promise<ParseEmailCruiseResult>;
    (
      emailContent: string,
      subject: string | undefined,
      domain: "lodging"
    ): Promise<ParseEmailLodgingResult>;
    (
      emailContent: string,
      subject: string | undefined,
      domain: "rail"
    ): Promise<ParseEmailRailResult>;
    (
      emailContent: string,
      subject: string | undefined,
      domain: "rental"
    ): Promise<ParseEmailRentalResult>;
    (
      emailContent: string,
      subject: string | undefined,
      domain: "package"
    ): Promise<ParseEmailPackageResult>;
    (
      emailContent: string,
      subject: string | undefined,
      domain: ParseDomain
    ): Promise<ParseEmailResult>;
  },

  parseEmailFile: (async (
    file: File,
    domain: ParseDomain = "flight",
    options: ParseOptions = {}
  ) => {
    const formData = new FormData();
    formData.append("email", file);
    formData.append("domain", domain);
    if (options.retain) formData.append("retain", "true");

    const { data } = await parserApi.post<ParseEmailResult>("/parse-email-file", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    return data;
  }) as {
    (file: File): Promise<ParseEmailFlightResult>;
    (file: File, domain: "flight"): Promise<ParseEmailFlightResult>;
    (file: File, domain: "cruise"): Promise<ParseEmailCruiseResult>;
    (file: File, domain: "lodging"): Promise<ParseEmailLodgingResult>;
    (file: File, domain: "rail"): Promise<ParseEmailRailResult>;
    (file: File, domain: "rental"): Promise<ParseEmailRentalResult>;
    (file: File, domain: "package", options?: ParseOptions): Promise<ParseEmailPackageResult>;
    (file: File, domain: ParseDomain, options?: ParseOptions): Promise<ParseEmailResult>;
  },

  parseBoardingpass: async (
    imageBase64: string,
    enrichWithApi = true
  ): Promise<BoardingPassParseResult> => {
    const { data } = await parserApi.post<BoardingPassParseResult>("/parse-boardingpass", {
      imageBase64,
      enrichWithApi,
    });
    return data;
  },

  parsePdf: (async (
    pdfBase64: string,
    domain: ParseDomain = "flight",
    options: ParseOptions = {}
  ) => {
    const { data } = await parserApi.post<ParsePdfResult>("/parse-pdf", {
      pdfBase64,
      domain,
      ...(options.retain ? { retain: true } : {}),
    });
    return data;
  }) as {
    (pdfBase64: string): Promise<ParsePdfFlightResult>;
    (pdfBase64: string, domain: "flight"): Promise<ParsePdfFlightResult>;
    (pdfBase64: string, domain: "cruise"): Promise<ParsePdfCruiseResult>;
    (pdfBase64: string, domain: "lodging"): Promise<ParsePdfLodgingResult>;
    (pdfBase64: string, domain: "rail"): Promise<ParsePdfRailResult>;
    (pdfBase64: string, domain: "rental"): Promise<ParsePdfRentalResult>;
    (pdfBase64: string, domain: "package", options?: ParseOptions): Promise<ParsePdfPackageResult>;
    (pdfBase64: string, domain: ParseDomain, options?: ParseOptions): Promise<ParsePdfResult>;
  },

  checkOllamaVision: async (): Promise<ParserCheckResult> => {
    const { data } = await parserApi.get<ParserCheckResult>("/parse-boardingpass/check");
    return data;
  },

  // Get available parser providers
  getProviders: async (): Promise<{
    vision: Array<{
      provider: string;
      availability: ProviderAvailability;
    }>;
    text: Array<{
      provider: string;
      availability: ProviderAvailability;
    }>;
  }> => {
    const { data } = await parserApi.get<{
      vision: Array<{
        provider: string;
        availability: ProviderAvailability;
      }>;
      text: Array<{
        provider: string;
        availability: ProviderAvailability;
      }>;
    }>("/parse-boardingpass/providers");
    return data;
  },

  // Get provider availability (simplified for hybrid flow)
  getProviderAvailability: async (): Promise<{
    ollama: boolean;
    openai: boolean;
    claude: boolean;
    providers: {
      ollama?: ProviderAvailability;
      openai?: ProviderAvailability;
      claude?: ProviderAvailability;
    };
  }> => {
    const { data } = await parserApi.get<{
      ollama: boolean;
      openai: boolean;
      claude: boolean;
      providers: {
        ollama?: ProviderAvailability;
        openai?: ProviderAvailability;
        claude?: ProviderAvailability;
      };
    }>("/parse-boardingpass/availability");
    return data;
  },
};
