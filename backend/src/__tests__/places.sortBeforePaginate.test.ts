/**
 * AUD-072. `visitCount` and `lastVisit` are derived from each place's visits,
 * so they cannot go into a Prisma `orderBy`. The list paginated in NAME order
 * and sorted the resulting page afterwards — which ranks a slice, not the list.
 * Page one of "most visited" showed the most-visited places whose names happen
 * to begin with A.
 *
 * A page of ONE makes the difference unambiguous: with the bug the answer is
 * whichever place sorts first alphabetically, with the fix it is the one that
 * actually has the most visits.
 */
import request from "supertest";

import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const USERNAME = "placesortbeforepaginate";

describe("the POI list sorts before it slices", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    // Names and visit counts run in OPPOSITE directions on purpose: the
    // alphabetically first place is the least visited and the most recently
    // visited one sorts last by name.
    const spec: { name: string; visits: string[] }[] = [
      { name: "Aaa Wenig", visits: ["2020-01-01"] },
      { name: "Mmm Viel", visits: ["2021-01-01", "2021-02-01", "2021-03-01"] },
      { name: "Zzz Mittel", visits: ["2024-06-01", "2024-07-01"] },
    ];
    for (const { name, visits } of spec) {
      const place = await prisma.place.create({
        data: { userId, name, lat: 52.52, lon: 13.405, visited: true },
      });
      for (const day of visits) {
        await prisma.placeVisit.create({
          data: { placeId: place.id, userId, visitedAt: new Date(`${day}T00:00:00Z`) },
        });
      }
    }
  });

  afterAll(async () => {
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  const list = async (query: string): Promise<{ name: string }[]> => {
    const res = await request(app).get(`/api/v1/places?${query}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body.data;
  };

  it("returns the most-visited place on a page of one, not the first by name", async () => {
    const [first] = await list("sortBy=visitCount&sortOrder=desc&limit=1");
    expect(first.name).toBe("Mmm Viel");
  });

  it("returns the most recently visited place on a page of one", async () => {
    const [first] = await list("sortBy=lastVisit&sortOrder=desc&limit=1");
    expect(first.name).toBe("Zzz Mittel");
  });

  it("ranks the whole list, and reports the whole total", async () => {
    const res = await request(app)
      .get("/api/v1/places?sortBy=visitCount&sortOrder=desc&limit=1")
      .set("Cookie", cookie);

    // A page of one out of three — the client needs the real total to page on.
    expect(res.body.meta.total).toBe(3);
  });

  it("still pages a plain column through the database", async () => {
    // The control: an ordinary column must not fall into the load-everything
    // path just because the derived keys need it.
    const [first] = await list("sortBy=name&sortOrder=asc&limit=1");
    expect(first.name).toBe("Aaa Wenig");
  });
});
