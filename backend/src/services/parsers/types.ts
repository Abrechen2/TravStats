import type { LlmRefusal } from "../llm/llmGate";
import type { LlmTarget } from "../llm/llmProvider";
import { ParsedBooking } from "../bookingParser";

/**
 * Provider types for vision and text parsing
 */
export type VisionProvider = "tesseract" | "manual";
export type TextProvider = "regex" | "ollama";

/**
 * Common interface for all vision parsers
 */
export interface IVisionParser {
  /**
   * Provider identifier
   */
  readonly provider: VisionProvider;

  /**
   * Check if this parser is available (service running, API key configured, etc.)
   */
  checkAvailability(apiKey?: string): Promise<ProviderAvailability>;

  /**
   * Parse boarding pass image
   * @param imageBase64 - Base64-encoded image data
   * @returns Parsed flight data
   */
  parseImage(imageBase64: string, apiKey?: string): Promise<ParsedBooking>;
}

/**
 * Per-request parsing context.
 *
 * NOT parser configuration: a parser instance is cached and shared between
 * requests, so anything that belongs to ONE email has to travel with the call.
 */
export interface TextParseOptions {
  /**
   * When the email was sent. A booking confirmation that writes "16 JUL" and
   * no year is read against this. Omitted means today.
   */
  referenceDate?: Date;
}

/**
 * Common interface for all text parsers (email parsing)
 */
export interface ITextParser {
  /**
   * Provider identifier
   */
  readonly provider: TextProvider;

  /**
   * Check if this parser is available
   */
  checkAvailability(apiKey?: string): Promise<ProviderAvailability>;

  /**
   * Parse email to extract flight information
   * @param subject - Email subject
   * @param text - Email plain text
   * @param html - Email HTML (optional)
   * @returns Array of parsed flights (multi-flight support)
   */
  parseEmail(
    subject: string,
    text: string,
    html?: string,
    apiKey?: string,
    options?: TextParseOptions
  ): Promise<ParsedBooking[]>;
}

/**
 * Provider availability status
 */
export interface ProviderAvailability {
  /**
   * Is the provider available and ready to use?
   */
  available: boolean;

  /**
   * Human-readable reason if unavailable
   */
  reason?: string;

  /**
   * Additional metadata (model name, version, etc.)
   */
  metadata?: Record<string, unknown>;
}

/**
 * Parser configuration from environment variables
 */
export interface ParserConfig {
  /**
   * Preferred vision parser provider
   */
  visionProvider: VisionProvider | "auto";

  /**
   * Preferred text parser provider
   */
  textProvider: TextProvider | "auto";

  /**
   * Fallback chain for vision parsing
   * If primary fails, try these in order
   */
  visionFallbacks: VisionProvider[];

  /**
   * Fallback chain for text parsing
   */
  textFallbacks: TextProvider[];

  /**
   * When the email being parsed was sent, if the caller knows.
   *
   * Strictly per-request rather than configuration, and it sits here only
   * because this object is what already reaches every parser. See
   * TextParseOptions.
   */
  referenceDate?: Date;

  /**
   * The resolved model endpoint (`services/llm/llmProvider.ts`) — Ollama or an
   * OpenAI-compatible provider. Read it through `llmTargetOf`, which also
   * accepts a config that names only `ollamaUrl`/`ollamaModel`.
   */
  llmTarget?: LlmTarget;

  /**
   * Ollama server URL — overrides OLLAMA_URL env var
   */
  ollamaUrl?: string;

  /**
   * Ollama model name — overrides OLLAMA_MODEL env var
   */
  ollamaModel?: string;

  /**
   * Why this caller's config carries no model, when it was taken away rather
   * than never configured — the admin switch or the shared-demo denial
   * (`services/llm/llmGate.ts`). Absent when the model is allowed.
   */
  llmRefusal?: LlmRefusal;

  /**
   * Optional user ID for template lookup
   */
  userId?: string;
}

/**
 * Parsing result with metadata
 */
export interface ParserResult {
  /**
   * Parsed flight data
   */
  flights: ParsedBooking[];

  /**
   * Which provider was used
   */
  provider: VisionProvider | TextProvider;

  /**
   * Did we fall back to a different provider?
   */
  fallbackUsed: boolean;

  /**
   * Was data enriched with additional sources?
   */
  enriched?: boolean;

  /**
   * Set when nothing was found AND a configured LLM could not be asked, so
   * the empty answer is the templates' alone, not the model's.
   */
  llmUnreachable?: boolean;
}
