import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { generateToken } from "../../../utils/jwt";
import {
  makeRequest,
  makeUser,
  peerKey,
} from "../../../services/federation/__tests__/admissionFixture";

const ORIGIN = "https://route.admissions.test";
const cookie = (id: string) => `auth_token=${generateToken(id)}`;
let admin: { id: string };
let user: { id: string };

beforeAll(async () => {
  admin = await makeUser("adm-route-admin", true);
  user = await makeUser("adm-route-user");
});
afterEach(async () => {
  await prisma.federationAdmissionRequest.deleteMany({ where: { localUserId: user.id } });
  await prisma.comparisonPeer.deleteMany({ where: { origin: ORIGIN } });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, user.id] } } });
  await prisma.$disconnect();
});

it("non-admin gets 403", async () => {
  const row = await makeRequest(user.id, ORIGIN, peerKey());
  for (const [method, path] of [
    ["get", "/api/v1/admin/federation/admissions"],
    ["post", `/api/v1/admin/federation/admissions/${row.id}/approve`],
    ["post", `/api/v1/admin/federation/admissions/${row.id}/decline`],
  ] as const) {
    const res = await request(app)[method](path).set("Cookie", cookie(user.id)).send({});
    expect(res.status).toBe(403);
  }
  expect(
    (await prisma.federationAdmissionRequest.findUniqueOrThrow({ where: { id: row.id } })).status
  ).toBe("pending");
});

it("the admin lists, approves and declines", async () => {
  const key = peerKey();
  const row = await makeRequest(user.id, ORIGIN, key);
  const list = await request(app)
    .get("/api/v1/admin/federation/admissions")
    .set("Cookie", cookie(admin.id));
  expect(list.status).toBe(200);
  expect(list.body.admissions.find((a: { id: string }) => a.id === row.id)).toMatchObject({
    origin: ORIGIN,
    fingerprint: key.fingerprint,
    status: "pending",
    direction: "incoming",
  });
  const approve = await request(app)
    .post(`/api/v1/admin/federation/admissions/${row.id}/approve`)
    .set("Cookie", cookie(admin.id))
    .send({});
  expect(approve.status).toBe(200);
  expect(approve.body.status).toBe("approved");
  const again = await request(app)
    .post(`/api/v1/admin/federation/admissions/${row.id}/decline`)
    .set("Cookie", cookie(admin.id))
    .send({});
  expect(again.status).toBe(409);
  expect(again.body.code).toBe("FEDERATION_ADMISSION_NOT_PENDING");
});
