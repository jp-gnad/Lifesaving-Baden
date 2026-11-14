(function () {
  "use strict";

  const DISCIPLINES = window.TimerCore.disciplines;

  const DEFAULT_DISCIPLINES = Object.keys(DISCIPLINES);
  const PAGE_SIZE = 50;
  const ACCESS_LEVELS = new Set(["everyone", "authenticated", "athlete", "trainer", "organizer", "locked"]);
  const DEFAULT_ACCESS = Object.freeze({
    timerAccess: "locked",
    resultsAccess: "everyone",
    participantViewAccess: "everyone",
    participantEditAccess: "locked",
    resultEditAccess: "locked",
  });

  function appError(message, status = 400, cause = null) {
    const error = new Error(message);
    error.status = status;
    if (cause) error.cause = cause;
    return error;
  }

  function translateFirebaseError(error) {
    const code = String(error?.code || "").replace(/^firestore\//, "");
    const messages = {
      "permission-denied": authContext.isAdmin
        ? "Firebase erkennt dein Admin-Konto, aber die veröffentlichten Firestore-Regeln lehnen die Aktion ab. Bitte veröffentliche die aktuellen Regeln erneut."
        : "Dafür fehlen dir die erforderlichen Rechte.",
      "unauthenticated": "Bitte melde dich zuerst bei Lifesaving Baden an.",
      "unavailable": "Firebase ist gerade nicht erreichbar.",
      "failed-precondition": "Die Datenbank ist für diese Abfrage noch nicht vollständig eingerichtet.",
      "not-found": "Der Eintrag wurde nicht gefunden.",
    };
    const status = code === "permission-denied" || code === "unauthenticated"
      ? 403
      : (code === "unavailable" ? 503 : 400);
    return appError(messages[code] || error?.message || "Die Anfrage ist fehlgeschlagen.", status, error);
  }

  function cleanText(value, field, max = 120, required = true) {
    const text = typeof value === "string" ? value.trim() : "";
    if (required && !text) throw appError(`${field} fehlt.`);
    if (text.length > max) throw appError(`${field} ist zu lang.`);
    return text;
  }

  function normalizedPersonName(value = "") {
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]/g, "");
  }

  function eventYearOf(eventDate) {
    const match = String(eventDate || "").match(/^(\d{4})-/);
    return match ? Number(match[1]) : null;
  }

  function ageGroupFor(birthYear, eventYear) {
    const age = eventYear - birthYear;
    if (age < 0) throw appError("Der Jahrgang liegt nach dem Eventjahr.");
    if (age <= 10) return "10";
    if (age <= 12) return "11/12";
    if (age <= 14) return "13/14";
    if (age <= 16) return "15/16";
    if (age <= 18) return "17/18";
    return "Offen";
  }

  function timestampText(value) {
    if (!value) return "";
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  function accessLevel(value, fallback) {
    if (value === "kader") value = "athlete";
    return ACCESS_LEVELS.has(value) ? value : fallback;
  }

  function validatedEventUrl(value) {
    const text = cleanText(value, "Ergebnis-URL", 500, false);
    if (!text) return "";
    let url;
    try {
      url = new URL(text);
    } catch {
      throw appError("Die Ergebnis-URL ist ungültig.");
    }
    if (!new Set(["http:", "https:"]).has(url.protocol)) {
      throw appError("Die Ergebnis-URL muss mit http:// oder https:// beginnen.");
    }
    return text;
  }

  function validatedEnabledDisciplines(value, fallback = DEFAULT_DISCIPLINES) {
    if (value === undefined) return fallback;
    if (!Array.isArray(value)) throw appError("Ungültige Disziplinenauswahl.");
    const selected = [...new Set(value)];
    if (!selected.length) throw appError("Mindestens eine Disziplin muss aktiviert sein.");
    if (selected.some((discipline) => typeof discipline !== "string" || !(discipline in DISCIPLINES))) {
      throw appError("Ungültige Disziplinenauswahl.");
    }
    return selected;
  }

  function validatedResultTiming(body, discipline) {
    if (!Array.isArray(body.segments) || !body.segments.length) throw appError("Keine Zeiten vorhanden.");
    const segments = body.segments.map((value) => value === null ? null : Number(value));
    if (segments.some((value) => value !== null && (!Number.isInteger(value) || value <= 0))) {
      throw appError("Ungültige Abschnittszeit.");
    }
    if (!segments.some((value) => Number.isInteger(value) && value > 0)) throw appError("Keine Zeiten vorhanden.");
    if (segments.length > discipline.laps) {
      throw appError(`Für diese Disziplin sind höchstens ${discipline.laps} Abschnitte erlaubt.`);
    }
    const lapGroups = body.lapGroups === undefined
      ? segments.map((_, index) => [index + 1])
      : body.lapGroups;
    if (!Array.isArray(lapGroups) || lapGroups.length !== segments.length) throw appError("Ungültige Lap-Bereiche.");
    const coveredLaps = [];
    lapGroups.forEach((group) => {
      if (!Array.isArray(group) || !group.length || group.some((lap) => !Number.isInteger(lap) || lap < 1 || lap > discipline.laps)) {
        throw appError("Ungültige Lap-Bereiche.");
      }
      if (group.some((lap, index) => index > 0 && lap !== group[index - 1] + 1)) {
        throw appError("Es dürfen nur benachbarte Laps verbunden werden.");
      }
      coveredLaps.push(...group);
    });
    if ((!discipline.flexible && coveredLaps.length !== discipline.laps)
      || coveredLaps.some((lap, index) => lap !== index + 1)
      || coveredLaps.length > discipline.laps) {
      throw appError(`Für diese Disziplin müssen die Lap-Bereiche 1 bis ${discipline.laps} lückenlos abdecken.`);
    }
    const frequencies = body.frequencies === undefined ? segments.map(() => null) : body.frequencies;
    if (!Array.isArray(frequencies) || frequencies.length !== segments.length) throw appError("Ungültige Frequenzwerte.");
    if (frequencies.some((value) => value !== null && (!Number.isInteger(value) || value < 1 || value > 999))) {
      throw appError("Frequenzen müssen ganze Zahlen von 1 bis 999 sein.");
    }
    const totalCentiseconds = segments.reduce((sum, value) => sum + (value || 0), 0);
    const officialCentiseconds = body.officialTime == null ? null : Number(body.officialTime);
    if (officialCentiseconds !== null && (!Number.isInteger(officialCentiseconds) || officialCentiseconds <= 0)) {
      throw appError("Ungültige offizielle Zeit.");
    }
    // Firestore accepts arrays inside map values, but not arrays directly inside
    // another array. Keep the UI format (number[][]) at the boundary and store
    // every lap group as a map so offline retries are valid as well.
    const storedLapGroups = lapGroups.map((laps) => ({ laps: [...laps] }));
    return { segments, lapGroups: storedLapGroups, frequencies, totalCentiseconds, officialCentiseconds };
  }

  if (!window.LifesavingAuth || !window.firebase || !window.firebase.auth || !window.firebase.firestore || !window.isFirebaseConfigured) {
    window.timerFirestoreApi = {
      request: async () => { throw appError("Firebase ist für den Lifesaving Timer noch nicht verfügbar.", 503); },
      getAuthContext: async () => ({ authenticated: false, isOrganizer: false, isAdmin: false, isAthlete: false, isTrainer: false }),
      signOut: async () => { throw appError("Firebase ist für den Lifesaving Timer noch nicht verfügbar.", 503); },
      watchResults: () => ({ stop() {}, next: () => false, previous: () => false, refresh() {} }),
    };
    return;
  }

  const { initFirebase, ensureLocalAuthPersistence, loadUserContext, getAccountRole, hasVerifiedAccess, getNameDetailsFromData } = window.LifesavingAuth;
  const auth = initFirebase();
  const db = window.firebase.firestore();
  const authPersistenceReady = ensureLocalAuthPersistence(auth);
  const persistenceReady = db.enablePersistence({ synchronizeTabs: true }).catch((error) => {
    if (!["failed-precondition", "unimplemented"].includes(String(error?.code || "").replace(/^firestore\//, ""))) {
      console.warn("Firestore-Offlinespeicher konnte nicht aktiviert werden.", error);
    }
  });
  const fieldValue = window.firebase.firestore.FieldValue;
  const eventsCollection = db.collection("timerEvents");
  const directoryCollection = db.collection("timerParticipantDirectory");
  const participantStore = window.TimerParticipantStore;
  const participantCache = new Map();
  const searchCache = new Map();
  let participantSession = 0;
  let accountSession = 0;
  let directoryReadyPromise = null;

  function clearParticipantCache() {
    participantSession += 1;
    participantCache.clear();
    searchCache.clear();
    directoryReadyPromise = null;
  }

  function participantSessionCheck(background = false) {
    const session = background ? accountSession : participantSession;
    const uid = auth.currentUser?.uid;
    const check = () => {
      if (session !== (background ? accountSession : participantSession) || auth.currentUser?.uid !== uid) {
        throw appError("Die Ansicht oder Anmeldung hat sich geändert. Bitte erneut öffnen.", 409);
      }
    };
    check.background = background;
    return check;
  }

  let authContext = {
    user: null,
    authenticated: false,
    isOrganizer: false,
    isAdmin: false,
    isAthlete: false, isTrainer: false,
    role: "guest",
    roleLabel: "Nicht angemeldet",
    accountName: "",
    accountNeedsAttention: false,
  };
  let resolveInitialAuth;
  const initialAuth = new Promise((resolve) => { resolveInitialAuth = resolve; });
  let initialAuthResolved = false;
  let authRefreshVersion = 0;
  async function refreshTimerAuthContext(user) {
    const userChanged = authContext.user?.uid !== user?.uid;
    if (userChanged) { accountSession += 1; clearParticipantCache(); }
    const refreshVersion = ++authRefreshVersion;
    await Promise.all([authPersistenceReady, persistenceReady]);
    let userData = {};
    let userDataLoaded = false;
    let claims = {};
    let authError = "";
    if (user) {
      try {
        ({ userData, claims } = await loadUserContext(user));
        userDataLoaded = true;
      } catch (error) {
        console.warn("Timer-Rolle konnte nicht geladen werden.", error);
        authError = `${translateFirebaseError(error).message} Bitte lade die Seite erneut.`;
      }
    }

    const authenticated = await hasVerifiedAccess(user);
    if (refreshVersion !== authRefreshVersion) {
      return;
    }

    const { value, isAdmin, isOrganizer, isTrainer, isAthlete, label } = getAccountRole(userData, claims);
    const accountName = userDataLoaded ? getNameDetailsFromData(userData, user).displayName : "";
    const isLinked = Boolean(window.LifesavingPersonLinks.linkedPerson(userData));
    const linkRequested = isLinked
      || userData.personLinkStatus === "requested"
      || userData.personLinkRequest?.status === "requested";
    const accountChecklistComplete = linkRequested
      && isLinked
      && Boolean(String(userData.dlrgBranch || "").trim())
      && Boolean(String(userData.birthDate || "").trim())
      && Boolean(String(userData.gender || "").trim());
    const permissionsChanged = authContext.authenticated !== authenticated
      || authContext.isOrganizer !== isOrganizer || authContext.isAdmin !== isAdmin
      || authContext.isAthlete !== isAthlete || authContext.isTrainer !== isTrainer;
    if (permissionsChanged && !userChanged) { accountSession += 1; clearParticipantCache(); }
    authContext = {
      user,
      authenticated,
      isOrganizer,
      isAdmin,
      isAthlete,
      isTrainer,
      role: user ? value : "guest",
      roleLabel: user ? label : "Nicht angemeldet",
      authError,
      accountName,
      accountNeedsAttention: Boolean(user && userDataLoaded && !isAdmin && !accountChecklistComplete),
    };
    if (!initialAuthResolved) {
      initialAuthResolved = true;
      resolveInitialAuth(authContext);
    }
    window.dispatchEvent(new CustomEvent("timer-auth-change", {
      detail: { ...authContext, user: undefined, participantsInvalidated: userChanged || permissionsChanged },
    }));

  }

  auth.onAuthStateChanged((user) => {
    refreshTimerAuthContext(user).catch((error) => {
      console.warn("Timer-Anmeldung konnte nicht initialisiert werden.", error);
      if (!initialAuthResolved) {
        initialAuthResolved = true;
        resolveInitialAuth(authContext);
      }
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && auth.currentUser) {
      refreshTimerAuthContext(auth.currentUser).catch(() => {});
    }
  });

  async function getAuthContext() {
    await initialAuth;
    return authContext;
  }

  async function signOut() {
    await auth.signOut();
  }

  function canUseAccess(level) {
    if (authContext.isAdmin) return true;
    if (level === "everyone") return true;
    if (level === "authenticated") return authContext.authenticated;
    if (level === "athlete") return authContext.isAthlete;
    if (level === "trainer") return authContext.isTrainer;
    return level === "organizer" && authContext.isOrganizer;
  }

  function permissionSet(data) {
    const timerAccess = accessLevel(data.timerAccess, DEFAULT_ACCESS.timerAccess);
    const resultsAccess = accessLevel(data.resultsAccess, DEFAULT_ACCESS.resultsAccess);
    const participantViewAccess = accessLevel(data.participantViewAccess, DEFAULT_ACCESS.participantViewAccess);
    const participantEditAccess = accessLevel(data.participantEditAccess, DEFAULT_ACCESS.participantEditAccess);
    const resultEditAccess = accessLevel(data.resultEditAccess, DEFAULT_ACCESS.resultEditAccess);
    return {
      timerAccess,
      resultsAccess,
      participantViewAccess,
      participantEditAccess,
      resultEditAccess,
      canManageEvent: authContext.isOrganizer,
      canUseTimer: canUseAccess(timerAccess),
      canViewResults: canUseAccess(resultsAccess),
      canViewParticipants: (
        canUseAccess(participantViewAccess)
        || canUseAccess(participantEditAccess)
        || canUseAccess(timerAccess)
      ),
      canEditParticipants: canUseAccess(participantEditAccess),
      canImportParticipants: authContext.isOrganizer && canUseAccess(participantEditAccess),
      canEditResults: canUseAccess(resultsAccess) && canUseAccess(resultEditAccess),
    };
  }

  function mapEvent(snapshot) {
    const data = snapshot.data() || {};
    const permissions = permissionSet(data);
    const enabledDisciplines = validatedEnabledDisciplines(data.enabledDisciplines, DEFAULT_DISCIPLINES);
    return {
      id: snapshot.id,
      name: data.name || "Unbenanntes Event",
      event_date: data.eventDate || null,
      location: data.location || "",
      created_at: timestampText(data.createdAt),
      pool_length: ["25", "50", "custom"].includes(data.poolLength) ? data.poolLength : "25",
      custom_pool_length: data.customPoolLength ?? null,
      enabled_disciplines_json: JSON.stringify(enabledDisciplines),
      result_url: data.resultUrl || "",
      timer_access: permissions.timerAccess,
      results_access: permissions.resultsAccess,
      participant_view_access: permissions.participantViewAccess,
      participant_edit_access: permissions.participantEditAccess,
      result_edit_access: permissions.resultEditAccess,
      can_manage_event: permissions.canManageEvent,
      can_use_timer: permissions.canUseTimer,
      can_view_results: permissions.canViewResults,
      can_view_participants: permissions.canViewParticipants,
      can_edit_participants: permissions.canEditParticipants,
      can_import_participants: permissions.canImportParticipants,
      can_edit_results: permissions.canEditResults,
    };
  }

  function mapParticipant(snapshot) {
    const data = snapshot.data() || {};
    return {
      id: snapshot.id,
      name: data.name || "",
      birth_year: Number(data.birthYear),
      age_group: data.ageGroup || "",
      gender: data.gender || "",
      organization: data.organization || "",
      created_at: timestampText(data.createdAt),
      result_count: Number(data.resultCount) || 0,
    };
  }

  function participantSnapshot(participant) {
    return {
      id: participant.id,
      name: participant.name,
      birthYear: participant.birth_year,
      ageGroup: participant.age_group,
      gender: participant.gender,
      organization: participant.organization,
    };
  }

  function mapResult(snapshot) {
    const data = snapshot.data() || {};
    const person = data.participant || {};
    return {
      id: snapshot.id,
      discipline: data.discipline,
      participant_id: data.participantId || person.id || "",
      participant_name: person.name || "",
      birth_year: Number(person.birthYear),
      age_group: person.ageGroup || "",
      gender: person.gender || "",
      organization: person.organization || "",
      total_centiseconds: Number(data.totalCentiseconds) || 0,
      official_centiseconds: data.officialCentiseconds == null ? null : Number(data.officialCentiseconds),
      segments: Array.isArray(data.segments) ? data.segments : [],
      frequencies: Array.isArray(data.frequencies) ? data.frequencies : [],
      lap_groups: Array.isArray(data.lapGroups) ? data.lapGroups.map((group) => {
        if (Array.isArray(group)) return group;
        return Array.isArray(group?.laps) ? group.laps : [];
      }) : [],
      team_members: Array.isArray(data.teamMembers) ? data.teamMembers.map((member, index) => ({
        id: member.id,
        name: member.name,
        birth_year: Number(member.birthYear),
        age_group: member.ageGroup || "",
        gender: member.gender || "",
        organization: member.organization || "",
        position: index + 1,
      })) : [],
      note: data.note || "",
      created_at: timestampText(data.createdAt),
    };
  }

  function visibleResults(snapshot) {
    return snapshot.docs.map(mapResult).sort((left, right) => {
      const leftTime = left.official_centiseconds ?? left.total_centiseconds;
      const rightTime = right.official_centiseconds ?? right.total_centiseconds;
      return leftTime - rightTime || left.created_at.localeCompare(right.created_at);
    });
  }

  function pageQuery(collection, cursor = null) {
    // Document IDs include legacy records without dates and remain stable on edits.
    let query = collection.orderBy(window.firebase.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) {
      if (typeof cursor !== "string" || /[\/\\\u0000-\u001f]/.test(cursor)) throw appError("Ungültige Seitennavigation.");
      query = query.startAfter(cursor);
    }
    return query;
  }

  function pageInfo(snapshot) {
    return {
      hasMore: snapshot.docs.length === PAGE_SIZE,
      nextCursor: snapshot.docs.at(-1)?.id || null,
    };
  }

  function watchResults(eventId, onValue, onError = () => {}) {
    const eventRef = eventsCollection.doc(decodeURIComponent(eventId));
    const checkSession = participantSessionCheck();
    const reportError = (error) => onError(error?.status ? error : translateFirebaseError(error));
    return window.TimerResultFeed.create({
      visibility: document,
      canView: (event) => Boolean(event?.can_view_results),
      onValue,
      onError: reportError,
      listenEvent: (receive, fail) => eventRef.onSnapshot((snapshot) => {
        try {
          checkSession();
          if (!snapshot.exists) throw appError("Event nicht gefunden.", 404);
          receive(mapEvent(snapshot));
        } catch (error) { fail(error); }
      }, fail),
      listenPage: (cursor, receive, fail) => pageQuery(eventRef.collection("results"), cursor).onSnapshot((snapshot) => {
        try {
          checkSession();
          receive({ results: visibleResults(snapshot), ...pageInfo(snapshot) });
        } catch (error) { fail(error); }
      }, fail),
    });
  }

  async function allResultDocuments(eventRef) {
    const documents = [];
    let cursor = null;
    do {
      const snapshot = await pageQuery(eventRef.collection("results"), cursor).get();
      documents.push(...snapshot.docs);
      if (snapshot.docs.length < PAGE_SIZE) return documents;
      cursor = snapshot.docs.at(-1).id;
    } while (true);
  }

  function directoryIsReady() {
    if (!directoryReadyPromise) {
      directoryReadyPromise = directoryCollection.limit(1).get()
        .then((snapshot) => !snapshot.empty)
        .catch((error) => {
          directoryReadyPromise = null;
          throw error;
        });
    }
    return directoryReadyPromise;
  }

  async function eventSnapshot(eventId) {
    const snapshot = await eventsCollection.doc(eventId).get();
    if (!snapshot.exists) throw appError("Event nicht gefunden.", 404);
    return snapshot;
  }

  function requireOrganizer() {
    if (!authContext.isOrganizer) throw appError("Diese Aktion ist nur für Organisatoren möglich.", 403);
  }

  function requirePermission(event, field, message) {
    if (!event[field]) throw appError(message || "Dafür fehlen dir die erforderlichen Rechte.", 403);
  }

  function parseBody(options) {
    if (!options?.body) return {};
    if (typeof options.body === "string") {
      try {
        return JSON.parse(options.body);
      } catch {
        throw appError("Ungültige Daten.");
      }
    }
    return options.body;
  }

  async function listParticipants(eventId) {
    if (!participantCache.has(eventId)) {
      const check = participantSessionCheck();
      const entry = {};
      entry.promise = eventsCollection.doc(eventId).collection("participants").get()
        .then((snapshot) => {
          check();
          entry.snapshot = snapshot;
          entry.rows = snapshot.docs.map(mapParticipant);
          return entry;
        }).catch((error) => {
          if (participantCache.get(eventId) === entry) participantCache.delete(eventId);
          throw error;
        });
      participantCache.set(eventId, entry);
    }
    const entry = await participantCache.get(eventId).promise;
    return [...entry.rows].sort((left, right) => left.name.localeCompare(right.name, "de"));
  }

  function updateParticipantCache(eventId, id, participant) {
    const entry = participantCache.get(eventId);
    if (!entry?.rows) return;
    entry.rows = entry.rows.filter((person) => person.id !== id);
    if (participant) entry.rows.push(participant);
  }

  async function prepareParticipantIndex(snapshot, event, check = participantSessionCheck()) {
    check();
    if (snapshot.data().participantIndexVersion === 1) return;
    if (!event.can_import_participants) {
      throw appError("Ein Organisator muss die Personenansicht dieses Events einmal öffnen, bevor Personen geändert werden können.", 409);
    }
    if (check.background) {
      // A legacy-index migration belongs to the queued write, not the view
      // whose participant cache may be released during navigation.
      const roster = await snapshot.ref.collection("participants").get();
      check();
      await participantStore.migrate(db, snapshot.ref, roster, fieldValue, check);
    } else {
      await listParticipants(snapshot.id);
      check();
      await participantStore.migrate(db, snapshot.ref, participantCache.get(snapshot.id).snapshot, fieldValue, check);
    }
  }

  async function searchDirectory(prefix) {
    const cached = searchCache.get(prefix);
    if (cached && Date.now() - cached.createdAt < 30_000) return cached.promise;
    const check = participantSessionCheck();
    const entry = { createdAt: Date.now() };
    entry.promise = directoryCollection.orderBy("searchName").startAt(prefix).endAt(`${prefix}\uf8ff`).limit(10).get()
      .then((snapshot) => { check(); return snapshot; })
      .catch((error) => { if (searchCache.get(prefix) === entry) searchCache.delete(prefix); throw error; });
    searchCache.delete(prefix);
    searchCache.set(prefix, entry);
    if (searchCache.size > 40) searchCache.delete(searchCache.keys().next().value);
    return entry.promise;
  }

  async function getParticipant(eventId, participantId) {
    const snapshot = await eventsCollection.doc(eventId).collection("participants").doc(participantId).get();
    if (!snapshot.exists) throw appError("Person wurde nicht gefunden.", 404);
    return mapParticipant(snapshot);
  }

  function participantPayload(body) {
    const enteredBirthYear = Number(body.birthYear);
    if (!Number.isInteger(enteredBirthYear) || enteredBirthYear < 0 || enteredBirthYear > 99) {
      throw appError("Bitte den Jahrgang zweistellig eingeben, zum Beispiel 08.");
    }
    if (!new Set(["male", "female"]).has(body.gender)) throw appError("Ungültiges Geschlecht.");
    return {
      name: cleanText(body.name, "Name"),
      birthYear: enteredBirthYear,
      ageGroup: cleanText(body.ageGroup, "Altersklasse", 40),
      gender: body.gender,
      organization: cleanText(body.organization, "Gliederung"),
    };
  }

  async function deleteDocuments(documents, check = () => {}) {
    for (let offset = 0; offset < documents.length; offset += 400) {
      const batch = db.batch();
      documents.slice(offset, offset + 400).forEach((document) => batch.delete(document.ref));
      check();
      await batch.commit();
    }
  }

  async function deleteEvent(eventId, check = participantSessionCheck()) {
    const eventRef = eventsCollection.doc(eventId);
    const [participants, results] = await Promise.all([
      eventRef.collection("participants").get(),
      allResultDocuments(eventRef),
    ]);
    const event = await eventSnapshot(eventId);
    check();
    await prepareParticipantIndex(event, mapEvent(event), check);
    for (const person of participants.docs) {
      await participantStore.commit(db, eventRef, person.id, null, fieldValue, check);
    }
    const identities = await eventRef.collection("participantIdentities").get();
    await deleteDocuments([...identities.docs, ...results], check);
    check();
    await eventRef.delete();
    participantCache.delete(eventId);
  }

  function mutationId(body) {
    if (!body.clientMutationId) return crypto.randomUUID();
    if (typeof body.clientMutationId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(body.clientMutationId)) throw appError("Ungültige Speicher-ID.");
    return body.clientMutationId;
  }

  function eventCreationData(body) {
    const eventDate = body.eventDate ? cleanText(body.eventDate, "Datum", 10) : null;
    if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw appError("Ungültiges Datum.");
    return {
      name: cleanText(body.name, "Eventname"),
      eventDate,
      location: cleanText(body.location, "Ort", 120, false),
      poolLength: "25",
      customPoolLength: null,
      enabledDisciplines: DEFAULT_DISCIPLINES,
      resultUrl: "",
      ...DEFAULT_ACCESS,
      participantIndexVersion: 1,
      createdAt: fieldValue.serverTimestamp(),
      updatedAt: fieldValue.serverTimestamp(),
    };
  }

  function previewEvent(id, body) {
    return mapEvent({ id, data: () => eventCreationData(body) });
  }

  function eventUpdateData(current, body) {
    const eventDateValue = body.eventDate === undefined ? current.eventDate : body.eventDate;
    const eventDate = eventDateValue ? cleanText(eventDateValue, "Datum", 10) : null;
    if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw appError("Ungültiges Datum.");
    const poolLength = body.poolLength === undefined ? current.poolLength || "25" : String(body.poolLength);
    if (!["25", "50", "custom"].includes(poolLength)) throw appError("Ungültige Bahnlänge.");
    const customPoolLength = poolLength === "custom"
      ? Number(body.customPoolLength === undefined ? current.customPoolLength : body.customPoolLength)
      : null;
    if (poolLength === "custom" && (!Number.isFinite(customPoolLength) || customPoolLength <= 0 || customPoolLength > 10000)) {
      throw appError("Bitte eine gültige benutzerdefinierte Bahnlänge eingeben.");
    }
    const enabledDisciplines = validatedEnabledDisciplines(body.enabledDisciplines, current.enabledDisciplines || DEFAULT_DISCIPLINES);
    return {
      name: cleanText(body.name === undefined ? current.name : body.name, "Eventname"),
      eventDate,
      location: cleanText(body.location === undefined ? current.location : body.location, "Ort", 120, false),
      timerEnabled: fieldValue.delete(),
      resultsMode: fieldValue.delete(),
      resultsPausedAt: fieldValue.delete(),
      resultsPauseGeneration: fieldValue.delete(),
      participantMode: fieldValue.delete(),
      poolLength,
      customPoolLength,
      enabledDisciplines,
      resultUrl: validatedEventUrl(body.resultUrl === undefined ? current.resultUrl : body.resultUrl),
      timerAccess: accessLevel(body.timerAccess, accessLevel(current.timerAccess, DEFAULT_ACCESS.timerAccess)),
      resultsAccess: accessLevel(body.resultsAccess, accessLevel(current.resultsAccess, DEFAULT_ACCESS.resultsAccess)),
      participantViewAccess: accessLevel(body.participantViewAccess, accessLevel(current.participantViewAccess, DEFAULT_ACCESS.participantViewAccess)),
      participantEditAccess: accessLevel(body.participantEditAccess, accessLevel(current.participantEditAccess, DEFAULT_ACCESS.participantEditAccess)),
      resultEditAccess: accessLevel(body.resultEditAccess, accessLevel(current.resultEditAccess, DEFAULT_ACCESS.resultEditAccess)),
      updatedAt: fieldValue.serverTimestamp(),
    };
  }

  function previewEventUpdate(event, body) {
    const data = { name: event.name, eventDate: event.event_date, location: event.location,
      poolLength: event.pool_length, customPoolLength: event.custom_pool_length,
      enabledDisciplines: window.TimerCore.enabledDisciplinesForEvent(event), resultUrl: event.result_url,
      timerAccess: event.timer_access, resultsAccess: event.results_access,
      participantViewAccess: event.participant_view_access, participantEditAccess: event.participant_edit_access,
      resultEditAccess: event.result_edit_access };
    return mapEvent({ id: event.id, data: () => eventUpdateData(data, body) });
  }

  async function request(path, options = {}) {
    await Promise.all([initialAuth, persistenceReady]);
    const checkSession = participantSessionCheck(options.background === true);
    const method = String(options.method || "GET").toUpperCase();
    const url = new URL(path, window.location.origin);
    const parts = url.pathname.split("/").filter(Boolean).map((part) => {
      let decoded;
      try { decoded = decodeURIComponent(part); }
      catch { throw appError("Ungültige Adresse."); }
      if (/[\/\\\u0000-\u001f]/.test(decoded)) throw appError("Ungültige Adresse.");
      return decoded;
    });
    if (parts[0] !== "events") throw appError("Nicht gefunden.", 404);

    try {
      if (parts.length === 1 && method === "GET") {
        const snapshot = await pageQuery(eventsCollection, url.searchParams.get("cursor")).get();
        checkSession();
        return { events: snapshot.docs.map(mapEvent), ...pageInfo(snapshot) };
      }

      if (parts.length === 1 && method === "POST") {
        requireOrganizer();
        const body = parseBody(options);
        const id = mutationId(body);
        const data = eventCreationData(body);
        const ref = eventsCollection.doc(id);
        await db.runTransaction(async (transaction) => {
          const existing = await transaction.get(ref);
          checkSession();
          if (!existing.exists) transaction.set(ref, data);
        });
        return { id };
      }

      const eventId = parts[1];
      if (!eventId) throw appError("Nicht gefunden.", 404);

      if (parts.length === 2 && method === "GET") {
        const snapshot = await eventSnapshot(eventId);
        const event = mapEvent(snapshot);
        const participants = url.searchParams.get("participants") !== "0" && (event.can_view_participants || event.can_use_timer || event.can_edit_results)
          ? await listParticipants(eventId)
          : [];
        if (url.searchParams.get("prepareImport") === "1" && event.can_import_participants) {
          await prepareParticipantIndex(snapshot, event, checkSession);
        }
        checkSession();
        return { event, participants };
      }

      if (parts.length === 2 && method === "DELETE") {
        requireOrganizer();
        await eventSnapshot(eventId);
        await deleteEvent(eventId, checkSession);
        return { ok: true };
      }

      if (parts.length === 2 && method === "PATCH") {
        requireOrganizer();
        const body = parseBody(options);
        const snapshot = await eventSnapshot(eventId);
        const update = eventUpdateData(snapshot.data() || {}, body);
        checkSession();
        await snapshot.ref.update(update);
        return { ok: true };
      }

      const snapshot = await eventSnapshot(eventId);
      const event = mapEvent(snapshot);

      if (parts[2] === "participants" && parts[3] === "import" && method === "GET") {
        requireOrganizer();
        requirePermission(event, "can_import_participants");
        const queryText = normalizedPersonName(url.searchParams.get("q") || "");
        if (queryText.length < 3) return { candidates: [] };
        if (queryText.length > 80) throw appError("Suchbegriff ist zu lang.");
        const eventYear = eventYearOf(event.event_date);
        if (!eventYear) throw appError("Für den Import muss beim Event ein Datum hinterlegt sein.");
        const directory = await searchDirectory(queryText);
        const directoryReady = !directory.empty || await directoryIsReady();
        return {
          directoryReady,
          candidates: directory.docs.map((document) => {
            const data = document.data() || {};
            const gender = data.gender === "w" ? "female" : "male";
            const birthYear = Number(data.birthYear);
            return {
              id: document.id,
              name: data.name || "",
              birthYear,
              gender,
              organization: data.organization || "Unbekannt",
              ageGroup: ageGroupFor(birthYear, eventYear),
            };
          }),
        };
      }

      if (parts[2] === "participants" && parts[3] === "import" && method === "POST") {
        requireOrganizer();
        requirePermission(event, "can_import_participants");
        const body = parseBody(options);
        const candidateId = cleanText(body.candidateId, "Person", 64);
        const id = mutationId(body);
        if (body.clientMutationId) {
          const existing = await snapshot.ref.collection("participants").doc(id).get();
          checkSession();
          if (existing.exists) {
            const participant = mapParticipant(existing);
            updateParticipantCache(eventId, id, participant);
            return { id, participant };
          }
        }
        const candidate = await directoryCollection.doc(candidateId).get();
        if (!candidate.exists) throw appError("Person wurde nicht gefunden.", 404);
        const data = candidate.data() || {};
        const eventYear = eventYearOf(event.event_date);
        if (!eventYear) throw appError("Für den Import muss beim Event ein Datum hinterlegt sein.");
        const gender = data.gender === "w" ? "female" : "male";
        const birthYear = Number(data.birthYear);
        await prepareParticipantIndex(snapshot, event, checkSession);
        const saved = await participantStore.commit(db, snapshot.ref, id, {
          name: data.name,
          birthYear: birthYear % 100,
          ageGroup: ageGroupFor(birthYear, eventYear),
          gender,
          organization: data.organization || "Unbekannt",
          sourceDirectoryId: candidate.id,
        }, fieldValue, checkSession, true);
        checkSession();
        const participant = mapParticipant(saved);
        updateParticipantCache(eventId, id, participant);
        return { id, participant };
      }

      if (parts[2] === "participants" && parts.length === 3 && method === "POST") {
        requirePermission(event, "can_edit_participants");
        const body = parseBody(options);
        const id = mutationId(body);
        if (body.clientMutationId) {
          const existing = await snapshot.ref.collection("participants").doc(id).get();
          checkSession();
          if (existing.exists) {
            const participant = mapParticipant(existing);
            updateParticipantCache(eventId, id, participant);
            return { id, participant };
          }
        }
        await prepareParticipantIndex(snapshot, event, checkSession);
        const saved = await participantStore.commit(db, snapshot.ref, id, participantPayload(body), fieldValue, checkSession, true);
        checkSession();
        const participant = mapParticipant(saved);
        updateParticipantCache(eventId, id, participant);
        return { id, participant };
      }

      if (parts[2] === "participants" && parts[3] && parts.length === 4 && method === "PATCH") {
        requirePermission(event, "can_edit_participants");
        await prepareParticipantIndex(snapshot, event, checkSession);
        const saved = await participantStore.commit(db, snapshot.ref, parts[3], participantPayload(parseBody(options)), fieldValue, checkSession);
        checkSession();
        const participant = mapParticipant(saved);
        updateParticipantCache(eventId, parts[3], participant);
        return { ok: true, participant };
      }

      if (parts[2] === "participants" && parts[3] && parts.length === 4 && method === "DELETE") {
        requirePermission(event, "can_edit_participants");
        await prepareParticipantIndex(snapshot, event, checkSession);
        await participantStore.commit(db, snapshot.ref, parts[3], null, fieldValue, checkSession);
        checkSession();
        updateParticipantCache(eventId, parts[3], null);
        return { ok: true };
      }

      if (parts[2] === "results" && parts.length === 3 && method === "GET") {
        requirePermission(event, "can_view_results");
        const results = await pageQuery(snapshot.ref.collection("results"), url.searchParams.get("cursor")).get();
        checkSession();
        const filtered = results.docs.map(mapResult).filter((result) => {
          const discipline = url.searchParams.get("discipline");
          const gender = url.searchParams.get("gender");
          return (!discipline || result.discipline === discipline) && (!gender || result.gender === gender);
        }).sort((left, right) => {
          const leftTime = left.official_centiseconds ?? left.total_centiseconds;
          const rightTime = right.official_centiseconds ?? right.total_centiseconds;
          return leftTime - rightTime || left.created_at.localeCompare(right.created_at);
        });
        return { results: filtered, ...pageInfo(results) };
      }

      async function resultWritePayload(body, existingData = null) {
        const disciplineId = existingData?.discipline || body.discipline;
        if (!(disciplineId in DISCIPLINES)) throw appError("Ungültige Disziplin.");
        const discipline = existingData
          ? window.TimerCore.disciplineForResult(existingData, event)
          : window.TimerCore.disciplineForEvent(disciplineId, event);
        let participantIds;
        if (discipline.team) {
          participantIds = body.participantIds === undefined ? existingData?.participantIds : body.participantIds;
        } else {
          const participantId = body.participantId === undefined ? existingData?.participantId : body.participantId;
          participantIds = [participantId];
        }
        if (!Array.isArray(participantIds) || participantIds.some((id) => typeof id !== "string" || !id)) {
          throw appError("Personenzuordnung fehlt.");
        }
        if (discipline.team && (participantIds.length !== 4 || new Set(participantIds).size !== 4)) {
          throw appError("Eine Mannschaft benötigt vier unterschiedliche Personen.");
        }
        const participants = await Promise.all(participantIds.map((participantId) => getParticipant(eventId, participantId)));
        if (discipline.mixed && participants.filter((participant) => participant.gender === "female").length !== 2) {
          throw appError("Eine Mixed-Staffel benötigt zwei Frauen und zwei Männer.");
        }
        const primary = discipline.team && !discipline.mixed
          ? participants.find((participant) => participant.gender === "male") || participants[0]
          : participants[0];
        const timing = validatedResultTiming(body, discipline);
        return {
          discipline: disciplineId,
          participantId: primary.id,
          participantIds,
          participant: participantSnapshot(primary),
          teamMembers: discipline.team ? participants.map(participantSnapshot) : [],
          ...timing,
          note: cleanText(body.note === undefined ? existingData?.note || "" : body.note, "Notiz", 300, false),
        };
      }

      if (parts[2] === "results" && parts.length === 3 && method === "POST") {
        requirePermission(event, "can_use_timer");
        const body = parseBody(options);
        const id = body.clientSubmissionId && /^[A-Za-z0-9-]{8,64}$/.test(body.clientSubmissionId)
          ? body.clientSubmissionId
          : crypto.randomUUID();
        const resultRef = snapshot.ref.collection("results").doc(id);
        const existing = await resultRef.get();
        if (existing.exists) {
          const data = existing.data() || {};
          return {
            id,
            totalCentiseconds: data.totalCentiseconds,
            officialCentiseconds: data.officialCentiseconds ?? null,
            alreadySaved: true,
          };
        }
        const payload = await resultWritePayload(body);
        checkSession();
        await resultRef.set({
          ...payload,
          submissionKey: body.clientSubmissionId || null,
          createdAt: fieldValue.serverTimestamp(),
          updatedAt: fieldValue.serverTimestamp(),
        });
        return {
          id,
          totalCentiseconds: payload.totalCentiseconds,
          officialCentiseconds: payload.officialCentiseconds,
        };
      }

      if (parts[2] === "results" && parts[3] && parts.length === 4 && method === "PATCH") {
        requirePermission(event, "can_edit_results");
        const resultRef = snapshot.ref.collection("results").doc(parts[3]);
        const existing = await resultRef.get();
        if (!existing.exists) throw appError("Ergebnis nicht gefunden.", 404);
        const payload = await resultWritePayload(parseBody(options), existing.data() || {});
        checkSession();
        await resultRef.update({ ...payload, createdPauseGeneration: fieldValue.delete(), updatedAt: fieldValue.serverTimestamp() });
        return { ok: true, totalCentiseconds: payload.totalCentiseconds, officialCentiseconds: payload.officialCentiseconds };
      }

      if (parts[2] === "results" && parts[3] && parts.length === 4 && method === "DELETE") {
        requirePermission(event, "can_edit_results");
        const resultRef = snapshot.ref.collection("results").doc(parts[3]);
        const existing = await resultRef.get();
        if (!existing.exists) throw appError("Ergebnis nicht gefunden.", 404);
        checkSession();
        await resultRef.delete();
        return { ok: true };
      }

      throw appError("Nicht gefunden.", 404);
    } catch (error) {
      if (error?.status) throw error;
      throw translateFirebaseError(error);
    }
  }

  window.timerFirestoreApi = { request, getAuthContext, signOut, watchResults, clearParticipantCache, previewEvent, previewEventUpdate,
    validateParticipant: participantPayload,
    getActiveAccountId: () => auth.currentUser?.uid || null };
})();
