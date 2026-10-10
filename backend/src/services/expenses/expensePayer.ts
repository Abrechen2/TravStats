/**
 * Who paid an expense (forgejo#150, owner D6) — recorded, never split.
 *
 * A payer is one of the caller's companions or a plain name. Companions are
 * the person list every domain shares, and trip sharing links them to
 * accounts, so a companion is the payer worth having; a name serves a capture
 * made offline and a one-off payer nobody wants in the list.
 *
 * Picking a companion stores its display name as well. The foreign key sets
 * the id null when the companion is deleted, and the name is what is left —
 * an expense does not forget who paid because the address book was tidied.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { CreateExpenseInput } from "../../schemas/expense";

export interface PayerColumns {
  payerCompanionId: string | null;
  payerName: string | null;
}

/** The columns a `payer` body field writes; undefined when it was not sent. */
export async function payerColumns(
  userId: string,
  payer: CreateExpenseInput["payer"]
): Promise<PayerColumns | undefined> {
  if (payer === undefined) return undefined;
  if (payer === null) return { payerCompanionId: null, payerName: null };
  if ("name" in payer) return { payerCompanionId: null, payerName: payer.name };
  // A foreign key proves existence, not ownership: someone else's companion is
  // not a companion of the caller's.
  const companion = await prisma.companion.findFirst({
    where: { id: payer.companionId, userId },
    select: { id: true, displayName: true },
  });
  if (!companion) throw new AppError("Companion not found", 404, "COMPANION_NOT_FOUND", "payer");
  return { payerCompanionId: companion.id, payerName: companion.displayName };
}
