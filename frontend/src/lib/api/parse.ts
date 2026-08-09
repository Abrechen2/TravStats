import type { ParsedBooking } from "../../types";
import type { CruiseInput, Port, Ship } from "../../types/cruise";
import type { LodgingImportCandidate } from "../../types/lodgingImport";

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

export type ParsePdfResult = ParsePdfFlightResult | ParsePdfCruiseResult | ParsePdfLodgingResult;

export function isCruisePdfResult(r: ParsePdfResult): r is ParsePdfCruiseResult {
  return r.domain === "cruise";
}

export function isLodgingPdfResult(r: ParsePdfResult): r is ParsePdfLodgingResult {
  return r.domain === "lodging";
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
  | ParseEmailLodgingResult;

export function isCruiseEmailResult(r: ParseEmailResult): r is ParseEmailCruiseResult {
  return r.domain === "cruise";
}

export function isLodgingEmailResult(r: ParseEmailResult): r is ParseEmailLodgingResult {
  return r.domain === "lodging";
}

// Parse API (Email & Boarding Pass) - Uses parserApi with 180s timeout
export const parseApi = {
  parseEmail: (async (
    emailContent: string,
    subject?: string,
    domain: "flight" | "cruise" | "lodging" = "flight"
  ) => {
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
      domain: "flight" | "cruise" | "lodging"
    ): Promise<ParseEmailResult>;
  },

  parseEmailFile: (async (file: File, domain: "flight" | "cruise" | "lodging" = "flight") => {
    const formData = new FormData();
    formData.append("email", file);
    formData.append("domain", domain);

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
    (file: File, domain: "flight" | "cruise" | "lodging"): Promise<ParseEmailResult>;
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

  parsePdf: (async (pdfBase64: string, domain: "flight" | "cruise" | "lodging" = "flight") => {
    const { data } = await parserApi.post<ParsePdfResult>("/parse-pdf", { pdfBase64, domain });
    return data;
  }) as {
    (pdfBase64: string): Promise<ParsePdfFlightResult>;
    (pdfBase64: string, domain: "flight"): Promise<ParsePdfFlightResult>;
    (pdfBase64: string, domain: "cruise"): Promise<ParsePdfCruiseResult>;
    (pdfBase64: string, domain: "lodging"): Promise<ParsePdfLodgingResult>;
    (pdfBase64: string, domain: "flight" | "cruise" | "lodging"): Promise<ParsePdfResult>;
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
