(function () {
  "use strict";
  const core = window.TrainingCore;
  let db;
  let auth;
  let context = null;
  let authListener = null;
  let stopProfile = null;
  let generation = 0;

  function translated(error) {
    const code = String(error?.code || "").replace(/^firestore\//, "");
    const messages = {
      "permission-denied": "Der Zugriff wurde abgelehnt. Dein Konto braucht Kader-Rechte und die aktuellen Datenbankregeln müssen veröffentlicht sein.",
      "unavailable": "Die Verbindung zur Datenbank ist unterbrochen. Bitte versuche es erneut.",
      "unauthenticated": "Bitte melde dich erneut an.",
      "failed-precondition": "Die Datenbank benötigt noch die Indizes für das Trainingstagebuch.",
      "not-found": "Dieser Trainingseintrag wurde bereits gelöscht."
    };
    return new Error(messages[code] || error?.message || "Die Daten konnten nicht geladen werden.");
  }

  function requireAccess() {
    if (!context?.allowed || !auth.currentUser) throw new Error("Diese App ist für Kader-Sportler, Organisatoren und Admins verfügbar.");
    return context;
  }

  async function start(listener) {
    authListener = listener;
    if (!window.isFirebaseConfigured || !window.firebase?.firestore) {
      listener({ error: "Die Anmeldung konnte nicht geladen werden. Bitte prüfe deine Internetverbindung und lade die Seite erneut." });
      return;
    }
    if (!window.firebase.apps.length) window.firebase.initializeApp(window.firebaseConfig);
    db = window.firebase.firestore();
    auth = window.firebase.auth();
    try { await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL); }
    catch (error) { console.warn("Dauerhafte Anmeldung nicht verfügbar.", error); }
    auth.onIdTokenChanged(async (user) => {
      const currentGeneration = ++generation;
      stopProfile?.();
      stopProfile = null;
      context = null;
      listener({ loading: true });
      if (!user) { listener({ signedIn: false }); return; }
      try {
        const token = await user.getIdTokenResult();
        // Server profile data is required before granting access; cached roles never grant access.
        const ref = db.collection("users").doc(user.uid);
        const snapshot = await ref.get({ source: "server" });
        if (currentGeneration !== generation) return;
        const apply = (doc) => {
          if (currentGeneration !== generation) return;
          const profile = doc.data() || {};
          const role = core.roleFor(profile, token.claims);
          const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ")
            || profile.displayName || user.displayName || "Sportler";
          context = { signedIn: true, uid: user.uid, name: String(name).slice(0, 120), ...role,
            verified: token.claims.email_verified === true,
            allowed: token.claims.email_verified === true && role.hasAccess };
          listener(context);
        };
        apply(snapshot);
        stopProfile = ref.onSnapshot((doc) => {
          if (!doc.metadata.fromCache) apply(doc);
        }, (error) => {
          if (currentGeneration !== generation) return;
          context = null;
          listener({ error: translated(error).message });
        });
      } catch (error) {
        if (currentGeneration === generation) listener({ error: translated(error).message });
      }
    });
  }

  function yearQuery(collection, year, own = false) {
    const identity = requireAccess();
    const stamp = window.firebase.firestore.Timestamp;
    let query = db.collection(collection);
    if (own) query = query.where("uid", "==", identity.uid);
    return query.where("date", ">=", stamp.fromDate(new Date(`${year}-01-01T00:00:00.000Z`)))
      .where("date", "<", stamp.fromDate(new Date(`${Number(year) + 1}-01-01T00:00:00.000Z`)));
  }

  function watchYear(year, onData, onError) {
    const identity = requireAccess();
    const data = { entries: null, metrics: null, notes: null };
    const stops = [];
    let active = true;
    function fail(error) {
      if (!active) return;
      active = false;
      stops.forEach((stop) => stop());
      onError(translated(error));
    }
    [
      ["entries", "trainingEntries", false],
      ["metrics", "trainingMetrics", !identity.isOrganizer],
      ["notes", "trainingNotes", true]
    ].forEach(([key, collection, own]) => {
      stops.push(yearQuery(collection, year, own).onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
        if (!active || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        data[key] = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data(), date: core.dateKey(doc.data().date) }));
        if (Object.values(data).every(Array.isArray)) {
          // Collections arrive independently; publish only a consistent, committed join.
          const metrics = new Map(data.metrics.map((entry) => [entry.id, entry]));
          const notes = new Map(data.notes.map((entry) => [entry.id, entry]));
          const sameVersion = (a, b) => a?.updatedAt?.isEqual(b?.updatedAt);
          const complete = data.entries.every((entry) => {
            if (identity.isOrganizer && !sameVersion(entry, metrics.get(entry.id))) return false;
            return entry.uid !== identity.uid || (sameVersion(entry, metrics.get(entry.id)) && sameVersion(entry, notes.get(entry.id)));
          });
          if (complete) onData(data.entries.map((entry) => ({ ...entry,
            motivation: metrics.get(entry.id)?.motivation,
            text: notes.get(entry.id)?.text || "" })));
        }
      }, fail));
    });
    return () => { active = false; stops.forEach((stop) => stop()); };
  }

  async function saveEntry(input, existing = null) {
    const identity = requireAccess();
    const fields = core.validateEntry(input);
    if (existing && existing.uid !== identity.uid) throw new Error("Du kannst nur deine eigenen Trainings bearbeiten.");
    const ref = existing ? db.collection("trainingEntries").doc(existing.id) : db.collection("trainingEntries").doc();
    const timestamp = window.firebase.firestore.FieldValue.serverTimestamp();
    const common = { uid: identity.uid,
      date: window.firebase.firestore.Timestamp.fromDate(new Date(`${fields.date}T00:00:00.000Z`)),
      createdAt: existing ? existing.createdAt : timestamp, updatedAt: timestamp };
    const batch = db.batch();
    const method = existing ? "update" : "set";
    batch[method](ref, { ...common, athleteName: identity.name, meters: fields.meters });
    batch[method](db.collection("trainingMetrics").doc(ref.id), { ...common, motivation: fields.motivation });
    batch[method](db.collection("trainingNotes").doc(ref.id), { ...common, text: fields.text });
    try { await batch.commit(); return ref.id; }
    catch (error) { throw translated(error); }
  }

  async function deleteEntry(entry) {
    const identity = requireAccess();
    if (entry.uid !== identity.uid) throw new Error("Du kannst nur deine eigenen Trainings löschen.");
    const batch = db.batch();
    ["trainingEntries", "trainingMetrics", "trainingNotes"].forEach((name) => batch.delete(db.collection(name).doc(entry.id)));
    try { await batch.commit(); }
    catch (error) { throw translated(error); }
  }

  window.TrainingStore = Object.freeze({ start, watchYear, saveEntry, deleteEntry });
})();
