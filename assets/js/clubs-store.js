(function (root) {
  "use strict";
  const core = typeof module === "object" && module.exports ? require("./clubs-core.js") : root.ClubsCore;
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  const stamp = (sdk) => sdk.FieldValue.serverTimestamp();
  const managerKey = (uid) => `account_${uid}`;

  function references(db, clubId) {
    const club = db.collection("clubs").doc(clubId);
    return { club, people: club.collection("people") };
  }

  function indexManager(transaction, db, uid, clubId, enabled, sdk) {
    transaction.set(db.collection("clubAccounts").doc(uid), {
      clubIds: enabled ? sdk.FieldValue.arrayUnion(clubId) : sdk.FieldValue.arrayRemove(clubId),
      changedClubId: clubId, updatedAt: stamp(sdk),
    }, { merge: true });
  }

  function personRecord(person, sdk, years = []) {
    return {
      personId: person.personId || "", accountUid: person.accountUid || "", name: person.name,
      birthYear: person.birthYear || null, organization: person.organization || "", activeYears: years,
      ...core.proofDates(person),
      createdAt: stamp(sdk), updatedAt: stamp(sdk),
    };
  }

  async function createClub(db, name, uid, sdk, checkSession = () => {}) {
    const id = core.clubId(name);
    const { club, people } = references(db, id);
    await db.runTransaction(async (transaction) => {
      const [existing, account] = await Promise.all([
        transaction.get(club), transaction.get(db.collection("users").doc(uid)),
      ]);
      checkSession();
      if (existing.exists) fail("clubs/duplicate", "Diese Gliederung besteht bereits.");
      if (!account.exists) fail("clubs/account-missing", "Das Konto besteht nicht mehr.");
      const manager = core.profile(account.data());
      if (!["trainer", "organizer"].includes(manager.role)) fail("clubs/role", "Bitte ein Trainer- oder Organisatorkonto wählen.");
      transaction.set(db.collection("clubProfiles").doc(uid), manager);
      transaction.set(club, {
        name: core.clubName(name), managerIds: [uid], changedManagerId: uid, status: "active",
        responsibilityVersion: 2, createdAt: stamp(sdk), updatedAt: stamp(sdk),
      });
      transaction.set(people.doc(managerKey(uid)), personRecord({ ...manager, accountUid: uid }, sdk));
      indexManager(transaction, db, uid, id, true, sdk);
    });
    return id;
  }

  async function importPerson(db, clubId, candidateId, sdk, checkSession = () => {}) {
    const { club, people } = references(db, clubId);
    return db.runTransaction(async (transaction) => {
      const [clubDoc, candidate, existing, link] = await Promise.all([
        transaction.get(club), transaction.get(db.collection("timerParticipantDirectory").doc(candidateId)),
        transaction.get(people.doc(candidateId)), transaction.get(db.collection("personAccountLinks").doc(candidateId)),
      ]);
      if (!clubDoc.exists || clubDoc.data().status !== "active") fail("clubs/closed", "Die Gliederung ist nicht verfügbar.");
      if (!candidate.exists) fail("clubs/person-missing", "Die Person ist nicht mehr vorhanden.");
      const uid = link.exists ? link.data().uid : "";
      const accountPerson = uid ? await transaction.get(people.doc(managerKey(uid))) : null;
      checkSession();
      if (accountPerson?.exists) return managerKey(uid);
      if (!existing.exists) {
        transaction.set(people.doc(candidateId), personRecord({ ...candidate.data(), personId: candidateId }, sdk));
      }
      return candidateId;
    });
  }

  // Only the admin can grant responsibility. Reconciliation of an already
  // assigned account changes its roster representation, never its permissions.
  async function assignResponsible(db, clubId, uid, sdk, checkSession = () => {}, reconcileOnly = false) {
    const { club, people } = references(db, clubId);
    await db.runTransaction(async (transaction) => {
      const [clubDoc, account, member] = await Promise.all([
        transaction.get(club), transaction.get(db.collection("users").doc(uid)), transaction.get(people.doc(managerKey(uid))),
      ]);
      if (!clubDoc.exists || clubDoc.data().status !== "active") fail("clubs/closed", "Die Gliederung ist nicht verfügbar.");
      const assigned = clubDoc.data().managerIds.includes(uid);
      if (reconcileOnly && !assigned) return;
      if (!account.exists) fail("clubs/account-missing", "Das Konto besteht nicht mehr.");
      const profile = core.profile(account.data());
      if (!["trainer", "organizer"].includes(profile.role)) fail("clubs/role", "Bitte ein Trainer- oder Organisatorkonto wählen.");
      const plain = profile.personId ? await transaction.get(people.doc(profile.personId)) : null;
      checkSession();
      transaction.set(db.collection("clubProfiles").doc(uid), profile);
      const years = [...new Set([...(member.data()?.activeYears || []), ...(plain?.data()?.activeYears || [])])].sort((a, b) => a - b);
      transaction.set(people.doc(managerKey(uid)), {
        ...personRecord({ ...profile, ...core.proofDates(member.data(), plain?.data()), accountUid: uid }, sdk, years),
        createdAt: member.exists ? member.data().createdAt : stamp(sdk),
      });
      if (plain?.exists) transaction.delete(people.doc(profile.personId));
      if (!assigned) {
        transaction.update(club, { managerIds: [...clubDoc.data().managerIds, uid], changedManagerId: uid, updatedAt: stamp(sdk) });
        indexManager(transaction, db, uid, clubId, true, sdk);
      }
    });
  }

  async function editMember(db, clubId, personId, changes, sdk, checkSession, expectedCreatedAt) {
    const ref = references(db, clubId).people.doc(personId);
    await db.runTransaction(async (transaction) => {
      const person = await transaction.get(ref);
      if (!person.exists) fail("clubs/person-missing", "Die Person wurde entfernt.");
      const data = person.data();
      if (expectedCreatedAt && data.createdAt.toMillis() !== expectedCreatedAt.toMillis()) {
        fail("clubs/stale-person", "Die Person wurde inzwischen neu hinzugefügt. Bitte öffne sie erneut.");
      }
      const source = await transaction.get(data.accountUid ? db.collection("clubProfiles").doc(data.accountUid)
        : db.collection("timerParticipantDirectory").doc(data.personId));
      checkSession();
      const identity = source.exists ? source.data() : data;
      transaction.update(ref, {
        name: identity.name, birthYear: identity.birthYear, organization: identity.organization,
        personId: data.accountUid ? identity.personId ?? data.personId : data.personId,
        ...changes(data), updatedAt: stamp(sdk),
      });
    });
  }

  async function setActive(db, clubId, personId, year, enabled, sdk, checkSession = () => {}, expectedCreatedAt) {
    return editMember(db, clubId, personId, (person) => ({ activeYears: core.activeYears(person.activeYears, year, enabled) }), sdk, checkSession, expectedCreatedAt);
  }

  async function removePerson(db, clubId, personId, sdk, checkSession = () => {}, keepPerson = false) {
    const { club, people } = references(db, clubId);
    await db.runTransaction(async (transaction) => {
      const [clubDoc, person] = await Promise.all([transaction.get(club), transaction.get(people.doc(personId))]);
      if (!clubDoc.exists || !person.exists) return;
      const data = clubDoc.data();
      const uid = person.data().accountUid;
      const manager = uid && data.managerIds.includes(uid);
      const profileDoc = uid ? await transaction.get(db.collection("clubProfiles").doc(uid)) : null;
      const linkedId = profileDoc?.data()?.personId || person.data().personId;
      const source = keepPerson && linkedId ? await transaction.get(db.collection("timerParticipantDirectory").doc(linkedId)) : null;
      const plainPerson = keepPerson && linkedId ? await transaction.get(people.doc(linkedId)) : null;
      checkSession();
      if (manager) {
        if (data.status === "active" && data.managerIds.length <= 1) fail("clubs/last-manager", "Zuerst durch einen Admin einen weiteren Verantwortlichen zuordnen lassen.");
        transaction.update(club, { managerIds: data.managerIds.filter((value) => value !== uid), changedManagerId: uid, updatedAt: stamp(sdk) });
        indexManager(transaction, db, uid, clubId, false, sdk);
      }
      if (!keepPerson) {
        transaction.delete(people.doc(personId));
      } else if (source?.exists) {
        const years = [...new Set([...(person.data().activeYears || []), ...(plainPerson.data()?.activeYears || [])])].sort((a, b) => a - b);
        transaction.set(people.doc(linkedId), {
          ...personRecord({ ...source.data(), ...core.proofDates(person.data(), plainPerson.data()), personId: linkedId }, sdk, years),
          createdAt: plainPerson.exists ? plainPerson.data().createdAt : stamp(sdk),
        });
        transaction.delete(people.doc(personId));
      }
    });
  }

  async function deleteClub(db, clubId, sdk, checkSession = () => {}) {
    const { club, people } = references(db, clubId);
    await club.update({ status: "deleting", updatedAt: stamp(sdk) });
    const roster = await people.get({ source: "server" });
    for (const person of roster.docs) {
      checkSession();
      await removePerson(db, clubId, person.id, sdk, checkSession);
    }
    checkSession();
    await club.delete();
  }

  async function prepareAccountChange(db, uid, sdk, checkSession = () => {}) {
    const index = await db.collection("clubAccounts").doc(uid).get({ source: "server" });
    const ids = index.data()?.clubIds || [];
    const clubs = await Promise.all(ids.map((id) => db.collection("clubs").doc(id).get({ source: "server" })));
    checkSession();
    if (clubs.some((club) => club.exists && club.data().status === "active" && club.data().managerIds.length <= 1)) {
      fail("clubs/last-manager", "Das Konto ist letzter Verantwortlicher einer Gliederung. Zuerst Ersatz zuordnen oder die Gliederung löschen.");
    }
    for (const club of clubs) {
      if (club.exists) await removePerson(db, club.id, managerKey(uid), sdk, checkSession, true);
    }
  }

  async function saveDates(db, clubId, subjectId, changes, sdk, checkSession = () => {}, expectedCreatedAt) {
    return editMember(db, clubId, subjectId, () => changes, sdk, checkSession, expectedCreatedAt);
  }

  async function syncResponsibleMemberships(db, uid, sdk, checkSession = () => {}) {
    const index = await db.collection("clubAccounts").doc(uid).get({ source: "server" });
    checkSession();
    for (const id of index.data()?.clubIds || []) {
      await assignResponsible(db, id, uid, sdk, checkSession, true);
    }
  }

  async function migrateResponsibilities(db, clubId, sdk, checkSession = () => {}, confirmedUid = "") {
    const { club, people } = references(db, clubId);
    const current = await club.get({ source: "server" });
    if (!current.exists || current.data().responsibilityVersion === 2 || current.data().status !== "active") return;
    const members = await people.get({ source: "server" });
    checkSession();
    // The initial account was written in the club creation transaction. Later
    // imports used to auto-grant access; retain only the original assignment.
    const initial = members.docs.find((member) => current.data().managerIds.includes(member.data().accountUid)
      && (confirmedUid ? member.data().accountUid === confirmedUid : member.data().createdAt.isEqual(current.data().createdAt)));
    if (!initial) return false;
    const account = await db.collection("users").doc(initial.data().accountUid).get({ source: "server" });
    if (!account.exists || !["trainer", "organizer"].includes(core.profile(account.data()).role)) return false;
    for (const uid of current.data().managerIds) {
      if (uid !== initial.data().accountUid) await removePerson(db, clubId, managerKey(uid), sdk, checkSession, true);
    }
    checkSession();
    await club.update({ responsibilityVersion: 2, updatedAt: stamp(sdk) });
    return true;
  }

  const api = Object.freeze({ createClub, importPerson, assignResponsible, setActive, removePerson, deleteClub, prepareAccountChange, saveDates, syncResponsibleMemberships, migrateResponsibilities, managerKey });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubsStore = api;
})(typeof window === "object" ? window : globalThis);
