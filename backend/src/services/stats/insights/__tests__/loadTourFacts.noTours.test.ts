import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";

import { prisma } from "../../../../db";
import * as countryFromCoordinates from "../../../geo/countryFromCoordinates";
import { loadTourFacts } from "..";

/**
 * The country boundary index is ~10 MB and takes seconds to build cold. Every
 * badge re-check (inside every save) and every insights request loaded it
 * through loadTourFacts, even for an account without a single tour — which is
 * most of them, and the cold build was also what timed out CI runs at random.
 * Without tours there is nothing to place, so it must not be loaded.
 */
const USER = "load-tour-facts-no-tours";

describe("loadTourFacts for an account without tours", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("returns no facts without loading the boundary index", async () => {
    const spy = jest.spyOn(countryFromCoordinates, "getCountryResolver");
    await expect(loadTourFacts(userId)).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
