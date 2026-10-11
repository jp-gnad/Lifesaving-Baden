// Run only against a local Firestore emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8082
// No Firebase credentials, real accounts or production requests are used.
const test = require("node:test");
const assert = require("node:assert/strict");
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulator || !/^(127\.0\.0\.1|localhost):\d+$/.test(emulator)) {
  throw new Error("Set FIRESTORE_EMULATOR_HOST to a local emulator address before running these tests.");
}
const project = "demo-training";
const base = `http://${emulator}/v1/projects/${project}/databases/(default)/documents`;
const path = (collection, id) => `projects/${project}/databases/(default)/documents/${collection}/${id}`;
const date = "2026-10-10T00:00:00Z";
const identities = {
  anna: { uid: "anna", role: "kader-sportler" },
  ben: { uid: "ben", role: "kader-sportler" },
  sportler: { uid: "sportler", role: "sportler" },
  organizer: { uid: "organizer", role: "organisator" },
  admin: { uid: "admin", role: "admin" },
  unverified: { uid: "unverified", role: "kader-sportler", verified: false }
};

function token(identity) {
  const seconds = Math.floor(Date.now() / 1000);
  const payload = { sub: identity.uid, user_id: identity.uid, aud: project,
    iss: `https://securetoken.google.com/${project}`, iat: seconds, exp: seconds + 3600,
    email: `${identity.uid}@example.test`, email_verified: identity.verified !== false,
    firebase: { sign_in_provider: "password", identities: {} } };
  return `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.`;
}
function fields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
    value && typeof value === "object" ? value : typeof value === "number" ? { integerValue: String(value) }
      : typeof value === "boolean" ? { booleanValue: value } : { stringValue: String(value) }]));
}
async function request(endpoint, identity, body, method = body ? "POST" : "GET") {
  const headers = { "Content-Type": "application/json" };
  if (identity) headers.Authorization = `Bearer ${identity === "owner" ? "owner" : token(identity)}`;
  const response = await fetch(endpoint, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}
async function allowed(response) { const result = await response; assert.equal(result.status, 200, JSON.stringify(result.data)); return result; }
async function denied(response) { const result = await response; assert.equal(result.status, 403, JSON.stringify(result.data)); }
function write(collection, id, data, create = true) {
  const update = { name: path(collection, id), fields: fields(data) };
  const updateTransforms = [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }];
  if (create) updateTransforms.push({ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" });
  return { update, updateTransforms };
}
function triplet(id, identity, changes = {}, create = true) {
  const common = { uid: identity.uid, date: { timestampValue: date }, ...changes.common };
  return [
    write("trainingEntries", id, { ...common, athleteName: identity.uid, meters: 3000, ...changes.entry }, create),
    write("trainingMetrics", id, { ...common, motivation: 7, ...changes.metrics }, create),
    write("trainingNotes", id, { ...common, text: "Privater Rückblick", ...changes.note }, create)
  ];
}
const commit = (identity, writes) => request(`${base}:commit`, identity, { writes });
const get = (identity, collection, id) => request(`${base}/${collection}/${id}`, identity);
const query = (identity, collection, uid) => request(`${base}:runQuery`, identity, { structuredQuery: {
  from: [{ collectionId: collection }], ...(uid ? { where: { fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: uid } } } } : {})
} });
const remove = (id) => ["trainingEntries", "trainingMetrics", "trainingNotes"].map((collection) => ({ delete: path(collection, id) }));

