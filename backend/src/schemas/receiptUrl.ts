import { z } from "zod";

// Whitelist of allowed receipt URL domains (common cloud storage and document services).
const ALLOWED_RECEIPT_DOMAINS = [
  "dropbox.com",
  "drive.google.com",
  "docs.google.com",
  "onedrive.live.com",
  "1drv.ms",
  "box.com",
  "icloud.com",
  "s3.amazonaws.com",
  "cloudinary.com",
  "imgur.com",
  // Add your own domain here if you host receipts
];

/**
 * Shared receipt URL validator — used by both the flight schema
 * (schemas/flight.ts) and the lodging stay schema (schemas/lodging.ts).
 * Ensures the URL is either a local upload (`/api/v1/uploads/...`) or one
 * of the whitelisted trusted cloud-storage domains, never an arbitrary
 * external URL.
 */
export const receiptUrlValidator = z
  .string()
  .refine(
    (url) => {
      // Allow local uploads (starts with /api/v1/uploads/)
      if (url.startsWith("/api/v1/uploads/")) {
        return true;
      }

      // For external URLs, validate domain
      try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname.toLowerCase();
        return ALLOWED_RECEIPT_DOMAINS.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
        );
      } catch {
        return false;
      }
    },
    {
      message: `Receipt URL must be a local upload (/api/v1/uploads/) or from a trusted domain: ${ALLOWED_RECEIPT_DOMAINS.join(", ")}`,
    },
  )
  .optional();
