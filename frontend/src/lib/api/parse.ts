import type { ParsedBooking } from "../../types";

import { parserApi } from "./client";
import type { BoardingPassParseResult, EmailParseResult, ProviderAvailability } from "./types";

interface ParserCheckResult {
  available: boolean;
  provider?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// Parse API (Email & Boarding Pass) - Uses parserApi with 180s timeout
export const parseApi = {
  parseEmail: async (emailContent: string, subject?: string): Promise<EmailParseResult> => {
    const { data } = await parserApi.post<EmailParseResult>("/parse-email", {
      emailContent,
      subject,
    });
    return data;
  },

  parseEmailFile: async (file: File): Promise<EmailParseResult> => {
    const formData = new FormData();
    formData.append("email", file);

    const { data } = await parserApi.post<EmailParseResult>("/parse-email-file", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    return data;
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

  parsePdf: async (
    pdfBase64: string
  ): Promise<{
    flights: ParsedBooking[];
    parserUsed: string;
    ollamaAvailable: boolean;
    fallbackUsed?: boolean;
    pdfTextLength: number;
    bcbpDetected: boolean;
  }> => {
    const { data } = await parserApi.post<{
      flights: ParsedBooking[];
      parserUsed: string;
      ollamaAvailable: boolean;
      fallbackUsed?: boolean;
      pdfTextLength: number;
      bcbpDetected: boolean;
    }>("/parse-pdf", { pdfBase64 });
    return data;
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
