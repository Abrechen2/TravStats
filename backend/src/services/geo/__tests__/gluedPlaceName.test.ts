import { normaliseNamePair, splitGluedName } from "../gluedPlaceName";

describe("splitGluedName — two names stored as one (forgejo#199)", () => {
  it.each([
    [
      "Banpo Bridge Moonlight Rainbow Fountain 반포대교 달빛무지개분수",
      "Banpo Bridge Moonlight Rainbow Fountain",
      "반포대교 달빛무지개분수",
    ],
    ["Seoul Station 서울역", "Seoul Station", "서울역"],
    ["Seoul Station (서울역)", "Seoul Station", "서울역"],
    ["Seoul Station - 서울역", "Seoul Station", "서울역"],
    ["Seoul Station / 서울역", "Seoul Station", "서울역"],
    ["Tokyo Tower 東京タワー", "Tokyo Tower", "東京タワー"],
    ["Red Square Красная площадь", "Red Square", "Красная площадь"],
    ["Acropolis Ακρόπολη", "Acropolis", "Ακρόπολη"],
    ["Hà Nội Opera Nhà hát 河內", "Hà Nội Opera Nhà hát", "河內"],
    ["Line 2 Station 서울역 2", "Line 2 Station", "서울역 2"],
  ])("splits %j", (input, name, localName) => {
    expect(splitGluedName(input)).toEqual({ name, localName });
  });

  it.each([
    ["Café № 5", "a letterlike sign is not a second name"],
    ["Hotel ★★★", "symbols carry no letter"],
    ["Bar ♥", "a single symbol"],
    ["Pizza Napoli ☕", "a single emoji"],
    ["Hà Nội", "Latin with accents"],
    ["Hà Nội", "Latin with accents, decomposed"],
    ["Lëtzebuerg", "Latin"],
    ["반포대교", "one name in one script"],
    ["교촌치킨 서울시청점", "two words, both in one non-Latin script"],
    ["한국은행 화폐박물관", "the same, a museum"],
    ["Gangnam 강남 Station", "the other script is not at the end"],
    ["Cafe ♥ 사랑", "the prefix holds a symbol outside Latin script"],
    ["N서울타워", "one word mixing both scripts"],
    ["123 서울", "no Latin letter in front"],
    ["", "empty"],
  ])("leaves %j alone (%s)", (input) => {
    expect(splitGluedName(input)).toBeNull();
  });
});

describe("normaliseNamePair", () => {
  it("splits a glued name when no second name was given", () => {
    expect(normaliseNamePair("Seoul Station 서울역", undefined)).toEqual({
      name: "Seoul Station",
      localName: "서울역",
    });
    expect(normaliseNamePair("Seoul Station 서울역", null)).toEqual({
      name: "Seoul Station",
      localName: "서울역",
    });
  });

  it("keeps a given second name and does not re-read the first", () => {
    expect(normaliseNamePair("Seoul Station 서울역", "서울역사")).toEqual({
      name: "Seoul Station 서울역",
      localName: "서울역사",
    });
  });

  it("drops a second name that only repeats the first", () => {
    expect(normaliseNamePair("반포대교", "반포대교")).toEqual({
      name: "반포대교",
      localName: null,
    });
  });

  it("stores no second name for a plain one", () => {
    expect(normaliseNamePair("Brandenburger Tor", "  ")).toEqual({
      name: "Brandenburger Tor",
      localName: null,
    });
  });
});
