import { prisma } from "../db";
import { getBaseCurrency } from "../services/fx/snapshot";
import { BULK_CITIES } from "./bulk";
import { seedFxColumns } from "./stayFx";

/** Stays and places outside the narrated trips, plus two user lists across them. */
export async function seedBulk(userId: string): Promise<{ stays: number; places: number; lists: number }> {
  // The base currency the money figures are reported in. Without a snapshot
  // into it, a priced stay counts as "not converted" and never reaches the
  // total (finding B4, independent review 2026-09-17).
  const baseCurrency = await getBaseCurrency(userId);
  let stays = 0;
  const placeIds: Array<{ id: string; category: string; visited: boolean }> = [];

  for (const [i, c] of BULK_CITIES.entries()) {
    const h = c.hotel;
    const lodging = await prisma.lodging.create({
      data: {
        userId,
        type: h.type,
        name: h.name,
        city: c.city,
        country: c.country,
        isoCountryCode: c.iso,
        lat: h.lat,
        lon: h.lon,
        stars: h.stars,
        dataSource: "manual",
      },
    });
    const checkIn = new Date(Date.UTC(h.year, (i * 5) % 12, 3 + (i % 20)));
    const checkOut = new Date(checkIn.getTime() + h.nights * 86_400_000);
    await prisma.lodgingStay.create({
      data: {
        lodgingId: lodging.id,
        userId,
        checkIn,
        checkOut,
        nights: h.nights,
        status: "completed",
        board: i % 3 === 0 ? "breakfast" : "none",
        guests: 2,
        currency: h.currency,
        totalPrice: h.price,
        ...seedFxColumns({ totalPrice: h.price, currency: h.currency, checkIn }, baseCurrency),
        ratingOverall: h.rating,
        dataSource: "manual",
      },
    });
    stays++;

    for (const p of c.places) {
      const place = await prisma.place.create({
        data: {
          userId,
          name: p.name,
          category: p.category,
          lat: p.lat,
          lon: p.lon,
          city: c.city,
          country: c.country,
          isoCountryCode: c.iso,
          visited: p.visited,
          dataSource: "manual",
        },
      });
      if (p.visited) {
        await prisma.placeVisit.create({
          data: { placeId: place.id, userId, visitedAt: new Date(checkIn.getTime() + 86_400_000) },
        });
      }
      placeIds.push({ id: place.id, category: p.category, visited: p.visited });
    }
  }

  const lists = [
    { name: "Aussichtspunkte", color: "#60a5fa", icon: "🔭", members: placeIds.filter((p) => p.category === "viewpoint") },
    { name: "Nächstes Mal", color: "#f472b6", icon: "📌", members: placeIds.filter((p) => !p.visited) },
  ];
  for (const [sortIdx, l] of lists.entries()) {
    const list = await prisma.placeList.create({ data: { userId, name: l.name, color: l.color, icon: l.icon, sortIdx } });
    await prisma.placeListEntry.createMany({
      data: l.members.map((m, i) => ({ listId: list.id, placeId: m.id, sortIdx: i })),
    });
  }

  return { stays, places: placeIds.length, lists: lists.length };
}
