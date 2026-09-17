/**
 * E2E — a multi-leg booking mail through the review wizard (forgejo#56, gap 2).
 *
 * Bulk-write paths are where an E2E earns the most, and this one has a history
 * a unit test cannot see because it lives in the ORDER of the wizard's steps:
 * the intermediate steps only accumulate and the last one sends the whole
 * batch (forgejo#14 — every step used to say "Weiter", including the one that
 * writes), and a replayed wizard once discarded records (forgejo#13).
 *
 * The mail is SYNTHETIC — the layout of a Lufthansa "Buchungsdetails" mail with
 * invented airports, numbers and booking code, the same text the template unit
 * test uses (backend/src/__tests__/templates/segments.test.ts). Never put a real
 * booking in this tree: this repository is public.
 *
 * DETERMINISM. When the instance has an Ollama URL configured, the language
 * model is asked BEFORE the templates (services/parsers/email.ts), and its
 * answer is neither stable nor available in CI. So the spec clears the admin
 * Ollama URL for its run and restores it afterwards, and it asserts that the
 * template really answered — a server started with OLLAMA_URL in its
 * environment fails here with that message instead of producing a flaky pass.
 */
import fs from "fs";
import path from "path";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

import { adminApi, createAccount, deleteAccount, type TestAccount } from "./support/accounts";

const MAIL = path.join(__dirname, "fixtures", "lh-buchungsdetails-synthetic.eml");
// Departures as UTC instants. The mail gives local wall-clock times, so these
// also pin the time-zone conversion: MUC and FRA are UTC+1 in November, LAX is
// UTC-8 — "Do. 30. November 2023, 17:30 Uhr" in Los Angeles is already the
// first of December in UTC.
const LEGS = [
  { flightNumber: "LH99", route: "MUC-FRA", departure: "2023-11-23T08:00" },
  { flightNumber: "LH4352", route: "FRA-LAS", departure: "2023-11-23T10:05" },
  { flightNumber: "LH453", route: "LAX-MUC", departure: "2023-12-01T01:30" },
];

test.use({ storageState: { cookies: [], origins: [] } });

/** The review form is controlled inputs: the value lives on the property, not the attribute. */
async function expectFieldShowing(page: Page, value: string): Promise<void> {
  await expect
    .poll(
      () =>
        page
          .locator("input")
          .evaluateAll(
            (inputs, wanted) =>
              inputs.some((i) => (i as HTMLInputElement).value.replace(/\s+/g, "") === wanted),
            value
          ),
      { timeout: 20_000 }
    )
    .toBe(true);
}

test.describe("booking mail with three legs", () => {
  let admin: APIRequestContext;
  let account: TestAccount | undefined;
  let previousOllama: { ollamaUrl: string | null } | undefined;

  test.beforeEach(async ({ baseURL }) => {
    admin = await adminApi(baseURL!);
    const current = await admin.get("/api/v1/admin/parser-settings");
    expect(current.ok(), await current.text()).toBe(true);
    previousOllama = {
      ollamaUrl: ((await current.json()) as { ollamaUrl: string | null }).ollamaUrl,
    };
    const cleared = await admin.put("/api/v1/admin/parser-settings", { data: { ollamaUrl: null } });
    expect(cleared.ok(), await cleared.text()).toBe(true);

    account = await createAccount(admin, "e2e-import");
  });

  test.afterEach(async () => {
    // Deleting the account cascades to the flights and the trip it made.
    await deleteAccount(admin, account);
    if (previousOllama) {
      await admin.put("/api/v1/admin/parser-settings", { data: previousOllama });
    }
    await admin.dispose();
  });

  test("is read by the template, reviewed leg by leg, and written once as three flights", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.fill("input#username", account!.username);
    await page.fill("input#password", account!.password);
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    // Precondition, stated as one: the template answered, not a language model.
    const probe = await page.request.post("/api/v1/parse-email-file", {
      multipart: {
        email: {
          name: "booking.eml",
          mimeType: "message/rfc822",
          buffer: fs.readFileSync(MAIL),
        },
      },
    });
    expect(probe.ok(), await probe.text()).toBe(true);
    const parsed = (await probe.json()) as { parserUsed: string; flights: unknown[] };
    expect(
      parsed.parserUsed,
      "the template must answer — is OLLAMA_URL set in the server's environment?"
    ).not.toBe("ollama");
    expect(parsed.flights).toHaveLength(3);

    await page.goto("/flights");
    await page
      .getByRole("button", { name: /^\+?\s*Flug hinzufügen$|^\+?\s*Add flight$/i })
      .first()
      .click();
    await page.locator('input[type="file"]').first().setInputFiles(MAIL);

    // Steps one and two only accumulate: they must say so, and must not write.
    for (let step = 0; step < LEGS.length - 1; step++) {
      await expectFieldShowing(page, LEGS[step].flightNumber);
      await page.getByRole("button", { name: /^Weiter$|^Next$/ }).click();
    }
    const beforeLast = await page.request.get("/api/v1/flights");
    expect(((await beforeLast.json()) as { total: number }).total).toBe(0);

    // The last step names the write and its size (forgejo#14).
    await expectFieldShowing(page, LEGS[2].flightNumber);
    const commit = page.getByRole("button", { name: /3 Flüge importieren|Import 3 flights/i });
    await expect(commit).toBeVisible();
    await commit.click();

    // All three arrived — none dropped by the batch (forgejo#13), and with the
    // year the mail carries, not today's (forgejo#18).
    await expect
      .poll(
        async () =>
          ((await (await page.request.get("/api/v1/flights")).json()) as { total: number }).total,
        {
          timeout: 20_000,
        }
      )
      .toBe(3);
    const { flights } = (await (await page.request.get("/api/v1/flights")).json()) as {
      flights: Array<{
        flightNumber: string;
        depIata: string;
        arrIata: string;
        departureTime: string;
      }>;
    };
    const seen = flights
      .map((f) => ({
        flightNumber: f.flightNumber.replace(/\s+/g, ""),
        route: `${f.depIata}-${f.arrIata}`,
        departure: new Date(f.departureTime).toISOString().slice(0, 16),
      }))
      .sort((a, b) => a.flightNumber.localeCompare(b.flightNumber));
    expect(seen).toEqual([...LEGS].sort((a, b) => a.flightNumber.localeCompare(b.flightNumber)));
  });
});
