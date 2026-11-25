import { randomUUID } from "node:crypto";
import { ToolFailure } from "./errors";
import type { LoadedFile } from "./files";

type Rec = Record<string, unknown>;

/** The original a draft was read from, kept so the entry made from it can carry it as a document. */
export type DraftSource =
  { kind: "file"; file: LoadedFile } | { kind: "text"; text: string } | null;

export interface Draft {
  id: string;
  /** The domain the server parsed the document as. */
  domain: string;
  /** What the server read: one booking per item, as the server returned it. */
  items: Rec[];
  warnings: string[];
  source: DraftSource;
  createdAt: number;
}

const MAX_DRAFTS = 20;
const TTL_MS = 60 * 60 * 1000;

/**
 * Drafts live in this process only, for an hour: a draft is a proposal the person is looking at,
 * not a record, and nothing about it is saved on the server (the server is the record).
 */
export class DraftStore {
  private readonly drafts = new Map<string, Draft>();

  constructor(private readonly now: () => number = Date.now) {}

  put(draft: Omit<Draft, "id" | "createdAt">): Draft {
    this.sweep();
    while (this.drafts.size >= MAX_DRAFTS) {
      const oldest = this.drafts.keys().next().value as string;
      this.drafts.delete(oldest);
    }
    const full: Draft = { ...draft, id: randomUUID(), createdAt: this.now() };
    this.drafts.set(full.id, full);
    return full;
  }

  get(id: string): Draft {
    this.sweep();
    const draft = this.drafts.get(id);
    if (!draft)
      throw new ToolFailure(
        "not_found",
        "No such draft here (drafts last an hour and only in this session). Parse the document again."
      );
    return draft;
  }

  private sweep(): void {
    const cutoff = this.now() - TTL_MS;
    for (const [id, d] of this.drafts) if (d.createdAt < cutoff) this.drafts.delete(id);
  }
}

/** The domain-shaped list of readings in a parse answer. */
export function itemsOf(body: Rec): Rec[] {
  const list = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);
  switch (body.domain) {
    case "cruise":
      return list(body.cruises);
    case "rail":
      return list(body.bookings);
    case "bus":
    case "ferry":
      return list(body.tickets);
    case "package":
      return body.package ? [body.package as Rec] : [];
    case "flight":
      return list(body.flights).length
        ? list(body.flights)
        : body.flight
          ? [body.flight as Rec]
          : [];
    default:
      return list(body.candidates);
  }
}

/** What the server said that the person should see next to the draft. */
export function warningsOf(body: Rec): string[] {
  const out: string[] = [];
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  const reason = text(body.fallbackReason) ?? text(body.fallbackCode);
  if (reason) out.push(`The server could not read everything: ${reason}`);
  const mismatch = body.domainMismatch as Rec | undefined;
  if (mismatch?.detected)
    out.push(
      `The document looks like a "${String(mismatch.detected)}" booking, not the asked domain.`
    );
  if (text(body.airlineNotice)) out.push(String(body.airlineNotice));
  if (body.llmUnreachable) out.push("The AI parser was needed but could not be reached.");
  const provider = body.llmProvider as Rec | null | undefined;
  if (provider) out.push(`A language model read this document (${JSON.stringify(provider)}).`);
  const detection = body.detection as Rec | undefined;
  if (body.domainSource === "detected" && detection)
    out.push(
      `The server picked the domain itself: ${String(body.domain)}. Ask again with an explicit domain if that is wrong.`
    );
  for (const item of itemsOf(body)) {
    const inferred = item.inferredFields;
    if (Array.isArray(inferred) && inferred.length)
      out.push(`Inferred, not stated in the document (please verify): ${inferred.join(", ")}`);
  }
  return out;
}
