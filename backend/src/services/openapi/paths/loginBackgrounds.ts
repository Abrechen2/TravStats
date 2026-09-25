/**
 * Sign-in backgrounds — the images behind the left half of the login page.
 *
 * The two reads are UNAUTHENTICATED, which is the point: the page that shows
 * them is what a visitor meets before a session exists. Writing is admin-only,
 * because uploading one here is a decision to publish it.
 *
 * The directory is the list — there is no row to keep in step with the bytes.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Instance"];

const filename = z.string().describe("Server-generated name, `<timestamp>-<random>-<slug>.<ext>`");

const backgroundList = z.object({
  backgrounds: z
    .array(filename)
    .describe("Every image on this instance, oldest first — the name sorts by upload time"),
});

registry.registerPath({
  method: "get",
  path: "/login-backgrounds",
  summary: "The sign-in page's background images",
  description:
    "Public, and deliberately so — the sign-in page fetches this before anyone " +
    "has signed in. An instance with none answers an empty list and the page " +
    "draws its gradient instead. `Cache-Control: private, max-age=3600`.",
  tags,
  responses: {
    200: {
      description: "The image names",
      content: { "application/json": { schema: backgroundList } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/login-backgrounds/{filename}",
  summary: "One background image",
  description:
    "Public. Image bytes with `Cache-Control: private, max-age=3600`. A name " +
    "that is not one this instance generated answers 404 — it is never used to " +
    "build a path.",
  tags,
  request: { params: z.object({ filename }) },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    404: { description: "No such image", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/login-backgrounds",
  summary: "Upload background images",
  description:
    "Admin only. `multipart/form-data` with one or more `backgrounds` parts. " +
    "Each file is checked by its magic numbers, never by the mimetype the " +
    "browser claims; a file that fails is deleted and named in `rejected` " +
    "while the rest are kept, so one bad file in ten does not cost the other " +
    "nine. Answers 400 only when NOTHING valid arrived.",
  tags,
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            backgrounds: z.array(z.string()).describe("Image files (JPEG, PNG, WebP or GIF)"),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "What the instance now has, and what this call added or refused",
      content: {
        "application/json": {
          schema: backgroundList.extend({
            accepted: z.array(filename),
            rejected: z.array(z.string()).describe("Original names of files that were not images"),
          }),
        },
      },
    },
    400: { description: "No file, or no valid image among them", content: errorContent },
    401: { description: "Not signed in", content: errorContent },
    403: { description: "Not an admin", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/login-backgrounds/{filename}",
  summary: "Remove a background image",
  description:
    "Admin only, and idempotent — removing one that is already gone answers " +
    "200 with the current list, so the UI never has to ask whether it was " +
    "still there.",
  tags,
  request: { params: z.object({ filename }) },
  responses: {
    200: {
      description: "What is left",
      content: { "application/json": { schema: backgroundList } },
    },
    401: { description: "Not signed in", content: errorContent },
    403: { description: "Not an admin", content: errorContent },
    404: { description: "Not a name this instance would have generated", content: errorContent },
  },
});
