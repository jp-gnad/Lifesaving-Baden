(function () {
  "use strict";

  const DISCIPLINES = Object.freeze({
    normal: { laps: 20, flexible: true },
    rescue50: { laps: 2 },
    rescue100: { laps: 3 },
    lifesaver100: { laps: 3 },
    medley100: { laps: 3 },
    superLifesaver200: { laps: 7 },
    obstacle200: { laps: 4 },
    manikinRelay4x25: { laps: 4, team: true },
    rescueTubeRelay4x50: { laps: 4, team: true },
    rescueRelay4x50: { laps: 4, team: true },
    obstacleRelay4x50: { laps: 4, team: true },
    mixedRelay4x50: { laps: 4, team: true, mixed: true },
    lineThrow: { laps: 2, team: true },
  });

  const DEFAULT_DISCIPLINES = Object.keys(DISCIPLINES);
  const ACCESS_LEVELS = new Set(["organizer", "authenticated", "everyone"]);
  const DEFAULT_ACCESS = Object.freeze({
    timerAccess: "organizer",
    resultsAccess: "everyone",
    participantViewAccess: "everyone",
    participantEditAccess: "organizer",
    resultEditAccess: "organizer",
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
      "permission-denied": "Dafür fehlen dir die erforderlichen Rechte.",
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

  function normalizedRole(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizedPersonName(value = "") {
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]/g, "");
  }

  function personIdentity(name, birthYear, gender) {
    return `${normalizedPersonName(name)}|${Number(birthYear) % 100}|${gender}`;
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
    return { segments, lapGroups, frequencies, totalCentiseconds, officialCentiseconds };
  }

  if (!window.firebase || !window.firebase.auth || !window.firebase.firestore || !window.isFirebaseConfigured) {
    window.timerFirestoreApi = {
      request: async () => { throw appError("Firebase ist für den Lifesaving Timer noch nicht verfügbar.", 503); },
      getAuthContext: async () => ({ authenticated: false, isOrganizer: false, isAdmin: false }),
      signOut: async () => { throw appError("Firebase ist für den Lifesaving Timer noch nicht verfügbar.", 503); },
      watchResults: () => () => {},
    };
    return;
  }

  if (!window.firebase.apps.length) window.firebase.initializeApp(window.firebaseConfig);
  const auth = window.firebase.auth();
  const db = window.firebase.firestore();
  const persistenceReady = db.enablePersistence({ synchronizeTabs: true }).catch((error) => {
    if (!["failed-precondition", "unimplemented"].includes(String(error?.code || "").replace(/^firestore\//, ""))) {
      console.warn("Firestore-Offlinespeicher konnte nicht aktiviert werden.", error);
    }
  });
  const fieldValue = window.firebase.firestore.FieldValue;
  const eventsCollection = db.collection("timerEvents");
  const directoryCollection = db.collection("timerParticipantDirectory");
  let directoryReadyPromise = null;

  let authContext = {
    user: null,
    authenticated: false,
    isOrganizer: false,
    isAdmin: false,
    role: "guest",
  };
  let resolveInitialAuth;
  const initialAuth = new Promise((resolve) => { resolveInitialAuth = resolve; });
  let initialAuthResolved = false;

  auth.onAuthStateChanged(async (user) => {
    await persistenceReady;
    let userData = {};
    let claims = {};
    if (user) {
      try {
        const [userSnapshot, tokenResult] = await Promise.all([
          db.collection("users").doc(user.uid).get(),
          user.getIdTokenResult(),
        ]);
        userData = userSnapshot.exists ? userSnapshot.data() || {} : {};
        claims = tokenResult.claims || {};
      } catch (error) {
        console.warn("Timer-Rolle konnte nicht geladen werden.", error);
      }
    }
    const claimRole = normalizedRole(claims.role);
    const dataRole = normalizedRole(userData.role);
    const isAdmin = Boolean(
      claims.admin === true
      || claims.isAdmin === true
      || claimRole === "admin"
      || dataRole === "admin"
      || userData.admin === true
      || userData.isAdmin === true
    );
    const isOrganizer = isAdmin || Boolean(
      claims.organizer === true
      || claims.isOrganizer === true
      || ["organizer", "organisator"].includes(claimRole)
      || ["organizer", "organisator"].includes(dataRole)
    );
    authContext = {
      user,
      authenticated: Boolean(user && user.emailVerified),
      isOrganizer,
      isAdmin,
      role: isAdmin ? "admin" : (isOrganizer ? "organizer" : (user ? "authenticated" : "guest")),
    };
    if (!initialAuthResolved) {
      initialAuthResolved = true;
      resolveInitialAuth(authContext);
    }
    window.dispatchEvent(new CustomEvent("timer-auth-change", { detail: { ...authContext, user: undefined } }));
  });

  async function getAuthContext() {
    await initialAuth;
    return authContext;
  }

  async function signOut() {
    await auth.signOut();
  }

  function canUseAccess(level) {
    if (authContext.isOrganizer) return true;
    if (level === "everyone") return true;
    return level === "authenticated" && authContext.authenticated;
  }

  function permissionSet(data) {
    const timerAccess = accessLevel(data.timerAccess, DEFAULT_ACCESS.timerAccess);
    const resultsAccess = accessLevel(data.resultsAccess, DEFAULT_ACCESS.resultsAccess);
    const participantViewAccess = accessLevel(data.participantViewAccess, DEFAULT_ACCESS.participantViewAccess);
    const participantEditAccess = accessLevel(data.participantEditAccess, DEFAULT_ACCESS.participantEditAccess);
    const resultEditAccess = accessLevel(data.resultEditAccess, DEFAULT_ACCESS.resultEditAccess);
    const participantMode = ["edit", "view", "hidden"].includes(data.participantMode) ? data.participantMode : "edit";
    const resultsMode = ["live", "pause", "stop"].includes(data.resultsMode) ? data.resultsMode : "live";
    const timerEnabled = data.timerEnabled !== false;
    return {
      timerAccess,
      resultsAccess,
      participantViewAccess,
      participantEditAccess,
      resultEditAccess,
      canManageEvent: authContext.isOrganizer,
      canUseTimer: timerEnabled && canUseAccess(timerAccess),
      canViewResults: resultsMode !== "stop" && canUseAccess(resultsAccess),
      canViewParticipants: participantMode !== "hidden" && (
        canUseAccess(participantViewAccess)
        || canUseAccess(participantEditAccess)
        || canUseAccess(timerAccess)
      ),
      canEditParticipants: participantMode === "edit" && canUseAccess(participantEditAccess),
      canImportParticipants: participantMode === "edit" && authContext.isOrganizer,
      canEditResults: resultsMode === "live" && canUseAccess(resultsAccess) && canUseAccess(resultEditAccess),
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
      timer_enabled: data.timerEnabled === false ? 0 : 1,
      results_mode: ["live", "pause", "stop"].includes(data.resultsMode) ? data.resultsMode : "live",
      results_paused_at: timestampText(data.resultsPausedAt) || null,
      results_pause_generation: Number(data.resultsPauseGeneration) || 0,
      participant_mode: ["edit", "view", "hidden"].includes(data.participantMode) ? data.participantMode : "edit",
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
      lap_groups: Array.isArray(data.lapGroups) ? data.lapGroups : [],
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
      created_pause_generation: data.createdPauseGeneration ?? null,
    };
  }

  function visibleResults(snapshot, event) {
    return snapshot.docs.map(mapResult).filter((result) => (
      event.results_mode !== "pause"
      || result.created_pause_generation !== event.results_pause_generation
    )).sort((left, right) => {
      const leftTime = left.official_centiseconds ?? left.total_centiseconds;
      const rightTime = right.official_centiseconds ?? right.total_centiseconds;
      return leftTime - rightTime || left.created_at.localeCompare(right.created_at);
    });
  }

  function watchResults(eventId, onValue, onError = () => {}) {
    let disposed = false;
    let unsubscribeResults = () => {};
    const reportError = (error) => {
      if (!disposed) onError(translateFirebaseError(error));
    };
    const unsubscribeEvent = eventsCollection.doc(eventId).onSnapshot((snapshot) => {
      if (disposed) return;
      unsubscribeResults();
      unsubscribeResults = () => {};
      if (!snapshot.exists) {
        onError(appError("Event nicht gefunden.", 404));
        return;
      }
      const event = mapEvent(snapshot);
      if (!event.can_view_results || event.results_mode === "stop") {
        onValue({ event, mode: event.results_mode, results: [] });
        return;
      }
      let query = snapshot.ref.collection("results");
      if (event.results_mode === "pause") {
        query = query.where("createdPauseGeneration", "!=", event.results_pause_generation);
      }
      unsubscribeResults = query.onSnapshot((resultsSnapshot) => {
        if (!disposed) onValue({ event, mode: event.results_mode, results: visibleResults(resultsSnapshot, event) });
      }, reportError);
    }, reportError);
    return () => {
      disposed = true;
      unsubscribeResults();
      unsubscribeEvent();
    };
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
    const snapshot = await eventsCollection.doc(eventId).collection("participants").get();
    return snapshot.docs.map(mapParticipant).sort((left, right) => left.name.localeCompare(right.name, "de"));
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

  async function deleteDocuments(documents) {
    for (let offset = 0; offset < documents.length; offset += 400) {
      const batch = db.batch();
      documents.slice(offset, offset + 400).forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
  }

  async function deleteEvent(eventId) {
    const eventRef = eventsCollection.doc(eventId);
    const [participants, results] = await Promise.all([
      eventRef.collection("participants").get(),
      eventRef.collection("results").get(),
    ]);
    await deleteDocuments([...participants.docs, ...results.docs]);
    await eventRef.delete();
  }

  async function request(path, options = {}) {
    await Promise.all([initialAuth, persistenceReady]);
    const method = String(options.method || "GET").toUpperCase();
    const url = new URL(path, window.location.origin);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "events") throw appError("Nicht gefunden.", 404);

    try {
      if (parts.length === 1 && method === "GET") {
        const snapshot = await eventsCollection.get();
        return { events: snapshot.docs.map(mapEvent) };
      }

      if (parts.length === 1 && method === "POST") {
        requireOrganizer();
        const body = parseBody(options);
        const eventDate = body.eventDate ? cleanText(body.eventDate, "Datum", 10) : null;
        if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw appError("Ungültiges Datum.");
        const id = crypto.randomUUID();
        await eventsCollection.doc(id).set({
          name: cleanText(body.name, "Eventname"),
          eventDate,
          location: cleanText(body.location, "Ort", 120, false),
          timerEnabled: true,
          resultsMode: "live",
          resultsPausedAt: null,
          resultsPauseGeneration: 0,
          participantMode: "edit",
          poolLength: "25",
          customPoolLength: null,
          enabledDisciplines: DEFAULT_DISCIPLINES,
          resultUrl: "",
          ...DEFAULT_ACCESS,
          createdAt: fieldValue.serverTimestamp(),
          updatedAt: fieldValue.serverTimestamp(),
        });
        return { id };
      }

      const eventId = parts[1];
      if (!eventId) throw appError("Nicht gefunden.", 404);

      if (parts.length === 2 && method === "GET") {
        const snapshot = await eventSnapshot(eventId);
        const event = mapEvent(snapshot);
        const participants = event.can_view_participants || event.can_use_timer || event.can_edit_results
          ? await listParticipants(eventId)
          : [];
        return { event, participants };
      }

      if (parts.length === 2 && method === "DELETE") {
        requireOrganizer();
        await eventSnapshot(eventId);
        await deleteEvent(eventId);
        return { ok: true };
      }

      if (parts.length === 2 && method === "PATCH") {
        requireOrganizer();
        const body = parseBody(options);
        const snapshot = await eventSnapshot(eventId);
        const current = snapshot.data() || {};
        const eventDate = body.eventDate ? cleanText(body.eventDate, "Datum", 10) : null;
        if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw appError("Ungültiges Datum.");
        const timerEnabled = body.timerEnabled === undefined ? current.timerEnabled !== false : body.timerEnabled;
        if (typeof timerEnabled !== "boolean") throw appError("Ungültiger Timer-Status.");
        const resultsMode = body.resultsMode === undefined ? current.resultsMode || "live" : body.resultsMode;
        if (!["live", "pause", "stop"].includes(resultsMode)) throw appError("Ungültiger Ergebnis-Status.");
        const participantMode = body.participantMode === undefined ? current.participantMode || "edit" : body.participantMode;
        if (!["edit", "view", "hidden"].includes(participantMode)) throw appError("Ungültige Personen-Einstellung.");
        const poolLength = body.poolLength === undefined ? current.poolLength || "25" : String(body.poolLength);
        if (!["25", "50", "custom"].includes(poolLength)) throw appError("Ungültige Bahnlänge.");
        const customPoolLength = poolLength === "custom"
          ? Number(body.customPoolLength === undefined ? current.customPoolLength : body.customPoolLength)
          : null;
        if (poolLength === "custom" && (!Number.isFinite(customPoolLength) || customPoolLength <= 0 || customPoolLength > 10000)) {
          throw appError("Bitte eine gültige benutzerdefinierte Bahnlänge eingeben.");
        }
        const enabledDisciplines = validatedEnabledDisciplines(body.enabledDisciplines, current.enabledDisciplines || DEFAULT_DISCIPLINES);
        let resultsPauseGeneration = Number(current.resultsPauseGeneration) || 0;
        let resultsPausedAt = current.resultsPausedAt || null;
        if (resultsMode === "live") resultsPausedAt = null;
        if (resultsMode === "pause" && current.resultsMode !== "pause") {
          resultsPauseGeneration += 1;
          resultsPausedAt = fieldValue.serverTimestamp();
        }
        const update = {
          name: cleanText(body.name === undefined ? current.name : body.name, "Eventname"),
          eventDate,
          location: cleanText(body.location === undefined ? current.location : body.location, "Ort", 120, false),
          timerEnabled,
          resultsMode,
          resultsPausedAt,
          resultsPauseGeneration,
          participantMode,
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
        const [directory, imported, directoryReady] = await Promise.all([
          directoryCollection.orderBy("searchName").startAt(queryText).endAt(`${queryText}\uf8ff`).limit(10).get(),
          listParticipants(eventId),
          directoryIsReady(),
        ]);
        const importedIdentities = new Set(imported.map((person) => personIdentity(person.name, person.birth_year, person.gender)));
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
              alreadyImported: importedIdentities.has(personIdentity(data.name, birthYear, gender)),
            };
          }),
        };
      }

      if (parts[2] === "participants" && parts[3] === "import" && method === "POST") {
        requireOrganizer();
        requirePermission(event, "can_import_participants");
        const body = parseBody(options);
        const candidateId = cleanText(body.candidateId, "Person", 64);
        const candidate = await directoryCollection.doc(candidateId).get();
        if (!candidate.exists) throw appError("Person wurde nicht gefunden.", 404);
        const data = candidate.data() || {};
        const eventYear = eventYearOf(event.event_date);
        if (!eventYear) throw appError("Für den Import muss beim Event ein Datum hinterlegt sein.");
        const gender = data.gender === "w" ? "female" : "male";
        const birthYear = Number(data.birthYear);
        const participants = await listParticipants(eventId);
        if (participants.some((person) => personIdentity(person.name, person.birth_year, person.gender)
          === personIdentity(data.name, birthYear, gender))) {
          throw appError("Diese Person ist bereits im Event vorhanden.", 409);
        }
        const id = crypto.randomUUID();
        await snapshot.ref.collection("participants").doc(id).set({
          name: data.name,
          birthYear: birthYear % 100,
          ageGroup: ageGroupFor(birthYear, eventYear),
          gender,
          organization: data.organization || "Unbekannt",
          sourceDirectoryId: candidate.id,
          createdAt: fieldValue.serverTimestamp(),
          updatedAt: fieldValue.serverTimestamp(),
        });
        return { id };
      }

      if (parts[2] === "participants" && parts.length === 3 && method === "POST") {
        requirePermission(event, "can_edit_participants");
        const body = parseBody(options);
        const id = crypto.randomUUID();
        await snapshot.ref.collection("participants").doc(id).set({
          ...participantPayload(body),
          createdAt: fieldValue.serverTimestamp(),
          updatedAt: fieldValue.serverTimestamp(),
        });
        return { id };
      }

      if (parts[2] === "participants" && parts[3] && parts.length === 4 && method === "PATCH") {
        requirePermission(event, "can_edit_participants");
        const participantRef = snapshot.ref.collection("participants").doc(parts[3]);
        const existing = await participantRef.get();
        if (!existing.exists) throw appError("Person wurde nicht gefunden.", 404);
        await participantRef.update({ ...participantPayload(parseBody(options)), updatedAt: fieldValue.serverTimestamp() });
        return { ok: true };
      }

      if (parts[2] === "participants" && parts[3] && parts.length === 4 && method === "DELETE") {
        requirePermission(event, "can_edit_participants");
        const participantRef = snapshot.ref.collection("participants").doc(parts[3]);
        const existing = await participantRef.get();
        if (!existing.exists) throw appError("Person wurde nicht gefunden.", 404);
        await participantRef.delete();
        return { ok: true };
      }

      if (parts[2] === "results" && parts.length === 3 && method === "GET") {
        requirePermission(event, "can_view_results");
        let resultsQuery = snapshot.ref.collection("results");
        if (event.results_mode === "pause") {
          resultsQuery = resultsQuery.where("createdPauseGeneration", "!=", event.results_pause_generation);
        }
        const results = await resultsQuery.get();
        const filtered = results.docs.map(mapResult).filter((result) => {
          if (event.results_mode === "pause" && result.created_pause_generation === event.results_pause_generation) return false;
          const discipline = url.searchParams.get("discipline");
          const gender = url.searchParams.get("gender");
          return (!discipline || result.discipline === discipline) && (!gender || result.gender === gender);
        }).sort((left, right) => {
          const leftTime = left.official_centiseconds ?? left.total_centiseconds;
          const rightTime = right.official_centiseconds ?? right.total_centiseconds;
          return leftTime - rightTime || left.created_at.localeCompare(right.created_at);
        });
        return { mode: event.results_mode, results: filtered };
      }

      async function resultWritePayload(body, existingData = null) {
        const disciplineId = existingData?.discipline || body.discipline;
        if (!(disciplineId in DISCIPLINES)) throw appError("Ungültige Disziplin.");
        const discipline = DISCIPLINES[disciplineId];
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
        await resultRef.set({
          ...payload,
          submissionKey: body.clientSubmissionId || null,
          createdPauseGeneration: event.results_mode === "pause" ? event.results_pause_generation : -1,
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
        await resultRef.update({ ...payload, updatedAt: fieldValue.serverTimestamp() });
        return { ok: true, totalCentiseconds: payload.totalCentiseconds, officialCentiseconds: payload.officialCentiseconds };
      }

      if (parts[2] === "results" && parts[3] && parts.length === 4 && method === "DELETE") {
        requirePermission(event, "can_edit_results");
        const resultRef = snapshot.ref.collection("results").doc(parts[3]);
        const existing = await resultRef.get();
        if (!existing.exists) throw appError("Ergebnis nicht gefunden.", 404);
        await resultRef.delete();
        return { ok: true };
      }

      throw appError("Nicht gefunden.", 404);
    } catch (error) {
      if (error?.status) throw error;
      throw translateFirebaseError(error);
    }
  }

  window.timerFirestoreApi = { request, getAuthContext, signOut, watchResults };
})();
