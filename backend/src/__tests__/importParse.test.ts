/**
 * Unit tests for the parser modules used by /api/v1/import/parse,
 * plus a thin integration test for the route handler itself. The
 * parsers mirror the corresponding frontend tests so they regress in
 * lockstep with the browser-side parsers.
 */
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../utils/jwtSecret";
import { parseFr24 } from "../services/parsers/fr24";
import { parseGenericCsv } from "../services/parsers/genericCsv";

const FR24_FIXTURE = `
Date,"Flight number",From,To,"Dep time","Arr time",Duration,Airline,Aircraft,Registration,"Seat number","Seat type","Flight class","Flight reason",Note,Dep_id,Arr_id,Airline_id,Aircraft_id
2024-06-15,LH1844,"Munich / Franz Josef Strauss (MUC/EDDM)","Rome / Fiumicino (FCO/LIRF)",09:30:00,11:15:00,01:45:00,"Lufthansa (LH/DLH)","Airbus A320-200 (A320)",D-AIPA,14C,1,1,1,Test,524,1571,1102,87
2023-03-15,AF191,"Bengaluru / Kempegowda International (BLR/VOBL)","Paris / Charles de Gaulle (CDG/LFPG)",01:30:00,08:00:00,09:30:00,"Air France (AF/AFR)","Boeing 777-300ER (B77W)",F-GSQK,12A,1,3,2,BLR-edge,1234,5678,42,99
`;

describe("parsers/fr24 (backend)", () => {
  it("parses well-formed FR24 CSV into PreviewRowInput rows", () => {
    const result = parseFr24(FR24_FIXTURE);
    expect(result.parserErrors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      date: "2024-06-15",
      fromIata: "MUC",
      toIata: "FCO",
      flightNumber: "LH1844",
      durationSeconds: 1 * 3600 + 45 * 60,
      seatClass: "economy",
      category: "vacation",
      source: "fr24",
      sourceRowIndex: 0,
    });
  });

  it("flags missing-required-header errors instead of crashing", () => {
    const broken = "wrong,headers\n2024-01-01,foo\n";
    const result = parseFr24(broken);
    expect(result.rows).toHaveLength(0);
    expect(result.parserErrors.length).toBeGreaterThan(0);
    expect(result.parserErrors[0].message).toMatch(/Missing required header/);
  });

  it("flags rows with malformed dates per-row, not the whole batch", () => {
    const oneBadRow = `
Date,"Flight number",From,To,"Dep time","Arr time",Duration,Airline,Aircraft,Registration,"Seat number","Seat type","Flight class","Flight reason",Note,Dep_id,Arr_id,Airline_id,Aircraft_id
2024-13-99,LH1,"a (FRA/EDDF)","b (JFK/KJFK)",10:00:00,12:00:00,02:00:00,Lufthansa,A320,X,1A,1,1,1,,1,2,3,4
2024-06-15,LH2,"a (FRA/EDDF)","b (JFK/KJFK)",10:00:00,12:00:00,02:00:00,Lufthansa,A320,X,1A,1,1,1,,1,2,3,4
`;
    const result = parseFr24(oneBadRow);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].flightNumber).toBe("LH2");
    expect(result.parserErrors).toHaveLength(1);
    expect(result.parserErrors[0].field).toBe("Date");
  });
});

describe("parsers/genericCsv (backend)", () => {
  const FLAT = `date,fromIata,toIata,depTime,arrTime,flight
2024-06-15,MUC,FCO,09:30:00,11:15:00,LH1844
2024-06-22,FCO,MUC,18:00:00,20:00:00,LH1845
`;

  it("applies the mapping and emits PreviewRowInput rows", () => {
    const result = parseGenericCsv(FLAT, {
      date: "date",
      fromIata: "fromIata",
      toIata: "toIata",
      depTimeLocal: "depTime",
      arrTimeLocal: "arrTime",
      flightNumber: "flight",
    });
    expect(result.parserErrors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      date: "2024-06-15",
      fromIata: "MUC",
      toIata: "FCO",
      depTimeLocal: "09:30:00",
      flightNumber: "LH1844",
      source: "generic_csv",
    });
  });

  it("rejects payload when a required field is unmapped", () => {
    const result = parseGenericCsv(FLAT, {
      // fromIata + toIata mapped but date missing
      fromIata: "fromIata",
      toIata: "toIata",
    });
    expect(result.rows).toHaveLength(0);
    expect(result.parserErrors[0].message).toMatch(/Required field is unmapped: date/);
  });

  it("uppercases IATA codes regardless of source casing", () => {
    const lower = `date,from,to\n2024-06-15,muc,fco\n`;
    const result = parseGenericCsv(lower, {
      date: "date",
      fromIata: "from",
      toIata: "to",
    });
    expect(result.rows[0].fromIata).toBe("MUC");
    expect(result.rows[0].toIata).toBe("FCO");
  });
});

describe("POST /api/v1/import/parse", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "test-import-parse-route-" + Date.now(), passwordHash: "x" },
    });
    userId = user.id;
    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1h" });
    cookie = `auth_token=${token}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app)
      .post("/api/v1/import/parse")
      .send({ source: "fr24", csv: "header,here\n1,2\n" });
    expect(res.status).toBe(401);
  });

  it("parses an FR24 payload via the route", async () => {
    const csv = `
Date,"Flight number",From,To,"Dep time","Arr time",Duration,Airline,Aircraft,Registration,"Seat number","Seat type","Flight class","Flight reason",Note,Dep_id,Arr_id,Airline_id,Aircraft_id
2024-06-15,LH1844,"Munich (MUC/EDDM)","Rome (FCO/LIRF)",09:30:00,11:15:00,01:45:00,Lufthansa,A320,D-AIPA,14C,1,1,1,Test,1,2,3,4
`;
    const res = await request(app)
      .post("/api/v1/import/parse")
      .set("Cookie", cookie)
      .send({ source: "fr24", csv });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({
      fromIata: "MUC",
      toIata: "FCO",
      flightNumber: "LH1844",
      source: "fr24",
    });
    expect(res.body.parserErrors).toHaveLength(0);
  });

  it("parses a generic-CSV payload with mapping", async () => {
    const res = await request(app)
      .post("/api/v1/import/parse")
      .set("Cookie", cookie)
      .send({
        source: "generic_csv",
        csv: "date,from,to\n2024-06-15,muc,fco\n",
        mapping: { date: "date", fromIata: "from", toIata: "to" },
      });
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].fromIata).toBe("MUC");
  });

  it("rejects malformed body with 400", async () => {
    const res = await request(app)
      .post("/api/v1/import/parse")
      .set("Cookie", cookie)
      .send({ source: "unknown_kind", csv: "x" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects oversized CSV body with 400 (zod max)", async () => {
    const huge = "x".repeat(2_000_001);
    const res = await request(app)
      .post("/api/v1/import/parse")
      .set("Cookie", cookie)
      .send({ source: "fr24", csv: huge });
    expect(res.status).toBe(400);
  });
});