test("training security rules protect roles, ownership, private notes and atomic writes", async (t) => {
  for (const identity of Object.values(identities)) {
    await allowed(commit("owner", [{ update: { name: path("users", identity.uid), fields: fields({ role: identity.role }) } }]));
  }
  await t.test("eligible athletes, organizers and admins can create complete entries", async () => {
    for (const name of ["anna", "ben", "organizer", "admin"]) await allowed(commit(identities[name], triplet(name, identities[name])));
  });
  await t.test("ordinary/unverified athletes and guests cannot create or read the Kader ranking", async () => {
    for (const identity of [identities.sportler, identities.unverified, null]) {
      if (identity) await denied(commit(identity, triplet(`blocked-${identity.uid}`, identity)));
      await denied(get(identity, "trainingEntries", "anna"));
      await denied(query(identity, "trainingEntries"));
    }
  });
  await t.test("users cannot grant Kader flags to themselves, including at profile creation", async () => {
    for (const flag of ["kader", "isKaderAthlete"]) {
      await denied(commit(identities.sportler, [{ update: { name: path("users", "sportler"), fields: fields({ role: "sportler", [flag]: true }) } }]));
      const identity = { uid: `new-${flag}` };
      await denied(commit(identity, [{ update: { name: path("users", identity.uid), fields: fields({ role: "sportler", [flag]: true }) } }]));
    }
  });
  await t.test("distance ranking is visible to Kader, while motivation is owner/organizer only", async () => {
    await allowed(query(identities.ben, "trainingEntries"));
    await allowed(query(identities.anna, "trainingMetrics", "anna"));
    await denied(query(identities.ben, "trainingMetrics"));
    await denied(get(identities.ben, "trainingMetrics", "anna"));
    await allowed(query(identities.organizer, "trainingMetrics"));
    await allowed(query(identities.admin, "trainingMetrics"));
  });
  await t.test("private diary texts are unreadable by every other account, including admins", async () => {
    await allowed(get(identities.anna, "trainingNotes", "anna"));
    await allowed(query(identities.anna, "trainingNotes", "anna"));
    for (const name of ["ben", "organizer", "admin"]) await denied(get(identities[name], "trainingNotes", "anna"));
    await denied(query(identities.organizer, "trainingNotes"));
  });
  await t.test("partial, forged, invalid and oversized entry batches are rejected", async () => {
    await denied(commit(identities.anna, [triplet("partial", identities.anna)[0]]));
    await denied(commit(identities.anna, triplet("forged", identities.ben)));
    await denied(commit(identities.anna, triplet("negative", identities.anna, { entry: { meters: -1 } })));
    await denied(commit(identities.anna, triplet("large", identities.anna, { entry: { meters: 100001 } })));
    await denied(commit(identities.anna, triplet("fraction", identities.anna, { entry: { meters: { doubleValue: 1.5 } } })));
    await denied(commit(identities.anna, triplet("motivation", identities.anna, { metrics: { motivation: 11 } })));
    await denied(commit(identities.anna, triplet("note", identities.anna, { note: { text: "x".repeat(5001) } })));
    await denied(commit(identities.anna, triplet("midday", identities.anna, { common: { date: { timestampValue: "2026-10-10T12:00:00Z" } } })));
    await denied(commit(identities.anna, triplet("mismatch", identities.anna, { metrics: { date: { timestampValue: "2026-10-09T00:00:00Z" } } })));
  });
  await t.test("only owners can update a complete triplet, preserving uid and creation time", async () => {
    const stored = await allowed(get(identities.anna, "trainingEntries", "anna"));
    const createdAt = stored.data.fields.createdAt;
    await allowed(commit(identities.anna, triplet("anna", identities.anna, { common: { createdAt }, entry: { meters: 4000 } }, false)));
    await denied(commit(identities.ben, triplet("anna", identities.ben, { common: { createdAt } }, false)));
    await denied(commit(identities.organizer, triplet("anna", identities.anna, { common: { createdAt } }, false)));
    const partial = triplet("anna", identities.anna, { common: { createdAt }, entry: { meters: 2000 } }, false);
    await denied(commit(identities.anna, [partial[0]]));
  });
  await t.test("owners can remove all associated data in one batch, including after a role downgrade", async () => {
    await denied(commit(identities.ben, remove("anna")));
    await denied(commit(identities.anna, [{ delete: path("trainingEntries", "anna") }]));
    await denied(commit(identities.anna, [{ delete: path("trainingNotes", "anna") }]));
    await allowed(commit("owner", [{ update: { name: path("users", "anna"), fields: fields({ role: "sportler" }) } }]));
    await allowed(query(identities.anna, "trainingEntries", "anna"));
    await denied(query(identities.anna, "trainingEntries"));
    await denied(get(identities.anna, "trainingNotes", "anna"));
    await allowed(commit(identities.anna, remove("anna")));
    assert.equal((await get("owner", "trainingNotes", "anna")).status, 404);
  });
  await t.test("four-entry account cleanup fits the rules access limit", async () => {
    for (let index = 0; index < 4; index += 1) await allowed(commit(identities.ben, triplet(`cleanup-${index}`, identities.ben)));
    await allowed(commit(identities.ben, Array.from({ length: 4 }, (_, index) => remove(`cleanup-${index}`)).flat()));
  });
});
