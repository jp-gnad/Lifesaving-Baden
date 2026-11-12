(function (root) {
  "use strict";

  function linkedPerson(data) {
    const person = data?.personLink;
    return person && typeof person.id === "string" && /^[a-f0-9]{16}$/.test(person.id)
      && typeof person.name === "string" && person.name.trim()
      && Number.isInteger(person.birthYear) && person.birthYear >= 1900
      && ["m", "w"].includes(person.gender) && typeof person.organization === "string" ? person : null;
  }

  function fail(code) { throw Object.assign(new Error(code), { code }); }

  function syncClubProfile(transaction, db, uid, data) {
    const core = typeof module === "object" && module.exports ? require("./clubs-core.js") : root.ClubsCore;
    const profile = core.profile(data);
    const ref = db.collection("clubProfiles").doc(uid);
    if (["trainer", "organizer", "admin"].includes(profile.role) || profile.personId) transaction.set(ref, profile);
    else transaction.delete(ref);
  }

  async function commit(db, uid, candidateId, actor, fieldValue, checkSession = () => {}) {
    if (candidateId !== null && !/^[a-f0-9]{16}$/.test(candidateId)) fail("person-link/invalid-person");
    const userRef = db.collection("users").doc(uid);
    const result = await db.runTransaction(async (transaction) => {
      checkSession();
      const account = await transaction.get(userRef);
      if (!account.exists) fail("person-link/account-missing");
      const previous = linkedPerson(account.data());
      let person = null;
      let reservation;
      if (candidateId !== null) {
        const source = await transaction.get(db.collection("timerParticipantDirectory").doc(candidateId));
        if (!source.exists) fail("person-link/person-missing");
        const { name, birthYear, gender, organization } = source.data();
        person = linkedPerson({ personLink: { id: candidateId, name, birthYear, gender, organization } });
        if (!person) fail("person-link/invalid-person");
        reservation = db.collection("personAccountLinks").doc(candidateId);
        const occupied = await transaction.get(reservation);
        if (occupied.exists && occupied.data().uid !== uid) fail("person-link/already-linked");
        if (!occupied.exists) transaction.set(reservation, { uid });
      }
      checkSession();
      if (previous && previous.id !== candidateId) {
        transaction.delete(db.collection("personAccountLinks").doc(previous.id));
      }
      transaction.update(userRef, {
        personLink: person || fieldValue.delete(),
        linkedPersonId: fieldValue.delete(), personId: fieldValue.delete(), personLinked: fieldValue.delete(),
        personLinkStatus: person ? "linked" : "open",
        personLinkRequest: fieldValue.delete(), personLinkIdentityHint: fieldValue.delete(), personLinkIssue: fieldValue.delete(),
        personLinkDecision: {
          status: person ? "linked" : "unlinked", personId: candidateId || "",
          decidedByUid: actor.uid, decidedByEmail: actor.email || "", decidedAt: fieldValue.serverTimestamp(),
        },
        updatedAt: fieldValue.serverTimestamp(),
      });
      syncClubProfile(transaction, db, uid, { ...account.data(), personLink: person });
      return person;
    });
    if (candidateId && root.ClubsStore) {
      await root.ClubsStore.syncResponsibleMemberships(db, uid, root.firebase.firestore, checkSession);
    }
    return result;
  }

  async function unlinkOwn(db, uid, fieldValue, checkSession = () => {}) {
    const ref = db.collection("users").doc(uid);
    return db.runTransaction(async (transaction) => {
      checkSession();
      const snapshot = await transaction.get(ref);
      checkSession();
      if (!snapshot.exists) fail("person-link/account-missing");
      const data = { ...snapshot.data() };
      const person = linkedPerson(data);
      if (!person) return data;
      const cleared = ["personLink", "linkedPersonId", "personId", "personLinked", "personLinkRequest", "personLinkIdentityHint", "personLinkIssue"];
      transaction.delete(db.collection("personAccountLinks").doc(person.id));
      transaction.update(ref, {
        ...Object.fromEntries(cleared.map((key) => [key, fieldValue.delete()])),
        personLinkStatus: "open", updatedAt: fieldValue.serverTimestamp(),
      });
      cleared.forEach((key) => { delete data[key]; });
      syncClubProfile(transaction, db, uid, data);
      return { ...data, personLinkStatus: "open" };
    });
  }

  // Account deletion releases the reservation atomically with the profile document.
  async function deleteAccount(db, uid, checkSession = () => {}) {
    const ref = db.collection("users").doc(uid);
    return db.runTransaction(async (transaction) => {
      const [snapshot, clubs] = await Promise.all([
        transaction.get(ref), transaction.get(db.collection("clubAccounts").doc(uid)),
      ]);
      checkSession();
      if (clubs.data()?.clubIds?.length) fail("clubs/last-manager");
      const person = linkedPerson(snapshot.data());
      if (person) transaction.delete(db.collection("personAccountLinks").doc(person.id));
      transaction.delete(ref);
      transaction.delete(db.collection("clubProfiles").doc(uid));
    });
  }

  const api = { linkedPerson, commit, unlinkOwn, deleteAccount, syncClubProfile };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LifesavingPersonLinks = api;
})(typeof window === "object" ? window : globalThis);
