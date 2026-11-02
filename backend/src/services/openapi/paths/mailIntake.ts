/**
 * Mail intake (forgejo#313): booking mails read from a mailbox and proposed in
 * the inbox. Spec: docs/superpowers/specs/2026-10-17-mail-intake-design.md.
 */
import { registry } from "../registry";
import {
  addressResponseSchema,
  idParamsSchema,
  inboxSchema,
  instanceSourceBodySchema,
  instanceStatusSchema,
  mailIntakeStatusSchema,
  okSchema,
  personalSourceBodySchema,
  runResultSchema,
  senderBodySchema,
  sourceViewSchema,
  testResultSchema,
} from "../../../schemas/mailIntake";
import { errorContent } from "./shared";

const tags = ["Mail intake"];
const json = <T extends import("zod").ZodType>(schema: T) => ({ "application/json": { schema } });
const op = (
  method: "get" | "put" | "post" | "delete",
  path: string,
  summary: string,
  description: string,
  response: import("zod").ZodType,
  body?: import("zod").ZodType,
  withId = false
) =>
  registry.registerPath({
    method,
    path: `/mail-intake${path}`,
    summary,
    description,
    tags,
    request: {
      ...(withId ? { params: idParamsSchema } : {}),
      ...(body ? { body: { content: json(body) } } : {}),
    },
    responses: {
      200: { description: summary, content: json(response) },
      400: { description: "VALIDATION_FAILED", content: errorContent },
      404: {
        description: "MAIL_SOURCE_NOT_FOUND or MAIL_MESSAGE_NOT_FOUND",
        content: errorContent,
      },
      409: {
        description: "MAIL_INTAKE_OFF, NOT_CONFIGURED or MAIL_DOCUMENT_GONE",
        content: errorContent,
      },
    },
  });

op(
  "get",
  "",
  "This account's mail intake: its mailbox, forwarding address and allowed senders",
  "Everything is off until a mailbox is saved and switched on. The password is never returned " +
    "(`hasPassword`). `off` says whether the admin switched the service off.",
  mailIntakeStatusSchema
);
op(
  "put",
  "/source",
  "Save the account's own IMAP folder",
  "TLS or STARTTLS only. Omitting `password` keeps the stored one. A new host, user or folder " +
    "restarts the scan; mails already taken are never taken twice.",
  sourceViewSchema,
  personalSourceBodySchema
);
op(
  "delete",
  "/source",
  "Remove the IMAP folder",
  "Its mails stay as unfiled documents until the sweep.",
  okSchema
);
op(
  "post",
  "/source/test",
  "Test the connection",
  "Logs in and opens the folder; reads and changes no mail. A failure carries its own kind.",
  testResultSchema
);
op(
  "post",
  "/source/run",
  "Check the folder now",
  "Runs the same pass the 5-minute poll does. Rate limited per user.",
  runResultSchema
);
op(
  "post",
  "/address",
  "Issue (or replace) the personal forwarding address",
  "The previous address stops working at once. 409 NOT_CONFIGURED when the instance has no mailbox.",
  addressResponseSchema
);
op(
  "delete",
  "/address",
  "Revoke the forwarding address",
  "Mail sent to it is rejected from then on.",
  addressResponseSchema
);
op(
  "post",
  "/senders",
  "Allow a sender for the forwarding address",
  "Mail to the account's address from any other sender is rejected.",
  mailIntakeStatusSchema,
  senderBodySchema
);
op(
  "delete",
  "/senders/{id}",
  "Remove an allowed sender",
  "",
  mailIntakeStatusSchema,
  undefined,
  true
);
op(
  "get",
  "/inbox",
  "Cards for the inbox: proposals, rejections, failures",
  "Proposals only; no entry exists until the user confirms. `sourceProblem` repeats the settings card's error.",
  inboxSchema
);
op(
  "post",
  "/messages/{id}/dismiss",
  "Hide a card",
  "The mail stays an unfiled document until the sweep.",
  okSchema,
  undefined,
  true
);
op(
  "post",
  "/messages/{id}/retry",
  "Read a failed or empty mail again",
  "Uses the kept original.",
  okSchema,
  undefined,
  true
);
op(
  "post",
  "/messages/{id}/allow-sender",
  "Allow the sender of a rejected mail",
  "Takes effect for the next forward; the rejected mail was not kept.",
  okSchema,
  undefined,
  true
);
op(
  "get",
  "/instance",
  "The instance mailbox behind the forwarding addresses (admin)",
  "",
  instanceStatusSchema
);
op(
  "put",
  "/instance",
  "Save the instance mailbox (admin)",
  "`tlsMode: none` (plain IMAP) is accepted here only, for a LAN mail server.",
  instanceStatusSchema,
  instanceSourceBodySchema
);
op(
  "delete",
  "/instance",
  "Remove the instance mailbox (admin)",
  "Every forwarding address stops working.",
  okSchema
);
op(
  "post",
  "/instance/test",
  "Test the instance mailbox (admin)",
  "As the personal test.",
  testResultSchema
);
