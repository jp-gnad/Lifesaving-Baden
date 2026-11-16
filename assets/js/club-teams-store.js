(function (root) {
  "use strict";
  const core = typeof module === "object" && module.exports ? require("./club-teams-core.js") : root.ClubTeamsCore;
  const clubs = typeof module === "object" && module.exports ? require("./clubs-store.js") : root.ClubsStore;
  const fail = (message) => { throw Object.assign(new Error(message), { code: "clubs/team" }); };

  async function save(db, clubId, year, id, selected, expected, sdk, checkSession = () => {}) {
    const club = db.collection("clubs").doc(clubId);
    const ref = club.collection("teamSeasons").doc(String(year));
    // Populate the optional, source-checked gender on legacy roster records.
    // Each refresh retains active years, evidence and the original incarnation.
    for (const person of selected || []) {
      checkSession();
      if (!core.gender(person.rosterGender)) await clubs.refreshIdentity(db, clubId, person.id, sdk, checkSession, person.createdAt);
    }
    const records = selected === null ? null : await Promise.all(selected.map((person) => club.collection("people").doc(person.id).get({ source: "server" })));
    const members = records?.map((record, index) => {
      if (!record.exists || !record.data().createdAt.isEqual(selected[index].createdAt)) fail("Eine Person wurde entfernt. Bitte erneut öffnen.");
      return { ...record.data(), id: record.id };
    }) ?? null;
    checkSession();
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const season = snapshot.data() || {};
      checkSession();
      const next = core.change(season, id, members, year, expected);
      transaction.set(ref, { ...next, updatedAt: sdk.FieldValue.serverTimestamp() });
      return next;
    });
  }

  const api = Object.freeze({ save });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubTeamsStore = api;
})(typeof window === "object" ? window : globalThis);
