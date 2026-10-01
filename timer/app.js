const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const offlineSyncStatus = document.querySelector("#offline-sync-status");
const offlineSyncText = document.querySelector("#offline-sync-text");
const viewportMeta = document.querySelector('meta[name="viewport"]');
const defaultViewport = viewportMeta.content;
const timerAccountControl = document.querySelector("#timer-account-control");
const timerAccountDialog = document.querySelector("#timer-account-dialog");
const timerAccountLogout = document.querySelector("#timer-account-logout");
const timerFooterPortalLink = document.querySelector("#timer-footer-portal-link");

const offlineDatabaseName = "lifesaving-timer-offline";
const offlineDatabaseVersion = 1;
const pendingResultsStore = "pendingResults";

const disciplines = {
  normal: { name: "Benutzerdefiniert", laps: 20, flexible: true, group: "normal" },
  rescue50: { name: "50 m Retten", laps: 2, group: "individual", lapLabels: ["25 m Kraul", "25 m Puppe"] },
  rescue100: { name: "100 m Retten", laps: 3, group: "individual", lapLabels: ["50 m Flossen", "10 m Aufnahme", "40 m Puppe Flossen"] },
  lifesaver100: { name: "100 m Lifesaver", laps: 3, group: "individual", lapLabels: ["50 m Gurtretter Flossen", "10 m Einklinken", "40 m Ziehen"] },
  medley100: { name: "100 m Kombi", laps: 3, group: "individual", lapLabels: ["50 m Kraul", "17,5 m Tauchen", "32,5 m Puppe"] },
  superLifesaver200: { name: "200 m Super Lifesaver", laps: 7, group: "individual", lapLabels: ["50 m Kraul", "25 m Kraul", "25 m Puppe", "5 m Einklinken", "45 m Flossen Gurt", "10 m Einklinken", "40 m Ziehen"] },
  obstacle200: { name: "200 m Hindernis", laps: 4, group: "individual", lapLabels: ["Runde 1 (50 m)", "Runde 2 (100 m)", "Runde 3 (150 m)", "Runde 4 (200 m)"] },
  manikinRelay4x25: { name: "4 × 25 m Puppenstaffel", laps: 4, group: "team", team: true, lapLabels: ["Position 1", "Position 2", "Position 3", "Position 4"] },
  rescueTubeRelay4x50: { name: "4 × 50 m Gurtretterstaffel", laps: 4, group: "team", team: true, lapLabels: ["50 m Kraul", "50 m Flossen", "50 m Gurt", "50 m Ziehen"] },
  rescueRelay4x50: { name: "4 × 50 m Rettungsstaffel", laps: 4, group: "team", team: true, lapLabels: ["50 m Kraul", "50 m Flossen", "50 m Puppe", "50 m Puppe Flossen"] },
  obstacleRelay4x50: { name: "4 × 50 m Hindernisstaffel", laps: 4, group: "team", team: true, lapLabels: ["Position 1", "Position 2", "Position 3", "Position 4"] },
  mixedRelay4x50: { name: "4 × 50 m Mixed Staffel", laps: 4, group: "team", team: true, mixed: true, lapLabels: ["50 m Kraul", "50 m Flossen", "50 m Puppe", "50 m Puppe Flossen"] },
  lineThrow: { name: "LineThrow", laps: 2, group: "team", team: true, lapLabels: ["12,5 m Treffen", "12,5 m Ziehen"] },
};

const disciplineGroups = [
  { id: "normal", name: "Benutzerdefiniert" },
  { id: "individual", name: "Einzel" },
  { id: "team", name: "Mannschaft" },
];

function enabledDisciplinesForEvent(event) {
  try {
    const selected = JSON.parse(event?.enabled_disciplines_json || "[]");
    const valid = selected.filter((discipline) => discipline in disciplines);
    return valid.length ? valid : Object.keys(disciplines);
  } catch {
    return Object.keys(disciplines);
  }
}

function eventCan(event, permission) {
  return event?.[permission] === true;
}

function accessLabel(value) {
  if (value === "everyone") return "Jeder";
  if (value === "authenticated") return "Angemeldete Personen";
  if (value === "kader") return "Kadersportler";
  if (value === "organizer") return "Organisatoren";
  return "Gesperrt";
}

function accessSelect(name, value) {
  return `<label class="field"><span>Zugriff</span><select name="${name}">
    <option value="everyone" ${value === "everyone" ? "selected" : ""}>Jeder</option>
    <option value="authenticated" ${value === "authenticated" ? "selected" : ""}>Angemeldete Personen</option>
    <option value="kader" ${value === "kader" ? "selected" : ""}>Kadersportler</option>
    <option value="organizer" ${value === "organizer" ? "selected" : ""}>Organisatoren</option>
    <option value="locked" ${value === "locked" ? "selected" : ""}>Gesperrt (nur Admin)</option>
  </select></label>`;
}

const organizationCaps = [
  ["Cap-Bad Windsheim.svg", ["Bad Windsheim"]],
  ["Cap-Baden.svg", ["Baden", "Landesverband Baden", "LV Baden"]],
  ["Cap-Bermatingen-Markdorf.svg", ["Bermatingen-Markdorf", "Bermatingen", "Markdorf"]],
  ["Cap-Bietigheim-Bissingen.svg", ["Bietigheim-Bissingen", "Bietigheim", "Bissingen"]],
  ["Cap-Bühl-Bühlertal.svg", ["Bühl-Bühlertal", "Bühl", "Bühlertal"]],
  ["Cap-Deportivo Sirenas de Catarroja.svg", ["Deportivo Sirenas de Catarroja", "Sirenas de Catarroja", "Catarroja"]],
  ["Cap-Ditzingen.svg", ["Ditzingen"]],
  ["Cap-Duisburg-Homberg.svg", ["Duisburg-Homberg", "Homberg"]],
  ["Cap-Durlach.svg", ["Durlach"]],
  ["Cap-Ettlingen.svg", ["Ettlingen"]],
  ["Cap-Halle-Saale.svg", ["Halle-Saale", "Halle (Saale)"]],
  ["Cap-Herzogenaurach.svg", ["Herzogenaurach"]],
  ["Cap-Ingolstadt.svg", ["Ingolstadt"]],
  ["Cap-Karlsruhe.svg", ["Karlsruhe"]],
  ["Cap-Kelkheim.svg", ["Kelkheim"]],
  ["Cap-Luckenwalde.svg", ["Luckenwalde"]],
  ["Cap-Malsch.svg", ["Malsch"]],
  ["Cap-Neckargemünd.svg", ["Neckargemünd"]],
  ["Cap-Neustadt an der Weinstraße.svg", ["Neustadt an der Weinstraße"]],
  ["Cap-Nieder-OlmWörrstadt.svg", ["Nieder-Olm/Wörrstadt", "Nieder-Olm Wörrstadt"]],
  ["Cap-Pankow.svg", ["Pankow"]],
  ["Cap-Rheinböllen.svg", ["Rheinböllen"]],
  ["Cap-Schwerte.svg", ["Schwerte"]],
  ["Cap-Wadgassen.svg", ["Wadgassen"]],
  ["Cap-Waghäusel.svg", ["Waghäusel"]],
  ["Cap-Weil am Rhein.svg", ["Weil am Rhein"]],
  ["Cap-Wettersbach.svg", ["Wettersbach"]],
];

const capAssetBase = "https://raw.githubusercontent.com/jp-gnad/Lifesaving_Baden/main/web/assets/svg/";
const eventAssetBase = "https://raw.githubusercontent.com/jp-gnad/Lifesaving_Baden/main/web/assets/png/events/";

let refreshTimer = null;
let cooldownTimer = null;
let animationFrame = null;
let toastTimer = null;
let dialogScrollPosition = null;
let dialogReleaseFrame = null;
let dialogRestoreTimer = null;
let offlineDatabasePromise = null;
let offlineSyncPromise = null;
let routeCleanup = null;
let currentTimerAuth = { user: null, authenticated: false, isOrganizer: false, isAdmin: false, role: "guest" };

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="./icons.svg?v=event-settings#${name}"></use></svg>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function safeExternalUrl(value = "") {
  try {
    const url = new URL(String(value).trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function normalizedIdentity(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de-DE")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function organizationCapUrl(organization = "") {
  const normalizedOrganization = normalizedIdentity(organization);
  if (!normalizedOrganization) return null;
  const match = organizationCaps.find(([, aliases]) => aliases.some((alias) => {
    const normalizedAlias = normalizedIdentity(alias);
    return normalizedOrganization.includes(normalizedAlias)
      || (normalizedOrganization.length >= 4 && normalizedAlias.includes(normalizedOrganization));
  }));
  return match ? `${capAssetBase}${encodeURIComponent(match[0])}` : null;
}

function personInitials(name = "") {
  return String(name).trim().split(/[\s-]+/).filter(Boolean).map((part) => {
    const initial = Array.from(part)[0] || "";
    return part === part.toLocaleLowerCase("de-DE")
      ? initial.toLocaleLowerCase("de-DE")
      : initial.toLocaleUpperCase("de-DE");
  }).join("") || "?";
}

function timerLoginUrl() {
  const loginUrl = new URL("../login.html", window.location.href);
  loginUrl.searchParams.set("returnTo", `${window.location.pathname}${window.location.search}${window.location.hash}`);
  return loginUrl.href;
}

function timerAccountName(context = currentTimerAuth) {
  const user = context?.user;
  return String(context?.accountName || user?.displayName || user?.email?.split("@")[0] || "Account").trim() || "Account";
}

function timerAccountRole(context = currentTimerAuth) {
  if (context?.roleLabel) return context.roleLabel;
  if (context?.isAdmin) return "Admin";
  if (context?.isOrganizer) return "Organisator";
  return context?.authenticated ? "Sportler" : "Nicht angemeldet";
}

function timerAccountAvatar(context = currentTimerAuth) {
  const user = context?.user;
  if (user?.photoURL) return `<img src="${escapeHtml(user.photoURL)}" alt="">`;
  return `<span>${escapeHtml(personInitials(timerAccountName(context)))}</span>`;
}

function renderTimerAccount(context) {
  currentTimerAuth = context || currentTimerAuth;
  if (timerFooterPortalLink) {
    timerFooterPortalLink.setAttribute("href", currentTimerAuth.authenticated ? "../app.html" : "../index.html");
  }
  if (!timerAccountControl) return;
  if (!currentTimerAuth.authenticated) {
    timerAccountControl.innerHTML = `<a class="timer-account-trigger timer-account-login" href="${escapeHtml(timerLoginUrl())}">${icon("users")}<span>Anmelden</span></a>`;
  } else {
    const name = timerAccountName(currentTimerAuth);
    timerAccountControl.innerHTML = `<button class="timer-account-trigger" type="button" data-timer-account-open aria-label="Account von ${escapeHtml(name)} öffnen">
      <span class="timer-account-avatar timer-account-avatar-small">${timerAccountAvatar(currentTimerAuth)}</span>
      <span class="timer-account-attention" aria-hidden="true" ${currentTimerAuth.accountNeedsAttention ? "" : "hidden"}>!</span>
    </button>`;
  }
  if (!timerAccountDialog || !currentTimerAuth.authenticated) return;
  timerAccountDialog.querySelector("[data-timer-account-avatar]").innerHTML = timerAccountAvatar(currentTimerAuth);
  timerAccountDialog.querySelector("[data-timer-account-name]").textContent = timerAccountName(currentTimerAuth);
  timerAccountDialog.querySelector("[data-timer-account-email]").textContent = currentTimerAuth.user.email || "";
  const roleElement = timerAccountDialog.querySelector("[data-timer-account-role]");
  roleElement.textContent = timerAccountRole(currentTimerAuth);
  roleElement.classList.toggle("is-admin", Boolean(currentTimerAuth.isAdmin));
  const manageAttention = timerAccountDialog.querySelector("[data-timer-account-manage-attention]");
  manageAttention.hidden = !currentTimerAuth.accountNeedsAttention;
}

async function refreshTimerAccount() {
  if (!window.timerFirestoreApi) return;
  renderTimerAccount(await window.timerFirestoreApi.getAuthContext());
}

function birthYearText(value) {
  return String(Math.max(0, Number(value) || 0) % 100).padStart(2, "0");
}

function compareParticipantsByOrganization(left, right) {
  const options = { numeric: true, sensitivity: "base" };
  const organizationOrder = String(left?.organization || "").localeCompare(String(right?.organization || ""), "de", options);
  return organizationOrder || String(left?.name || "").localeCompare(String(right?.name || ""), "de", options);
}

function mixedTeamRequiredGender(selects, activeSelect, participants) {
  const selectedGenders = selects
    .filter((select) => select !== activeSelect && select.value)
    .map((select) => participants.find((person) => person.id === select.value)?.gender)
    .filter(Boolean);
  const femaleCount = selectedGenders.filter((gender) => gender === "female").length;
  const maleCount = selectedGenders.filter((gender) => gender === "male").length;
  if (femaleCount >= 2) return "male";
  if (maleCount >= 2) return "female";
  return "";
}

function hasValidMixedTeam(participantIds, participants) {
  const femaleCount = participantIds
    .map((participantId) => participants.find((person) => person.id === participantId)?.gender)
    .filter((gender) => gender === "female").length;
  return participantIds.length === 4 && femaleCount === 2;
}

function personAvatar(person) {
  const initials = personInitials(person?.name);
  const capUrl = organizationCapUrl(person?.organization);
  const genderClass = person?.gender === "female" ? "female" : "male";
  return `<span class="person-avatar ${genderClass} ${initials.length > 3 ? "long" : ""} ${capUrl ? "has-cap" : ""}" aria-hidden="true"><span>${escapeHtml(initials)}</span>${capUrl ? `<img src="${capUrl}" alt="" loading="lazy" decoding="async">` : ""}</span>`;
}

function eventIconUrls(event) {
  const year = String(event?.event_date || "").match(/^(\d{4})-/)?.[1];
  const name = String(event?.name || "").trim();
  if (!name || !year) return [];
  const filename = `${name} - ${year}`;
  return ["png", "jpg"].map((extension) => `${eventAssetBase}${encodeURIComponent(`${filename}.${extension}`)}`);
}

function eventIconMarkup(event, modifier = "") {
  const [pngUrl, jpgUrl] = eventIconUrls(event);
  if (!pngUrl) return "";
  return `<span class="event-icon ${modifier}" hidden><img src="${pngUrl}" data-fallback-src="${jpgUrl}" alt="" loading="eager" decoding="async"></span>`;
}

document.addEventListener("load", (event) => {
  if (!(event.target instanceof HTMLImageElement) || !event.target.closest(".event-icon")) return;
  event.target.closest(".event-icon").hidden = false;
}, true);

document.addEventListener("error", (event) => {
  if (!(event.target instanceof HTMLImageElement)) return;
  const eventIcon = event.target.closest(".event-icon");
  if (eventIcon) {
    const fallbackSrc = event.target.dataset.fallbackSrc;
    if (fallbackSrc) {
      delete event.target.dataset.fallbackSrc;
      event.target.src = fallbackSrc;
    } else {
      eventIcon.remove();
    }
    return;
  }
  const avatar = event.target.closest(".person-avatar");
  if (!avatar) return;
  event.target.remove();
  avatar.classList.remove("has-cap");
}, true);

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

async function api(path, options = {}) {
  try {
    if (!window.timerFirestoreApi) throw new Error("Firebase wurde nicht geladen.");
    return await window.timerFirestoreApi.request(path, options);
  } catch (cause) {
    if (cause?.status) throw cause;
    const error = new Error(cause?.message || "Keine Internetverbindung.");
    error.isNetworkError = !navigator.onLine;
    error.status = cause?.status || 503;
    error.cause = cause;
    throw error;
  }
}

function openOfflineDatabase() {
  if (!window.indexedDB) return Promise.reject(new Error("Der Offline-Speicher ist auf diesem Gerät nicht verfügbar."));
  if (offlineDatabasePromise) return offlineDatabasePromise;
  offlineDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(offlineDatabaseName, offlineDatabaseVersion);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(pendingResultsStore)) {
        request.result.createObjectStore(pendingResultsStore, { keyPath: "clientSubmissionId" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error("Offline-Speicher konnte nicht geöffnet werden.")));
  });
  offlineDatabasePromise.catch(() => { offlineDatabasePromise = null; });
  return offlineDatabasePromise;
}

async function usePendingResultsStore(mode, operation) {
  const database = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(pendingResultsStore, mode);
    const store = transaction.objectStore(pendingResultsStore);
    let request;
    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      return;
    }
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error("Offline-Speicher konnte nicht gelesen werden.")));
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("Offline-Speicher konnte nicht aktualisiert werden.")));
  });
}

function getPendingResults() {
  return usePendingResultsStore("readonly", (store) => store.getAll());
}

function getPendingResult(clientSubmissionId) {
  return usePendingResultsStore("readonly", (store) => store.get(clientSubmissionId));
}

function putPendingResult(record) {
  return usePendingResultsStore("readwrite", (store) => store.put(record));
}

function deletePendingResult(clientSubmissionId) {
  return usePendingResultsStore("readwrite", (store) => store.delete(clientSubmissionId));
}

async function updateOfflineSyncStatus() {
  if (!offlineSyncStatus || !offlineSyncText) return;
  try {
    const pending = await getPendingResults();
    offlineSyncStatus.hidden = pending.length === 0;
    offlineSyncStatus.classList.toggle("has-error", pending.some((record) => record.blocked));
    if (!pending.length) return;
    if (offlineSyncPromise) {
      offlineSyncText.textContent = `${pending.length} ${pending.length === 1 ? "Ergebnis" : "Ergebnisse"} wird synchronisiert …`;
    } else if (pending.some((record) => record.blocked)) {
      offlineSyncText.textContent = `${pending.length} ${pending.length === 1 ? "Ergebnis wartet" : "Ergebnisse warten"} · Erneut versuchen`;
    } else {
      offlineSyncText.textContent = `${pending.length} ${pending.length === 1 ? "Ergebnis wartet" : "Ergebnisse warten"}`;
    }
  } catch {
    offlineSyncStatus.hidden = true;
  }
}

function isRetryableSyncError(error) {
  return error?.isNetworkError || error?.status === 408 || error?.status === 423 || error?.status === 429 || Number(error?.status) >= 500;
}

async function uploadPendingResult(record) {
  try {
    await api(`/events/${record.eventId}/results`, {
      method: "POST",
      body: JSON.stringify(record.payload),
    });
    await deletePendingResult(record.clientSubmissionId);
    return { success: true, retryable: false };
  } catch (error) {
    const retryable = isRetryableSyncError(error);
    await putPendingResult({
      ...record,
      attempts: (record.attempts || 0) + 1,
      lastAttemptAt: new Date().toISOString(),
      lastError: error.message,
      blocked: !retryable,
    });
    return { success: false, retryable };
  }
}

async function syncPendingResults({ includeBlocked = false, notify = false } = {}) {
  if (offlineSyncPromise) return offlineSyncPromise;
  offlineSyncPromise = (async () => {
    const pending = (await getPendingResults())
      .filter((record) => includeBlocked || !record.blocked)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
    await updateOfflineSyncStatus();
    let synced = 0;
    for (const record of pending) {
      if (!navigator.onLine) break;
      const outcome = await uploadPendingResult(record);
      if (outcome.success) synced += 1;
      else if (outcome.retryable) break;
    }
    if (notify && synced) showToast(`${synced} ${synced === 1 ? "Ergebnis wurde" : "Ergebnisse wurden"} synchronisiert.`);
    return synced;
  })();
  try {
    return await offlineSyncPromise;
  } finally {
    offlineSyncPromise = null;
    await updateOfflineSyncStatus();
  }
}

async function saveResultOfflineFirst(eventId, payload) {
  const clientSubmissionId = crypto.randomUUID();
  const record = {
    clientSubmissionId,
    eventId,
    payload: { ...payload, clientSubmissionId },
    createdAt: new Date().toISOString(),
    attempts: 0,
    blocked: false,
  };
  await putPendingResult(record);
  await updateOfflineSyncStatus();
  if (!navigator.onLine) return false;
  await syncPendingResults();
  if (await getPendingResult(clientSubmissionId)) await syncPendingResults();
  return !(await getPendingResult(clientSubmissionId));
}

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { page: parts[0] || "home", id: parts[1] || null, discipline: parts[2] || null, gender: parts[3] || null };
}

function dateText(value) {
  if (!value) return "Kein Datum";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(new Date(`${value}T12:00:00`));
}

function formatTime(centiseconds) {
  const safe = Math.max(0, Math.floor(Number(centiseconds) || 0));
  const minutes = Math.floor(safe / 6000);
  const seconds = Math.floor((safe % 6000) / 100);
  const hundredths = safe % 100;
  return `${minutes}:${String(seconds).padStart(2, "0")},${String(hundredths).padStart(2, "0")}`;
}

function formatReviewTime(centiseconds) {
  const safe = Math.max(0, Math.floor(Number(centiseconds) || 0));
  return `${Math.floor(safe / 100)},${String(safe % 100).padStart(2, "0")}`;
}

function formatCumulativeReviewTime(centiseconds) {
  const safe = Math.max(0, Math.floor(Number(centiseconds) || 0));
  const minutes = Math.floor(safe / 6000);
  const seconds = Math.floor((safe % 6000) / 100);
  const hundredths = safe % 100;
  return `${minutes}:${String(seconds).padStart(2, "0")},${String(hundredths).padStart(2, "0")}`;
}

function parseTime(value) {
  const text = String(value).trim();
  const formatted = text.match(/^(\d{1,3}):([0-5]\d)[,.](\d{2})$/);
  if (formatted) {
    return Number(formatted[1]) * 6000 + Number(formatted[2]) * 100 + Number(formatted[3]);
  }

  // Mobile number keyboards often do not offer a colon. In the compact form,
  // the last two digits before the comma are seconds: 123,45 -> 1:23,45.
  const compact = text.match(/^(\d{1,5})[,.](\d{2})$/);
  if (!compact) return null;
  const digits = compact[1];
  const minutes = digits.length > 2 ? Number(digits.slice(0, -2)) : 0;
  const seconds = Number(digits.length > 2 ? digits.slice(-2) : digits);
  if (seconds > 59) return null;
  return minutes * 6000 + seconds * 100 + Number(compact[2]);
}

function parseReviewTime(value) {
  const match = String(value).trim().match(/^(\d{1,7})[,.](\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number(match[2]);
}

function disciplineLapLabel(disciplineId, lapNumber) {
  return disciplines[disciplineId]?.lapLabels?.[lapNumber - 1] || `Runde ${lapNumber}`;
}

function disciplineLapGroupLabel(disciplineId, laps) {
  const safeLaps = Array.isArray(laps) && laps.length ? laps : [];
  if (!safeLaps.length) return "Runde";
  return safeLaps.map((lap) => disciplineLapLabel(disciplineId, lap)).join(" + ");
}

function resultLapGroups(result) {
  const stored = Array.isArray(result.lap_groups) ? result.lap_groups : [];
  if (stored.length === result.segments.length && stored.every((group) => Array.isArray(group) && group.length)) return stored;
  return result.segments.map((_, index) => [index + 1]);
}

function pdfSafeText(value) {
  return String(value ?? "")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss").replace(/×/g, "x")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function pdfEscapedText(value) {
  return pdfSafeText(value).replace(/([\\()])/g, "\\$1");
}

async function loadEventPdfImage(event) {
  for (const url of eventIconUrls(event)) {
    try {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) continue;
      const blob = await response.blob();
      const image = await new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(blob);
        const element = new Image();
        element.addEventListener("load", () => {
          URL.revokeObjectURL(objectUrl);
          resolve(element);
        }, { once: true });
        element.addEventListener("error", () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("Eventbild konnte nicht gelesen werden."));
        }, { once: true });
        element.src = objectUrl;
      });
      const maximumPixels = 180;
      const scale = Math.min(1, maximumPixels / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const jpegBase64 = canvas.toDataURL("image/jpeg", .9).split(",")[1];
      const binary = atob(jpegBase64);
      let hex = "";
      for (let index = 0; index < binary.length; index += 1) hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
      return { width, height, hex };
    } catch {
      // Try the next supported file extension.
    }
  }
  return null;
}

function createResultsPdf(title, subtitle, headers, rows, eventImage = null) {
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const margin = 28;
  const titleHeight = 42;
  const headerHeight = 26;
  const rowHeight = 23;
  const rowsPerPage = Math.max(1, Math.floor((pageHeight - (margin * 2) - titleHeight - headerHeight) / rowHeight));
  const pageRows = [];
  for (let index = 0; index < rows.length; index += rowsPerPage) pageRows.push(rows.slice(index, index + rowsPerPage));
  if (!pageRows.length) pageRows.push([]);

  const usableWidth = pageWidth - (margin * 2);
  const fontSize = headers.length > 14 ? 6 : 7;
  const cellMain = (value) => typeof value === "object" && value !== null ? value.main : value;
  const approximateTextWidth = (value, size = fontSize) => pdfSafeText(value).length * size * .52;
  const longestPersonWidth = Math.max(
    approximateTextWidth(cellMain(headers[0])),
    ...rows.map((row) => approximateTextWidth(cellMain(row[0]))),
  ) + 8;
  const otherColumnCount = Math.max(1, headers.length - 1);
  const personWidth = Math.min(longestPersonWidth, usableWidth - (otherColumnCount * 22));
  const otherWidth = (usableWidth - personWidth) / otherColumnCount;
  const scaledWidths = headers.map((_, index) => index === 0 ? personWidth : otherWidth);

  const truncate = (value, width, size = fontSize) => {
    const text = pdfSafeText(value);
    const maximum = Math.max(1, Math.floor((width - 6) / (size * .52)));
    return text.length > maximum ? `${text.slice(0, Math.max(1, maximum - 2))}..` : text;
  };
  const textStart = (value, x, width, size, centered) => {
    if (!centered) return x + 3;
    const renderedWidth = Math.min(width - 6, approximateTextWidth(value, size));
    return x + ((width - renderedWidth) / 2);
  };
  const generatedAt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date());
  const pageContents = pageRows.map((pageData, pageIndex) => {
    const commands = [];
    commands.push("0 g 0 G 0.45 w");
    let titleX = margin;
    if (eventImage) {
      const imageScale = Math.min(30 / eventImage.width, 30 / eventImage.height);
      const imageWidth = eventImage.width * imageScale;
      const imageHeight = eventImage.height * imageScale;
      const imageY = pageHeight - margin - 34 + ((30 - imageHeight) / 2);
      commands.push(`q ${imageWidth.toFixed(2)} 0 0 ${imageHeight.toFixed(2)} ${margin} ${imageY.toFixed(2)} cm /Im1 Do Q`);
      titleX += imageWidth + 8;
    }
    commands.push(`BT /F2 13 Tf ${titleX.toFixed(2)} ${pageHeight - margin - 12} Td (${pdfEscapedText(title)}) Tj ET`);
    commands.push(`0.35 g BT /F1 8 Tf ${titleX.toFixed(2)} ${pageHeight - margin - 26} Td (${pdfEscapedText(subtitle)}) Tj ET`);
    const dateWidth = approximateTextWidth(generatedAt, 7);
    commands.push(`0.35 g BT /F1 7 Tf ${(pageWidth - margin - dateWidth).toFixed(2)} ${pageHeight - margin - 12} Td (${pdfEscapedText(generatedAt)}) Tj ET`);
    const footer = `Seite ${pageIndex + 1}/${pageRows.length}`;
    const footerWidth = approximateTextWidth(footer, 7);
    commands.push(`0.35 g BT /F1 7 Tf ${((pageWidth - footerWidth) / 2).toFixed(2)} 14 Td (${footer}) Tj ET`);
    let top = pageHeight - margin - titleHeight;
    let x = margin;
    headers.forEach((header, index) => {
      const width = scaledWidths[index];
      const value = typeof header === "object" && header !== null ? header : { main: header };
      const centered = index > 0;
      const headerMainSize = fontSize;
      const headerSecondarySize = Math.max(4.5, fontSize - 1.5);
      const mainText = truncate(value.main, width, headerMainSize);
      const secondaryText = value.secondary ? truncate(value.secondary, width, headerSecondarySize) : "";
      const mainX = textStart(mainText, x, width, headerMainSize, centered);
      commands.push(`0.93 g ${x.toFixed(2)} ${(top - headerHeight).toFixed(2)} ${width.toFixed(2)} ${headerHeight} re f`);
      commands.push(`0 g 0 G ${x.toFixed(2)} ${(top - headerHeight).toFixed(2)} ${width.toFixed(2)} ${headerHeight} re S`);
      commands.push(`0 g BT /F2 ${headerMainSize} Tf ${mainX.toFixed(2)} ${(top - (secondaryText ? 11 : 16)).toFixed(2)} Td (${pdfEscapedText(mainText)}) Tj ET`);
      if (secondaryText) {
        const secondaryX = textStart(secondaryText, x, width, headerSecondarySize, centered);
        commands.push(`0.35 g BT /F1 ${headerSecondarySize} Tf ${secondaryX.toFixed(2)} ${(top - 20).toFixed(2)} Td (${pdfEscapedText(secondaryText)}) Tj ET`);
      }
      x += width;
    });
    top -= headerHeight;
    pageData.forEach((row) => {
      x = margin;
      for (let index = 0; index < row.length;) {
        const cell = row[index];
        if (typeof cell === "object" && cell?.skip) {
          index += 1;
          continue;
        }
        const value = typeof cell === "object" && cell !== null ? cell : { main: cell };
        const columnSpan = Math.max(1, Math.min(Number(value.colSpan) || 1, row.length - index));
        const width = scaledWidths.slice(index, index + columnSpan).reduce((sum, columnWidth) => sum + columnWidth, 0);
        const hasSecondary = Boolean(value.secondary);
        const centered = index > 0;
        const mainText = truncate(value.main, width);
        const mainX = textStart(mainText, x, width, fontSize, centered);
        commands.push(`0 G ${x.toFixed(2)} ${(top - rowHeight).toFixed(2)} ${width.toFixed(2)} ${rowHeight} re S`);
        commands.push(`0 g BT /${value.bold ? "F2" : "F1"} ${fontSize} Tf ${mainX.toFixed(2)} ${(top - (hasSecondary ? 9.5 : 14.5)).toFixed(2)} Td (${pdfEscapedText(mainText)}) Tj ET`);
        if (hasSecondary) {
          const secondarySize = Math.max(5, fontSize - 1.5);
          const secondaryText = truncate(value.secondary, width, secondarySize);
          const secondaryX = textStart(secondaryText, x, width, secondarySize, centered);
          commands.push(value.tone === "frequency" ? "0.58 0.38 0 rg" : "0.48 g");
          commands.push(`BT /F1 ${secondarySize} Tf ${secondaryX.toFixed(2)} ${(top - 17.5).toFixed(2)} Td (${pdfEscapedText(secondaryText)}) Tj ET`);
          commands.push("0 g");
        }
        x += width;
        index += columnSpan;
      }
      top -= rowHeight;
    });
    return commands.join("\n");
  });

  const fontRegularId = 3 + (pageContents.length * 2);
  const fontBoldId = fontRegularId + 1;
  const imageId = eventImage ? fontBoldId + 1 : null;
  const objects = [];
  const pageIds = pageContents.map((_, index) => 3 + (index * 2));
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  pageContents.forEach((content, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageResources = imageId ? ` /XObject << /Im1 ${imageId} 0 R >>` : "";
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>${imageResources} >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objects[fontRegularId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[fontBoldId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  if (imageId) objects[imageId] = `<< /Type /XObject /Subtype /Image /Width ${eventImage.width} /Height ${eventImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${eventImage.hex.length + 1} >>\nstream\n${eventImage.hex}>\nendstream`;

  let documentText = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = documentText.length;
    documentText += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = documentText.length;
  documentText += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) documentText += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  documentText += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([documentText], { type: "application/pdf" });
}

function openPdf(blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function disciplineOptions(selected = "normal") {
  return Object.entries(disciplines).map(([id, item]) =>
    `<option value="${id}" ${id === selected ? "selected" : ""}>${item.name} · ${item.flexible ? "max. " : ""}${item.laps} Laps</option>`
  ).join("");
}

function setDocumentTitle(title) {
  document.title = title ? `${title} · Lifesaving Timer` : "Lifesaving Timer";
}

function updateViewportLock() {
  const locked = document.body.classList.contains("timer-locked")
    || document.body.classList.contains("review-active")
    || document.body.classList.contains("home-page")
    || document.body.classList.contains("event-page")
    || document.body.classList.contains("people-page")
    || document.body.classList.contains("settings-page")
    || document.body.classList.contains("viewer-page");
  viewportMeta.content = locked
    ? "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
    : defaultViewport;
}

function setTimerInteractionLock(locked) {
  document.body.classList.toggle("timer-locked", locked);
  updateViewportLock();
}

function setReviewInteractionLock(locked) {
  document.body.classList.toggle("review-active", locked);
  updateViewportLock();
}

function renderError(error, back = "#/", backText = "Zurück zur Übersicht") {
  app.innerHTML = `
    <a class="back" href="${back}" data-history-back>${icon("arrow-left")} ${backText}</a>
    <div class="card"><h1>Fehler</h1><p class="lead">${escapeHtml(error.message)}</p>
    <div class="row-actions"><button class="button secondary" id="retry">${icon("refresh")} Erneut versuchen</button>
    ${error?.status === 403 ? `<a class="button" href="${escapeHtml(timerLoginUrl())}">Bei Lifesaving Baden anmelden</a>` : ""}</div></div>`;
  document.querySelector("#retry").addEventListener("click", renderRoute);
}

function lockDialogBackground() {
  cancelAnimationFrame(dialogReleaseFrame);
  clearTimeout(dialogRestoreTimer);
  if (dialogScrollPosition) return;
  const fixedPage = ["home-page", "event-page", "people-page", "timer-page"]
    .some((className) => document.body.classList.contains(className));
  const position = fixedPage ? { x: 0, y: 0 } : { x: window.scrollX, y: window.scrollY };
  if (fixedPage) window.scrollTo(0, 0);
  dialogScrollPosition = position;
  document.body.style.setProperty("--dialog-lock-top", `${-position.y}px`);
  document.body.classList.add("dialog-open");
}

function releaseDialogBackground() {
  cancelAnimationFrame(dialogReleaseFrame);
  dialogReleaseFrame = requestAnimationFrame(() => {
    if (document.querySelector("dialog[open]")) return;
    const position = dialogScrollPosition;
    if (!position) return;
    dialogScrollPosition = null;
    document.body.classList.remove("dialog-open");
    document.body.style.removeProperty("--dialog-lock-top");
    const restorePosition = () => {
      window.scrollTo(position.x, position.y);
      document.documentElement.scrollTop = position.y;
      document.body.scrollTop = position.y;
    };
    let restoreAttempts = 0;
    const restoreAfterKeyboard = () => {
      if (dialogScrollPosition) return;
      restorePosition();
      restoreAttempts += 1;
      if (restoreAttempts < 10) dialogRestoreTimer = setTimeout(restoreAfterKeyboard, 160);
    };
    restoreAfterKeyboard();
  });
}

function showDialog(dialog, { focusField = true } = {}) {
  lockDialogBackground();
  if (focusField) {
    dialog.removeAttribute("autofocus");
    dialog.removeAttribute("tabindex");
  } else {
    dialog.setAttribute("autofocus", "");
    dialog.tabIndex = -1;
  }
  dialog.showModal();
  if (focusField) dialog.querySelector("input, select")?.focus({ preventScroll: true });
  else dialog.focus({ preventScroll: true });
}

function openDialog(id, options = {}) {
  showDialog(document.querySelector(id), options);
}

function bindKeyboardStableEventDialog(dialog) {
  const restoreLockedPosition = () => {
    if (!dialog.open || !dialogScrollPosition) return;
    window.scrollTo(dialogScrollPosition.x, dialogScrollPosition.y);
    document.documentElement.scrollTop = dialogScrollPosition.y;
    document.body.scrollTop = dialogScrollPosition.y;
  };
  dialog.addEventListener("pointerdown", (event) => {
    const input = event.target.closest('input:not([type]), input[type="text"]');
    if (!input || document.activeElement === input) return;
    event.preventDefault();
    input.focus({ preventScroll: true });
    if (typeof input.setSelectionRange === "function") {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
    restoreLockedPosition();
  });
  dialog.addEventListener("focusin", () => {
    restoreLockedPosition();
    setTimeout(restoreLockedPosition, 80);
    setTimeout(restoreLockedPosition, 240);
  });
}

function bindDialogClose(dialog) {
  const close = () => {
    if (dialog.contains(document.activeElement)) document.activeElement.blur();
    dialog.close();
  };
  dialog.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", close));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener("close", releaseDialogBackground);
}

new MutationObserver(() => {
  if (dialogScrollPosition && !document.querySelector("dialog[open]")) releaseDialogBackground();
}).observe(app, { childList: true, subtree: true });

async function renderHome() {
  setDocumentTitle("");
  const [{ events }, authContext] = await Promise.all([
    api("/events"),
    window.timerFirestoreApi.getAuthContext(),
  ]);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  events.sort((left, right) => {
    const dateGroup = (event) => !event.event_date ? 2 : (event.event_date >= today ? 0 : 1);
    const groupOrder = dateGroup(left) - dateGroup(right);
    if (groupOrder) return groupOrder;
    if (left.event_date && right.event_date) {
      const dateOrder = left.event_date >= today
        ? left.event_date.localeCompare(right.event_date)
        : right.event_date.localeCompare(left.event_date);
      if (dateOrder) return dateOrder;
    }
    return String(right.created_at || "").localeCompare(String(left.created_at || ""));
  });
  app.innerHTML = `
    <div class="page-head">
      <h1>Events</h1>
      <button class="button secondary icon-button" id="copy-overview-link" type="button" aria-label="Link zur Eventübersicht kopieren" title="Link zur Eventübersicht kopieren">${icon("link")}</button>
      ${authContext.isOrganizer ? `<button class="button" id="new-event">${icon("plus")} Neues Event</button>` : ""}
    </div>
    <section class="section event-list-section" aria-label="Events">
      ${events.length ? `<div class="stack">${events.map((event) => `
        <a class="card event-row" href="#/event/${event.id}" aria-label="${escapeHtml(event.name)} öffnen">
          <div class="event-row-content">${eventIconMarkup(event, "event-list-icon")}<div class="event-row-copy"><h3>${escapeHtml(event.name)}</h3><div class="event-meta">
            <span class="meta-item">${icon("calendar")} ${escapeHtml(dateText(event.event_date))}</span>
            ${event.location ? `<span class="meta-item">${icon("location")} ${escapeHtml(event.location)}</span>` : ""}
          </div></div></div>
          <span class="event-row-arrow">${icon("arrow-right")}</span>
        </a>`).join("")}</div>` : `<div class="empty">Noch kein Event vorhanden.${authContext.isOrganizer ? " Lege das erste Event an." : ""}</div>`}
    </section>
    <dialog id="event-dialog"><form class="dialog-body" id="event-form">
      <h2>Neues Event</h2>
      <div class="form-grid">
        <div class="field full"><label for="event-name">Eventname</label><input id="event-name" name="name" maxlength="120" required placeholder="z. B. Vereinsmeisterschaft 2026"></div>
        <div class="field event-date-field"><label for="event-date">Datum</label><input id="event-date" name="eventDate" type="date"></div>
        <div class="field"><label for="event-location">Ort</label><input id="event-location" name="location" maxlength="120" placeholder="z. B. Berlin"></div>
      </div>
      <p class="form-error" id="event-error" role="alert"></p>
      <div class="form-actions"><button type="button" class="button secondary" data-close>Abbrechen</button><button class="button">Event anlegen</button></div>
    </form></dialog>`;

  const dialog = document.querySelector("#event-dialog");
  bindDialogClose(dialog);
  bindKeyboardStableEventDialog(dialog);
  document.querySelector("#copy-overview-link").addEventListener("click", async () => {
    const overviewUrl = new URL("#/", window.location.href).href;
    try {
      await navigator.clipboard.writeText(overviewUrl);
      showToast("Link zur Eventübersicht wurde kopiert.");
    } catch {
      window.prompt("Link zur Eventübersicht kopieren:", overviewUrl);
    }
  });
  document.querySelector("#new-event")?.addEventListener("click", () => openDialog("#event-dialog", { focusField: false }));
  document.querySelector("#event-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.submitter;
    const error = document.querySelector("#event-error");
    try {
      submit.disabled = true;
      error.textContent = "";
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const created = await api("/events", { method: "POST", body: JSON.stringify(values) });
      dialog.close();
      history.pushState(null, "", `#/event/${created.id}`);
      location.hash = `#/settings/${created.id}`;
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false;
    }
  });
}

async function renderEvent(id) {
  const { event, participants } = await api(`/events/${id}`);
  setDocumentTitle(event.name);
  app.innerHTML = `
    <div class="page-head event-page-head"><div><div class="event-title-row">${eventIconMarkup(event, "event-title-icon")}<h1>${escapeHtml(event.name)}</h1><button class="button secondary icon-button" id="copy-event-link" type="button" aria-label="Event-Link kopieren" title="Event-Link kopieren">${icon("link")}</button>${eventCan(event, "can_manage_event") ? `<a class="button secondary icon-button" href="#/settings/${id}" aria-label="Event-Einstellungen" title="Event-Einstellungen">${icon("settings")}</a>` : ""}</div>
      <p class="event-summary">${escapeHtml(dateText(event.event_date))} · ${event.location ? escapeHtml(event.location) : "Kein Ort"} · ${eventCan(event, "can_view_participants") || eventCan(event, "can_use_timer") ? `${participants.length} Personen` : "Personen geschützt"}</p></div>
    </div>
    <div class="event-action-grid ${!eventCan(event, "can_view_participants") ? "people-hidden" : ""}">
      ${eventCan(event, "can_use_timer")
        ? `<a class="card event-action-tile" href="#/timer/${id}"><span class="event-action-icon">${icon("timer")}</span><strong>Timer</strong></a>`
        : `<div class="card event-action-tile disabled" aria-disabled="true"><span class="event-action-icon">${icon("timer")}</span><strong>Timer</strong><small>Kein Zugriff</small></div>`}
      ${!eventCan(event, "can_view_results")
        ? `<div class="card event-action-tile disabled" aria-disabled="true"><span class="event-action-icon">${icon("table")}</span><strong>Ergebnisse</strong></div>`
        : `<a class="card event-action-tile" href="#/viewer/${id}"><span class="event-action-icon">${icon("table")}</span><strong>Ergebnisse</strong></a>`}
      ${!eventCan(event, "can_view_participants") ? "" : `<a class="card event-action-tile" href="#/people/${id}"><span class="event-action-icon">${icon("users")}</span><strong>Personen</strong></a>`}
    </div>`;
  document.querySelector("#copy-event-link").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Event-Link wurde kopiert.");
    } catch {
      window.prompt("Event-Link kopieren:", window.location.href);
    }
  });
}

async function renderEventSettings(id, section = null) {
  const { event } = await api(`/events/${id}`);
  if (!eventCan(event, "can_manage_event")) throw new Error("Diese Einstellungen sind nur für Organisatoren verfügbar.");
  const validSections = new Set(["event", "timer", "results", "access"]);
  const activeSection = validSections.has(section) ? section : null;
  const enabledDisciplineIds = enabledDisciplinesForEvent(event);
  const enabledDisciplines = new Set(enabledDisciplineIds);
  const poolLength = ['25', '50', 'custom'].includes(event.pool_length) ? event.pool_length : "25";
  const sectionNames = { event: "Event", timer: "Timer", results: "Ergebnisse", access: "Zugriffsrechte" };
  setDocumentTitle(`${activeSection ? `${sectionNames[activeSection]} – ` : ""}Einstellungen – ${event.name}`);
  const sectionName = sectionNames[activeSection] || "Event-Einstellungen";
  const disciplineFields = disciplineGroups.map((group) => {
    const entries = Object.entries(disciplines).filter(([, item]) => item.group === group.id);
    return `<fieldset class="settings-section discipline-settings"><legend>${escapeHtml(group.name)}</legend><div class="discipline-settings-list">${entries.map(([disciplineId, item]) => `
      <label class="settings-check"><input type="checkbox" name="enabledDisciplines" value="${disciplineId}" ${enabledDisciplines.has(disciplineId) ? "checked" : ""}><span>${escapeHtml(item.name)}</span></label>`).join("")}</div></fieldset>`;
  }).join("");
  const eventMarkup = `
      <fieldset class="settings-section"><legend>Event</legend><div class="form-grid">
        <div class="field full"><label for="settings-event-name">Name</label><input id="settings-event-name" name="name" maxlength="120" required value="${escapeHtml(event.name)}"></div>
        <div class="field event-date-field"><label for="settings-event-date">Datum</label><input id="settings-event-date" name="eventDate" type="date" value="${escapeHtml(event.event_date || "")}"></div>
        <div class="field"><label for="settings-event-location">Ort</label><input id="settings-event-location" name="location" maxlength="120" value="${escapeHtml(event.location || "")}"></div>
      </div><div class="event-pool-settings"><span class="field-label">Bahnlänge</span><div class="settings-choice-grid three">
        <label><input type="radio" name="poolLength" value="25" ${poolLength === "25" ? "checked" : ""}><span>25 m</span></label>
        <label><input type="radio" name="poolLength" value="50" ${poolLength === "50" ? "checked" : ""}><span>50 m</span></label>
        <label><input type="radio" name="poolLength" value="custom" ${poolLength === "custom" ? "checked" : ""}><span>Eigene</span></label>
      </div><label class="field custom-pool-length" ${poolLength === "custom" ? "" : "hidden"}><span>Bahnlänge in Metern</span><input id="custom-pool-length" name="customPoolLength" type="number" min="1" max="10000" step="0.01" inputmode="decimal" value="${event.custom_pool_length ?? ""}"></label></div></fieldset>`;
  const sectionMarkup = activeSection === "event" ? eventMarkup
    : activeSection === "timer" ? `<div class="settings-disciplines"><h2>Disziplinen</h2>${disciplineFields}</div>`
    : activeSection === "results" ? `<fieldset class="settings-section"><legend>Ergebnis-URL</legend><div class="result-url-heading"><span>Link</span><a class="result-source-link" href="https://competition.dlrg.net/de/competitions" target="_blank" rel="noopener noreferrer" aria-label="DLRG Competition öffnen" title="DLRG Competition öffnen">${icon("link")}</a></div><label class="field"><input name="resultUrl" type="url" inputmode="url" maxlength="500" placeholder="https://…" value="${escapeHtml(event.result_url || "")}"></label></fieldset>`
    : `<div class="access-settings-intro"><p>Der Admin hat immer Zugriff. Organisatoren können die Einstellungen bearbeiten, erhalten aber keinen automatischen Zugriff auf gesperrte Bereiche.</p></div>
      <fieldset class="settings-section"><legend>Timer verwenden</legend>${accessSelect("timerAccess", event.timer_access)}</fieldset>
      <fieldset class="settings-section"><legend>Ergebnisse ansehen</legend>${accessSelect("resultsAccess", event.results_access)}</fieldset>
      <fieldset class="settings-section"><legend>Ergebnisse korrigieren und löschen</legend>${accessSelect("resultEditAccess", event.result_edit_access)}</fieldset>
      <fieldset class="settings-section"><legend>Personen ansehen</legend>${accessSelect("participantViewAccess", event.participant_view_access)}</fieldset>
      <fieldset class="settings-section"><legend>Personen hinzufügen und bearbeiten</legend>${accessSelect("participantEditAccess", event.participant_edit_access)}</fieldset>`;

  if (!activeSection) {
    const settingsItems = [
      { id: "event", icon: "calendar", name: "Event", detail: `${dateText(event.event_date)} · ${event.location ? event.location : "Kein Ort"}` },
      { id: "timer", icon: "timer", name: "Timer", detail: accessLabel(event.timer_access) },
      { id: "results", icon: "table", name: "Ergebnisse", detail: event.result_url ? "Ergebnis-Link hinterlegt" : "Kein Ergebnis-Link" },
      { id: "access", icon: "eye", name: "Zugriffsrechte", detail: `Timer: ${accessLabel(event.timer_access)}` },
    ];
    app.innerHTML = `
      <div class="page-head settings-page-head"><h1>Event-Einstellungen</h1></div>
      <div class="event-settings-form settings-overview-event">
        <nav class="settings-overview" aria-label="Weitere Einstellungsbereiche">${settingsItems.map((item) => `<a class="settings-overview-item" href="#/settings/${id}/${item.id}"><span class="settings-overview-symbol">${icon(item.icon)}</span><span><strong>${item.name}</strong><small>${escapeHtml(item.detail)}</small></span>${icon("arrow-right")}</a>`).join("")}</nav>
        <p class="form-error" id="event-settings-error" role="alert"></p>
        <div class="event-settings-actions settings-overview-actions"><a class="button secondary" href="#/event/${id}" data-history-back>Abbrechen</a><button type="button" class="button danger event-settings-delete" id="delete-event-settings">${icon("trash")} Event löschen</button></div>
      </div>`;
  } else {
    app.innerHTML = `
      <div class="page-head settings-page-head"><h1>${sectionName}</h1></div>
      <form id="event-settings-form" class="event-settings-form">
        ${sectionMarkup}
        <p class="form-error" id="event-settings-error" role="alert"></p>
        <div class="event-settings-actions"><a class="button secondary" href="#/settings/${id}" data-history-back>Abbrechen</a><button class="button" type="submit">Speichern</button></div>
      </form>`;
  }

  const form = document.querySelector("#event-settings-form");
  if (activeSection === "event") {
    const customPoolField = form.querySelector(".custom-pool-length");
    const customPoolInput = form.querySelector("#custom-pool-length");
    form.querySelectorAll('[name="poolLength"]').forEach((input) => input.addEventListener("change", () => {
      const custom = form.elements.poolLength.value === "custom";
      customPoolField.hidden = !custom;
      customPoolInput.required = custom;
    }));
    customPoolInput.required = poolLength === "custom";
  }
  form?.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const submitButton = submitEvent.submitter;
    const error = document.querySelector("#event-settings-error");
    const data = new FormData(form);
    const payload = {
      name: event.name,
      eventDate: event.event_date || "",
      location: event.location || "",
      poolLength,
      customPoolLength: event.custom_pool_length ?? "",
      enabledDisciplines: enabledDisciplineIds,
      resultUrl: event.result_url || "",
      timerAccess: event.timer_access,
      resultsAccess: event.results_access,
      participantViewAccess: event.participant_view_access,
      participantEditAccess: event.participant_edit_access,
      resultEditAccess: event.result_edit_access,
    };
    if (activeSection === "event") Object.assign(payload, { name: data.get("name"), eventDate: data.get("eventDate"), location: data.get("location"), poolLength: data.get("poolLength"), customPoolLength: data.get("customPoolLength") });
    else if (activeSection === "timer") Object.assign(payload, { enabledDisciplines: data.getAll("enabledDisciplines") });
    else if (activeSection === "results") Object.assign(payload, { resultUrl: data.get("resultUrl") });
    else Object.assign(payload, {
      timerAccess: data.get("timerAccess"),
      resultsAccess: data.get("resultsAccess"),
      participantViewAccess: data.get("participantViewAccess"),
      participantEditAccess: data.get("participantEditAccess"),
      resultEditAccess: data.get("resultEditAccess"),
    });
    try {
      submitButton.disabled = true;
      error.textContent = "";
      await api(`/events/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      syncPendingResults({ includeBlocked: true }).catch(() => {});
      if (activeSection && history.length > 2) history.go(-2);
      else if (activeSection) location.hash = `#/event/${id}`;
      else if (history.length > 1) history.back();
      else location.hash = `#/event/${id}`;
    } catch (err) {
      error.textContent = err.message;
      submitButton.disabled = false;
    }
  });
  document.querySelector("#delete-event-settings")?.addEventListener("click", async (deleteEvent) => {
    if (!confirm(`Event „${event.name}“ mit allen Personen und Ergebnissen unwiderruflich löschen?`)) return;
    try {
      deleteEvent.currentTarget.disabled = true;
      await api(`/events/${id}`, { method: "DELETE" });
      location.hash = "#/";
    } catch (err) {
      document.querySelector("#event-settings-error").textContent = err.message;
      deleteEvent.currentTarget.disabled = false;
    }
  });
}

async function renderPeople(id) {
  const { event, participants } = await api(`/events/${id}`);
  if (!eventCan(event, "can_view_participants")) {
    setDocumentTitle(`Personen – ${event.name}`);
    app.innerHTML = `<a class="back" href="#/event/${id}" data-history-back>${icon("arrow-left")} ${escapeHtml(event.name)}</a><div class="empty"><strong>Kein Zugriff auf Personen</strong><p>Die Event-Einstellungen erlauben diese Ansicht für dein Konto nicht.</p></div>`;
    return;
  }
  const canEditPeople = eventCan(event, "can_edit_participants");
  participants.sort(compareParticipantsByOrganization);
  const personCardContent = (person) => `<div class="person-card-content">${personAvatar(person)}<div class="person-card-copy"><div class="person-head"><strong>${escapeHtml(person.name)} (${birthYearText(person.birth_year)})</strong></div>
    <div class="person-details"><span>${escapeHtml(person.organization)} - ${escapeHtml(person.age_group)} - ${person.gender === "male" ? "m" : "w"}</span></div></div></div>`;
  const personCardMarkup = (person) => canEditPeople ? `<button class="person-card person-card-button edit-person" type="button" data-id="${person.id}" aria-label="${escapeHtml(person.name)} bearbeiten">
    ${personCardContent(person)}</button>` : `<div class="person-card">${personCardContent(person)}</div>`;
  const peopleByAgeGroup = [...participants.reduce((groups, person) => {
    const ageGroup = person.age_group || "Ohne Altersklasse";
    if (!groups.has(ageGroup)) groups.set(ageGroup, []);
    groups.get(ageGroup).push(person);
    return groups;
  }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right, "de", { numeric: true, sensitivity: "base" }));
  setDocumentTitle(`Personen – ${event.name}`);
  app.innerHTML = `
    <a class="back" href="#/event/${id}" data-history-back>${icon("arrow-left")} ${escapeHtml(event.name)}</a>
    <div class="page-head people-page-head"><h1>Personen</h1><div class="people-page-actions">
      ${canEditPeople ? `<button class="button secondary" id="new-person">${icon("user-plus")} Neu</button>` : ""}
      ${eventCan(event, "can_import_participants") ? `<button class="button secondary" id="import-person">${icon("import")} Importieren</button>` : ""}
    </div></div>
    <section class="people-list-section" aria-label="Personenliste">
      ${participants.length ? `<div class="person-groups">${peopleByAgeGroup.map(([ageGroup, people], groupIndex) => `<section class="person-age-group" aria-labelledby="age-group-${groupIndex}"><h2 id="age-group-${groupIndex}">${escapeHtml(ageGroup)}</h2><div class="person-list">${people.map(personCardMarkup).join("")}</div></section>`).join("")}</div>` : `<div class="empty">Noch keine Personen.</div>`}
    </section>
    <dialog id="person-dialog"><form class="dialog-body" id="person-form">
      <h2 id="person-dialog-title">Person hinzufügen</h2><div class="form-grid">
        <div class="field full"><label for="person-name">Name</label><input id="person-name" name="name" maxlength="120" autocomplete="name" required></div>
        <div class="field"><label for="birth-year">Jahrgang (JJ)</label><input id="birth-year" name="birthYear" type="number" min="0" max="99" inputmode="numeric" placeholder="08" required></div>
        <div class="field"><label for="age-group">Altersklasse</label><input id="age-group" name="ageGroup" maxlength="40" required placeholder="z. B. AK 15/16"></div>
        <div class="field"><label for="gender">Geschlecht</label><select id="gender" name="gender" required><option value="female">Weiblich</option><option value="male">Männlich</option></select></div>
        <div class="field"><label for="organization">Gliederung</label><input id="organization" name="organization" maxlength="120" required placeholder="Verein / Ortsgruppe"></div>
      </div><p class="form-error" id="person-error" role="alert"></p>
      <div class="form-actions"><button type="button" class="button secondary" data-close>Abbrechen</button><button class="button">Person speichern</button></div>
      <div class="dialog-delete-row"><button type="button" class="button danger small" id="delete-person-dialog" hidden>${icon("trash")} Person löschen</button></div>
    </form></dialog>
    <dialog id="person-import-dialog" class="participant-import-dialog"><div class="dialog-body participant-import-body">
      <div class="dialog-title-row"><h2>Person importieren</h2><button type="button" class="button secondary icon-button" data-close aria-label="Schließen">${icon("x")}</button></div>
      <div class="participant-search-control">
        <label class="sr-only" for="import-person-search">Person suchen</label>
        <input id="import-person-search" type="search" inputmode="search" autocomplete="off" placeholder="Name suchen …" ${event.event_date ? "" : "disabled"}>
        <button type="button" class="participant-search-clear" id="clear-import-search" aria-label="Suche löschen" hidden>${icon("x")}</button>
      </div>
      <p class="import-search-note" id="import-search-note">${event.event_date ? "Mindestens 3 Buchstaben eingeben." : "Für den Import zuerst beim Event ein Datum eintragen."}</p>
      <div class="participant-picker-list participant-import-list" id="person-import-results" aria-live="polite"></div>
    </div></dialog>`;

  const dialog = document.querySelector("#person-dialog");
  const personForm = document.querySelector("#person-form");
  const personDialogTitle = document.querySelector("#person-dialog-title");
  const deletePersonButton = document.querySelector("#delete-person-dialog");
  const importDialog = document.querySelector("#person-import-dialog");
  const importSearch = document.querySelector("#import-person-search");
  const clearImportSearch = document.querySelector("#clear-import-search");
  const importSearchNote = document.querySelector("#import-search-note");
  const importResults = document.querySelector("#person-import-results");
  let importSearchTimer = null;
  let importRequest = 0;
  bindDialogClose(dialog);
  bindDialogClose(importDialog);
  document.querySelector("#new-person")?.addEventListener("click", () => {
    personForm.reset();
    personForm.dataset.editId = "";
    personDialogTitle.textContent = "Person hinzufügen";
    deletePersonButton.hidden = true;
    document.querySelector("#person-error").textContent = "";
    openDialog("#person-dialog");
  });
  document.querySelector("#import-person")?.addEventListener("click", () => {
    clearTimeout(importSearchTimer);
    importRequest += 1;
    importSearch.value = "";
    clearImportSearch.hidden = true;
    importResults.innerHTML = "";
    importSearchNote.textContent = event.event_date
      ? "Mindestens 3 Buchstaben eingeben."
      : "Für den Import zuerst beim Event ein Datum eintragen.";
    openDialog("#person-import-dialog", { focusField: false });
  });
  const loadImportCandidates = async () => {
    const searchValue = importSearch.value.trim();
    const searchLength = normalizedIdentity(searchValue).length;
    clearImportSearch.hidden = !searchValue;
    importRequest += 1;
    const requestId = importRequest;
    if (searchLength < 3) {
      importSearchNote.textContent = "Mindestens 3 Buchstaben eingeben.";
      importResults.innerHTML = "";
      return;
    }
    importSearchNote.textContent = "Suche …";
    importResults.innerHTML = "";
    try {
      const { candidates, directoryReady } = await api(`/events/${id}/participants/import?q=${encodeURIComponent(searchValue)}`);
      if (requestId !== importRequest) return;
      importSearchNote.textContent = candidates.length
        ? `${candidates.length} Treffer`
        : (directoryReady ? "Keine Person gefunden." : "Die geschützte Importliste ist noch nicht eingerichtet.");
      importResults.innerHTML = candidates.map((candidate) => `<button type="button" class="participant-picker-option import-person-option" data-id="${candidate.id}" ${candidate.alreadyImported ? "disabled" : ""}>
        <span class="participant-picker-main">${personAvatar({ name: candidate.name, gender: candidate.gender, organization: candidate.organization })}<span class="participant-picker-copy">
          <strong>${escapeHtml(candidate.name)} (${birthYearText(candidate.birthYear)})</strong>
          <small>${escapeHtml(candidate.organization)} · ${escapeHtml(candidate.ageGroup)} · ${candidate.gender === "female" ? "w" : "m"}${candidate.alreadyImported ? " · Bereits vorhanden" : ""}</small>
        </span></span>${candidate.alreadyImported ? icon("check") : icon("import")}
      </button>`).join("");
    } catch (err) {
      if (requestId !== importRequest) return;
      importSearchNote.textContent = err.message;
    }
  };
  importSearch.addEventListener("input", () => {
    clearTimeout(importSearchTimer);
    clearImportSearch.hidden = !importSearch.value;
    importSearchTimer = setTimeout(loadImportCandidates, 220);
  });
  clearImportSearch.addEventListener("click", () => {
    clearTimeout(importSearchTimer);
    importRequest += 1;
    importSearch.value = "";
    clearImportSearch.hidden = true;
    importSearchNote.textContent = "Mindestens 3 Buchstaben eingeben.";
    importResults.innerHTML = "";
    importSearch.focus();
  });
  importResults.addEventListener("click", async (clickEvent) => {
    const button = clickEvent.target.closest(".import-person-option");
    if (!button || button.disabled) return;
    try {
      button.disabled = true;
      await api(`/events/${id}/participants/import`, { method: "POST", body: JSON.stringify({ candidateId: button.dataset.id }) });
      showToast("Person wurde importiert.");
      await renderPeople(id);
    } catch (err) {
      button.disabled = false;
      importSearchNote.textContent = err.message;
    }
  });
  document.querySelectorAll(".edit-person").forEach((button) => button.addEventListener("click", () => {
    const person = participants.find((item) => item.id === button.dataset.id);
    if (!person) return;
    personForm.dataset.editId = person.id;
    personDialogTitle.textContent = "Person bearbeiten";
    deletePersonButton.hidden = false;
    personForm.elements.name.value = person.name;
    personForm.elements.birthYear.value = person.birth_year;
    personForm.elements.ageGroup.value = person.age_group;
    personForm.elements.gender.value = person.gender;
    personForm.elements.organization.value = person.organization;
    document.querySelector("#person-error").textContent = "";
    openDialog("#person-dialog", { focusField: false });
  }));
  personForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const button = submitEvent.submitter;
    try {
      button.disabled = true;
      const values = Object.fromEntries(new FormData(submitEvent.currentTarget));
      const editId = submitEvent.currentTarget.dataset.editId;
      await api(`/events/${id}/participants${editId ? `/${editId}` : ""}`, { method: editId ? "PATCH" : "POST", body: JSON.stringify(values) });
      showToast(editId ? "Person wurde aktualisiert." : "Person wurde hinzugefügt.");
      await renderPeople(id);
    } catch (err) {
      document.querySelector("#person-error").textContent = err.message;
      button.disabled = false;
    }
  });
  deletePersonButton.addEventListener("click", async () => {
    const person = participants.find((item) => item.id === personForm.dataset.editId);
    if (!person) return;
    const warning = Number(person.result_count) > 0 ? " Dabei werden auch alle Ergebnisse dieser Person gelöscht." : "";
    if (!confirm(`${person.name} wirklich löschen?${warning}`)) return;
    try {
      deletePersonButton.disabled = true;
      await api(`/events/${id}/participants/${person.id}`, { method: "DELETE" });
      showToast("Person wurde gelöscht.");
      await renderPeople(id);
    } catch (err) { showToast(err.message); deletePersonButton.disabled = false; }
  });
}

async function renderTimer(id) {
  const [{ event, participants }, authContext] = await Promise.all([
    api(`/events/${id}`),
    window.timerFirestoreApi.getAuthContext(),
  ]);
  currentTimerAuth = authContext;
  if (!eventCan(event, "can_use_timer")) {
    setDocumentTitle(`Kein Timer-Zugriff – ${event.name}`);
    app.innerHTML = `<div class="timer-shell"><div class="timer-topbar"><a class="button secondary icon-button" href="#/event/${id}" data-history-back aria-label="Eine Ansicht zurück">${icon("arrow-left")}</a></div><div class="card timer-disabled"><h1>Kein Zugriff</h1><p>Die Zugriffsrechte dieses Events erlauben die Zeitnahme für dein Konto nicht.</p></div></div>`;
    setTimerInteractionLock(true);
    return;
  }
  participants.sort(compareParticipantsByOrganization);
  const enabledDisciplineIds = enabledDisciplinesForEvent(event);
  const initialDiscipline = enabledDisciplineIds[0] || "normal";
  setDocumentTitle(`Timer – ${event.name}`);
  const timer = {
    status: "idle",
    startedAt: 0,
    displayed: 0,
    segments: [],
    frequencies: [],
    lapGroups: [],
    frequencyStartedAt: null,
    frequencyTaps: 0,
    officialTime: null,
    note: "",
    discipline: initialDiscipline,
  };

  app.innerHTML = `
    <div class="timer-shell">
      <div id="timer-view">
      <div class="timer-topbar">
        <a class="button secondary icon-button" href="#/event/${id}" data-history-back aria-label="Eine Ansicht zurück">${icon("arrow-left")}</a>
        <button class="mode-button" id="mode-button" aria-haspopup="dialog"><span><strong id="mode-name">${escapeHtml(disciplines[initialDiscipline].name)}</strong><small id="mode-laps">${disciplines[initialDiscipline].flexible ? "max. " : ""}${disciplines[initialDiscipline].laps} Laps</small></span>${icon("chevron-down")}</button>
      </div>
      <section class="card clock-card" aria-label="Stoppuhr">
        <div class="clock-status" id="clock-status">Bereit</div><div class="clock" id="clock" aria-live="off">0:00,00</div>
        <div class="frequency-progress" id="frequency-progress" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        <p class="progress-note" id="progress">0 / ${disciplines[initialDiscipline].laps} Laps</p>
        <div class="timer-actions">
          <button class="button secondary timer-control" id="left-action" disabled>${icon("trash")} Löschen</button>
          <button class="button timer-control" id="right-action">${icon("play")} Start</button>
        </div>
      </section>
      <div class="card lap-list" id="lap-list" hidden></div>
      <dialog id="discipline-dialog"><div class="dialog-body mode-dialog-body"><div class="mode-dialog-header"><button class="button secondary icon-button" id="mode-back" type="button" aria-label="Zurück zu den Kategorien" hidden>${icon("arrow-left")}</button><h2 id="mode-dialog-title">Stoppmodus</h2><button class="button secondary icon-button" id="close-mode" aria-label="Menü schließen">${icon("x")}</button></div>
        <div class="discipline-list" id="mode-category-list"></div>
        <div class="discipline-list" id="mode-discipline-list" hidden></div>
      </div></dialog>
      </div>
      <section class="review-view" id="review-view" hidden></section>
    </div>`;

  const elements = Object.fromEntries(["timer-view", "review-view", "mode-button", "mode-name", "mode-laps", "discipline-dialog", "clock-status", "clock", "frequency-progress", "left-action", "right-action", "progress", "lap-list"].map((key) => [key, document.querySelector(`#${key}`)]));
  let frequencyFeedbackTimer = null;

  const currentCs = () => timer.status === "running" ? timer.displayed + Math.floor((performance.now() - timer.startedAt) / 10) : timer.displayed;
  const capturedTotal = () => timer.segments.reduce((sum, value) => sum + value, 0);
  const config = () => disciplines[timer.discipline];
  const modeTitle = document.querySelector("#mode-dialog-title");
  const modeBack = document.querySelector("#mode-back");
  const modeCategoryList = document.querySelector("#mode-category-list");
  const modeDisciplineList = document.querySelector("#mode-discipline-list");

  function availableModeGroups() {
    return disciplineGroups.filter((group) => enabledDisciplineIds.some((disciplineId) => disciplines[disciplineId].group === group.id));
  }

  function renderModeCategories() {
    const selectedGroup = config().group;
    modeTitle.textContent = "Stoppmodus";
    modeBack.hidden = true;
    modeCategoryList.hidden = false;
    modeDisciplineList.hidden = true;
    modeCategoryList.innerHTML = availableModeGroups().map((group) => {
      const groupDisciplines = enabledDisciplineIds.map((disciplineId) => disciplines[disciplineId]).filter((item) => item.group === group.id);
      const selected = selectedGroup === group.id;
      const isNormal = group.id === "normal";
      const detail = isNormal ? "max. 20 Laps" : `${groupDisciplines.length} Disziplinen`;
      const action = isNormal ? `data-discipline="${enabledDisciplineIds.find((disciplineId) => disciplines[disciplineId].group === "normal")}"` : `data-mode-group="${group.id}"`;
      const trailingIcon = selected ? icon("check") : (isNormal ? "" : icon("arrow-right"));
      return `<button class="discipline-choice mode-category ${selected ? "selected" : ""}" type="button" ${action}><span><strong>${group.name}</strong><small>${detail}</small></span><span class="choice-check">${trailingIcon}</span></button>`;
    }).join("");
  }

  function renderModeGroup(groupId, { allowBack = true } = {}) {
    const group = disciplineGroups.find((item) => item.id === groupId);
    if (!group) return;
    modeTitle.textContent = group.name;
    modeBack.hidden = !allowBack;
    modeCategoryList.hidden = true;
    modeDisciplineList.hidden = false;
    modeDisciplineList.innerHTML = Object.entries(disciplines)
      .filter(([disciplineId, item]) => item.group === groupId && enabledDisciplineIds.includes(disciplineId))
      .map(([disciplineId, item]) => {
        const selected = disciplineId === timer.discipline;
        return `<button class="discipline-choice ${selected ? "selected" : ""}" type="button" data-discipline="${disciplineId}"><span><strong>${item.name}</strong><small>${item.flexible ? "max. " : ""}${item.laps} Laps</small></span><span class="choice-check">${selected ? icon("check") : ""}</span></button>`;
      }).join("");
  }

  function drawClock() {
    const total = currentCs();
    elements.clock.textContent = formatTime(total);
    const liveLap = document.querySelector("#live-lap-time");
    if (liveLap) liveLap.textContent = formatTime(total - capturedTotal());
    updateFrequencyProgress();
    if (timer.status === "running") animationFrame = requestAnimationFrame(drawClock);
  }

  function resetFrequencyCapture() {
    clearTimeout(frequencyFeedbackTimer);
    frequencyFeedbackTimer = null;
    timer.frequencyStartedAt = null;
    timer.frequencyTaps = 0;
    elements["frequency-progress"].classList.remove("active");
    elements["frequency-progress"].querySelectorAll("span").forEach((step) => step.classList.remove("filled"));
  }

  function showFrequencySteps(filledSteps) {
    elements["frequency-progress"].classList.toggle("active", filledSteps > 0);
    elements["frequency-progress"].querySelectorAll("span").forEach((step, index) => {
      step.classList.toggle("filled", index < filledSteps);
    });
  }

  function finishFrequency(endedAt = performance.now(), showCompletedSteps = false) {
    if (timer.frequencyStartedAt === null) return;
    const elapsedMs = Math.max(1, endedAt - timer.frequencyStartedAt);
    timer.frequencies[timer.segments.length] = Math.round((timer.frequencyTaps * 60_000) / elapsedMs);
    timer.frequencyStartedAt = null;
    timer.frequencyTaps = 0;
    if (!showCompletedSteps) {
      showFrequencySteps(0);
      return;
    }
    showFrequencySteps(5);
    clearTimeout(frequencyFeedbackTimer);
    frequencyFeedbackTimer = setTimeout(() => {
      frequencyFeedbackTimer = null;
      if (timer.frequencyStartedAt === null) showFrequencySteps(0);
    }, 300);
  }

  function updateFrequencyProgress() {
    if (timer.frequencyStartedAt === null) return;
    showFrequencySteps(timer.frequencyTaps);
  }

  function tapFrequency() {
    if (timer.status !== "running" || timer.frequencies[timer.segments.length] !== undefined) return;
    const now = performance.now();
    if (timer.frequencyStartedAt === null) {
      timer.frequencyStartedAt = now;
      timer.frequencyTaps = 1;
    } else {
      timer.frequencyTaps += 1;
    }
    updateFrequencyProgress();
    if (timer.frequencyTaps >= 5) {
      finishFrequency(now, true);
      renderLaps();
    }
  }

  function lapValues(time, index, isCurrent = false, isPlaceholder = false) {
    const frequency = timer.frequencies[index];
    return `<span class="lap-values"><strong ${isCurrent ? 'id="live-lap-time"' : (isPlaceholder ? 'class="lap-placeholder"' : "")}>${time}</strong>${Number.isInteger(frequency) ? `<small>${frequency}/min</small>` : ""}</span>`;
  }

  function renderLaps() {
    const item = config();
    const hasLiveLap = timer.status === "running";

    if (!item.flexible) {
      elements["lap-list"].hidden = false;
      elements["lap-list"].innerHTML = Array.from({ length: item.laps }, (_, index) => {
        const value = timer.segments[index];
        const isCurrent = hasLiveLap && index === timer.segments.length;
        const time = value !== undefined
          ? formatTime(value)
          : (isCurrent ? formatTime(currentCs() - capturedTotal()) : "–");
        return `<div class="lap-row ${isCurrent ? "current" : ""}"><span>${escapeHtml(disciplineLapLabel(timer.discipline, index + 1))}</span>${lapValues(time, index, isCurrent, value === undefined && !isCurrent)}</div>`;
      }).join("");
      return;
    }

    elements["lap-list"].hidden = timer.segments.length === 0 && !hasLiveLap;
    const liveRow = hasLiveLap ? `<div class="lap-row current"><span>${escapeHtml(disciplineLapLabel(timer.discipline, timer.segments.length + 1))}</span>${lapValues(formatTime(currentCs() - capturedTotal()), timer.segments.length, true)}</div>` : "";
    const completedRows = timer.segments.map((value, index) => ({ value, index })).reverse().map(({ value, index }) => {
      return `<div class="lap-row"><span>${escapeHtml(disciplineLapLabel(timer.discipline, index + 1))}</span>${lapValues(formatTime(value), index)}</div>`;
    }).join("");
    elements["lap-list"].innerHTML = liveRow + completedRows;
  }

  function updateProgress() {
    const item = config();
    elements.progress.textContent = `${timer.segments.length} / ${item.flexible ? "max. " : ""}${item.laps} Laps`;
  }

  function updateMode() {
    const item = config();
    elements["mode-name"].textContent = item.name;
    elements["mode-laps"].textContent = `${item.flexible ? "max. " : ""}${item.laps} Laps`;
    renderLaps();
    updateProgress();
  }

  function setControl(button, label, iconName, style, disabled = false) {
    button.className = `button timer-control ${style}`.trim();
    button.textContent = label;
    button.disabled = disabled;
  }

  function updateControls() {
    const item = config();
    const actions = elements["left-action"].parentElement;
    elements["left-action"].hidden = false;
    actions.classList.remove("final-lap");
    if (timer.status === "idle") {
      setControl(elements["left-action"], "Löschen", "trash", "secondary", true);
      setControl(elements["right-action"], "Start", "play", "", false);
      return;
    }
    if (timer.status === "running") {
      const lapLimitReached = timer.segments.length >= item.laps - 1;
      setControl(elements["left-action"], "Runde", "lap", "secondary", lapLimitReached);
      setControl(elements["right-action"], "Stopp", "stop", "danger", false);
      if (lapLimitReached) {
        elements["left-action"].hidden = true;
        actions.classList.add("final-lap");
      }
      return;
    }
    setControl(elements["left-action"], "Löschen", "trash", "danger", false);
    setControl(elements["right-action"], "Weiter", "play", "", false);
  }

  function resetTimer() {
    cancelAnimationFrame(animationFrame);
    Object.assign(timer, { status: "idle", startedAt: 0, displayed: 0, segments: [], frequencies: [], lapGroups: [], officialTime: null, note: "" });
    resetFrequencyCapture();
    elements.clock.textContent = "0:00,00";
    elements["clock-status"].textContent = "Bereit";
    elements["mode-button"].disabled = false;
    elements["timer-view"].hidden = false;
    elements["review-view"].hidden = true;
    elements["review-view"].innerHTML = "";
    setReviewInteractionLock(false);
    setTimerInteractionLock(true);
    setDocumentTitle(`Timer – ${event.name}`);
    renderLaps(); updateProgress(); updateControls();
  }

  function addSegment() {
    if (timer.status !== "running" || timer.segments.length >= config().laps - 1) return false;
    const total = currentCs();
    const segment = total - capturedTotal();
    if (segment <= 0) return false;
    finishFrequency();
    if (timer.frequencies[timer.segments.length] === undefined) timer.frequencies[timer.segments.length] = null;
    timer.segments.push(segment);
    renderLaps(); updateProgress();
    return true;
  }

  function showReview() {
    const review = elements["review-view"];
    const item = config();
    const reviewSegments = item.flexible
      ? timer.segments
      : Array.from({ length: item.laps }, (_, index) => timer.segments[index] ?? null);
    const reviewFrequencies = reviewSegments.map((_, index) => timer.frequencies[index] ?? null);
    let lapGroups = timer.lapGroups.length === timer.segments.length
      ? timer.lapGroups.map((laps, index) => ({ laps: [...laps], value: timer.segments[index] ?? null, frequency: timer.frequencies[index] ?? null }))
      : reviewSegments.map((value, index) => ({ laps: [index + 1], value, frequency: reviewFrequencies[index] }));
    let timeMode = "segment";
    let editMode = false;
    let glueMode = false;
    const glueHistory = [];
    const optionMarkup = () => participants.map((person) => `<option value="${person.id}">${escapeHtml(person.name)}</option>`).join("");
    const assignmentControl = (id, label) => `<div class="field"><label for="${id}-picker">${label}</label><button class="participant-picker-trigger" id="${id}-picker" type="button" data-select-id="${id}" aria-haspopup="dialog"><span class="participant-picker-value">Auswählen …</span>${icon("chevron-down")}</button><select class="participant-select" id="${id}" hidden tabindex="-1" aria-hidden="true"><option value="">Auswählen …</option>${optionMarkup()}</select></div>`;
    const assignmentMarkup = item.team
      ? `<fieldset class="team-assignment"><legend>Mannschaft</legend>${Array.from({ length: 4 }, (_, index) => assignmentControl(`participant-${index + 1}`, `Position ${index + 1}`)).join("")}</fieldset>`
      : assignmentControl("participant", "Person");
    setTimerInteractionLock(false);
    setReviewInteractionLock(true);
    elements["timer-view"].hidden = true;
    review.classList.toggle("normal-review", item.flexible);
    review.hidden = false;
    setDocumentTitle(`Ergebnis prüfen – ${event.name}`);
    review.innerHTML = `<div class="review-topbar"><button class="button secondary icon-button" id="close-review" aria-label="Zurück">${icon("arrow-left")}</button><h1 id="review-title">Ergebnis prüfen</h1><button class="button danger icon-button" id="discard-review" aria-label="Messung löschen" title="Messung löschen">${icon("trash")}</button></div>
      <div class="review-content">
      <section class="review-summary" id="review-summary">
      <button class="button secondary edit-mode-toggle" id="edit-mode" type="button">${icon("pencil")} Runden bearbeiten</button>
      <div class="review-time-summary"><div class="field stopped-time-field"><label>Gestoppte Zeit</label><div class="total-summary"><strong id="save-total" aria-live="polite">${formatTime(capturedTotal())}</strong></div></div>
      <div class="field official-time-field"><label for="official-time">Offizielle Zeit</label><input id="official-time" inputmode="decimal" enterkeyhint="done" placeholder="z. B. 123,45" value="${timer.officialTime === null ? "" : formatTime(timer.officialTime)}" aria-describedby="save-error"></div></div>
      ${item.team ? `${assignmentMarkup}<button class="button secondary add-review-person" id="new-review-person" type="button">${icon("user-plus")} Neue Person</button>` : `<div class="review-assignment-row">${assignmentMarkup}<button class="button secondary add-review-person" id="new-review-person" type="button">${icon("user-plus")} Neu</button></div>`}
      <label class="field review-note-field" for="result-note"><span>Notiz <small>optional</small></span><textarea id="result-note" maxlength="300" rows="2" placeholder="Kurzes Feedback">${escapeHtml(timer.note)}</textarea></label>
      <p class="form-error" id="save-error" role="alert"></p>
      <div class="form-actions save-actions"><button class="button" id="save-result" ${participants.length >= (item.team ? 4 : 1) ? "" : "disabled"}>${icon("save")} Ergebnis speichern</button></div></section>
      <section class="review-editor" id="review-editor" hidden>
        <div class="review-tools"><div class="time-mode-toggle" role="group" aria-label="Zeitdarstellung"><button type="button" class="active" data-time-mode="segment" aria-pressed="true">Sekunden</button><button type="button" data-time-mode="cumulative" aria-pressed="false">Kumuliert</button></div><div class="review-mode-actions"><button class="button secondary small glue-mode-toggle" id="glue-mode" type="button" aria-pressed="false">${icon("link")} Link</button><button class="button secondary small" id="finish-edit" type="button">${icon("check")} Fertig</button></div></div>
        <div class="glue-hint" id="glue-hint" hidden><span>Benachbarte Runden über das Kettensymbol verbinden.</span><button class="button secondary small" id="undo-glue" type="button" hidden>${icon("undo")} Rückgängig</button></div>
        <div class="edit-times" id="edit-times"></div>
      </section></div>
      <dialog class="participant-picker-dialog" id="participant-picker-dialog" tabindex="-1"><div class="dialog-body participant-picker-body">
        <div class="dialog-title-row"><h2>Person auswählen</h2><button type="button" class="button secondary icon-button" data-close aria-label="Schließen">${icon("x")}</button></div>
        <div class="participant-search-row"><div class="field participant-search"><label for="participant-search">Suchen</label><div class="participant-search-control"><input id="participant-search" type="search" inputmode="search" autocomplete="off" placeholder="Name oder Gliederung"><button class="participant-search-clear" id="participant-search-clear" type="button" aria-label="Suche löschen" hidden>${icon("x")}</button></div></div><button class="participant-filter-toggle" id="participant-filter-toggle" type="button" aria-label="Filter anzeigen" aria-expanded="false" aria-controls="participant-filters">${icon("filter")}</button></div>
        <div class="participant-filters" id="participant-filters" hidden>
          <div class="field"><span class="label">Geschlecht</span><div class="participant-gender-filter" role="group" aria-label="Nach Geschlecht filtern"><button type="button" class="active" data-picker-gender="" aria-pressed="true">Alle</button><button type="button" data-picker-gender="female" aria-pressed="false">W</button><button type="button" data-picker-gender="male" aria-pressed="false">M</button></div></div>
          <div class="field"><label for="participant-age-filter">Altersklasse</label><select id="participant-age-filter"><option value="">Alle</option></select></div>
        </div>
        <div class="participant-picker-list" id="participant-picker-list" role="listbox" aria-label="Personen"></div>
        <p class="participant-picker-empty" id="participant-picker-empty" hidden>Keine Person gefunden.</p>
      </div></dialog>
      <dialog id="review-person-dialog"><form class="dialog-body" id="review-person-form">
        <div class="dialog-title-row"><h2>Neue Person</h2><button type="button" class="button secondary icon-button" data-close aria-label="Schließen">${icon("x")}</button></div>
        <div class="form-grid">
          <div class="field full"><label for="review-person-name">Name</label><input id="review-person-name" name="name" maxlength="120" autocomplete="name" required></div>
          <div class="field"><label for="review-birth-year">Jahrgang</label><input id="review-birth-year" name="birthYear" type="number" min="1900" max="2200" inputmode="numeric" required></div>
          <div class="field"><label for="review-age-group">Altersklasse</label><input id="review-age-group" name="ageGroup" maxlength="40" required placeholder="z. B. AK 15/16"></div>
          <div class="field"><label for="review-gender">Geschlecht</label><select id="review-gender" name="gender" required><option value="female">Weiblich</option><option value="male">Männlich</option></select></div>
          <div class="field"><label for="review-organization">Gliederung</label><input id="review-organization" name="organization" maxlength="120" required placeholder="Verein / Ortsgruppe"></div>
        </div>
        <p class="form-error" id="review-person-error" role="alert"></p>
        <div class="form-actions"><button type="button" class="button secondary" data-close>Abbrechen</button><button type="submit" class="button">Hinzufügen</button></div>
      </form></dialog>`;

    const editTimes = review.querySelector("#edit-times");
    const officialInput = review.querySelector("#official-time");
    const noteInput = review.querySelector("#result-note");
    const participantSelects = [...review.querySelectorAll(".participant-select")];
    const saveResult = review.querySelector("#save-result");
    const personDialog = review.querySelector("#review-person-dialog");
    const participantPickerDialog = review.querySelector("#participant-picker-dialog");
    const participantPickerList = review.querySelector("#participant-picker-list");
    const participantPickerEmpty = review.querySelector("#participant-picker-empty");
    const participantSearch = review.querySelector("#participant-search");
    const participantSearchClear = review.querySelector("#participant-search-clear");
    const participantFilters = review.querySelector("#participant-filters");
    const participantFilterToggle = review.querySelector("#participant-filter-toggle");
    const participantAgeFilter = review.querySelector("#participant-age-filter");
    const participantPickerTriggers = [...review.querySelectorAll(".participant-picker-trigger")];
    const personForm = review.querySelector("#review-person-form");
    const reviewSummary = review.querySelector("#review-summary");
    const reviewEditor = review.querySelector("#review-editor");
    const reviewTitle = review.querySelector("#review-title");
    let activeParticipantSelect = null;
    let participantGenderFilter = "";
    let preferredParticipantGenderFilter = "";
    let preferredParticipantAgeFilter = "";
    let requiredParticipantGenderFilter = "";

    function participantName(person) {
      return `${person.name} (${birthYearText(person.birth_year)})`;
    }

    function updateParticipantTrigger(select) {
      const trigger = participantPickerTriggers.find((button) => button.dataset.selectId === select.id);
      if (!trigger) return;
      const person = participants.find((candidate) => candidate.id === select.value);
      const value = trigger.querySelector(".participant-picker-value");
      value.innerHTML = person ? `${personAvatar(person)}<span>${escapeHtml(participantName(person))}</span>` : "Auswählen …";
      trigger.classList.toggle("selected", Boolean(person));
    }

    function renderParticipantAgeFilter() {
      const selectedAgeGroup = participantAgeFilter.value;
      const ageGroups = [...new Set(participants.map((person) => person.age_group).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "de", { numeric: true, sensitivity: "base" }));
      participantAgeFilter.innerHTML = `<option value="">Alle</option>${ageGroups.map((ageGroup) => `<option value="${escapeHtml(ageGroup)}">${escapeHtml(ageGroup)}</option>`).join("")}`;
      participantAgeFilter.value = ageGroups.includes(selectedAgeGroup) ? selectedAgeGroup : "";
    }

    function renderParticipantPicker() {
      const query = participantSearch.value.trim().toLocaleLowerCase("de-DE");
      const ageGroup = participantAgeFilter.value;
      const matches = participants
        .filter((person) => !participantGenderFilter || person.gender === participantGenderFilter)
        .filter((person) => !ageGroup || person.age_group === ageGroup)
        .filter((person) => !query || [person.name, person.organization, person.age_group, person.birth_year]
          .some((value) => String(value).toLocaleLowerCase("de-DE").includes(query)))
        .sort(compareParticipantsByOrganization);
      participantPickerList.innerHTML = matches.map((person) => {
        const assignedElsewhere = participantSelects.find((select) => select !== activeParticipantSelect && select.value === person.id);
        const selected = activeParticipantSelect?.value === person.id;
        return `<button class="participant-picker-option ${selected ? "selected" : ""}" type="button" data-person-id="${person.id}" role="option" aria-selected="${selected}" ${assignedElsewhere ? "disabled" : ""}><span class="participant-picker-main">${personAvatar(person)}<span class="participant-picker-copy"><strong>${escapeHtml(participantName(person))}</strong><small>${escapeHtml(person.organization)} · ${escapeHtml(person.age_group)} · ${person.gender === "male" ? "m" : "w"}</small></span></span>${assignedElsewhere ? `<small>Position ${participantSelects.indexOf(assignedElsewhere) + 1}</small>` : (selected ? icon("check") : icon("arrow-right"))}</button>`;
      }).join("");
      participantPickerEmpty.hidden = matches.length !== 0;
    }

    function openParticipantPicker(select) {
      activeParticipantSelect = select;
      participantSearch.value = "";
      participantSearchClear.hidden = true;
      requiredParticipantGenderFilter = item.mixed
        ? mixedTeamRequiredGender(participantSelects, select, participants)
        : "";
      participantGenderFilter = requiredParticipantGenderFilter || preferredParticipantGenderFilter;
      participantAgeFilter.value = preferredParticipantAgeFilter;
      participantFilters.hidden = true;
      participantFilterToggle.classList.remove("active");
      participantFilterToggle.classList.toggle("filtered", Boolean(participantGenderFilter || preferredParticipantAgeFilter));
      participantFilterToggle.setAttribute("aria-expanded", "false");
      participantFilterToggle.setAttribute("aria-label", "Filter anzeigen");
      review.querySelectorAll("[data-picker-gender]").forEach((button) => {
        const gender = button.dataset.pickerGender;
        const active = gender === participantGenderFilter;
        button.disabled = Boolean(requiredParticipantGenderFilter && gender !== requiredParticipantGenderFilter);
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      renderParticipantAgeFilter();
      renderParticipantPicker();
      showDialog(participantPickerDialog, { focusField: false });
    }

    function syncLapGroupsFromInputs() {
      const timeInputs = [...editTimes.querySelectorAll(".segment-input")];
      const frequencyInputs = [...editTimes.querySelectorAll(".frequency-input")];
      let previousCumulative = 0;
      lapGroups.forEach((group, index) => {
        const timeText = timeInputs[index]?.value.trim() || "";
        if (!timeText) {
          group.value = null;
        } else if (timeMode === "segment") {
          group.value = parseReviewTime(timeText) ?? Number.NaN;
        } else {
          const cumulative = parseTime(timeText);
          group.value = cumulative !== null && cumulative > previousCumulative
            ? cumulative - previousCumulative
            : Number.NaN;
          if (cumulative !== null && cumulative > previousCumulative) previousCumulative = cumulative;
        }
        const frequencyText = frequencyInputs[index]?.value.trim() || "";
        group.frequency = !frequencyText
          ? null
          : (/^\d{1,3}$/.test(frequencyText) && Number(frequencyText) > 0 ? Number(frequencyText) : Number.NaN);
      });
    }

    function renderLapFields() {
      let cumulative = 0;
      editTimes.innerHTML = lapGroups.map((group, index) => {
        const validValue = Number.isInteger(group.value) && group.value > 0;
        if (validValue) cumulative += group.value;
        const displayedTime = !validValue
          ? ""
          : (timeMode === "segment" ? formatReviewTime(group.value) : formatCumulativeReviewTime(cumulative));
        const range = disciplineLapGroupLabel(timer.discipline, group.laps);
        const glueButton = glueMode && index < lapGroups.length - 1
          ? `<button class="glue-next" type="button" data-glue-index="${index}" aria-label="${escapeHtml(range)} mit ${escapeHtml(disciplineLapGroupLabel(timer.discipline, lapGroups[index + 1].laps))} verbinden" title="Mit nächster Runde verbinden">${icon("link")}</button>`
          : "";
        const values = editMode
          ? `<div class="review-lap-inputs"><label><span>${timeMode === "segment" ? "Zeit (s)" : "Kumuliert"}</span><input class="segment-input" id="segment-${index}" inputmode="decimal" enterkeyhint="next" value="${displayedTime}" aria-label="Zeit ${range}" aria-describedby="save-error"></label><label><span>Freq.</span><input class="frequency-input" id="frequency-${index}" inputmode="numeric" value="${Number.isInteger(group.frequency) ? group.frequency : ""}" aria-label="Frequenz ${range}" aria-describedby="save-error"></label></div>`
          : `<div class="review-lap-values"><strong>${displayedTime || "–"}</strong>${Number.isInteger(group.frequency) ? `<small>${group.frequency}/min</small>` : ""}<input class="segment-input" id="segment-${index}" type="hidden" value="${displayedTime}"><input class="frequency-input" id="frequency-${index}" type="hidden" value="${Number.isInteger(group.frequency) ? group.frequency : ""}"></div>`;
        return `<div class="field review-lap-field ${group.laps.length > 1 ? "glued" : ""} ${editMode ? "editable" : ""}"><div class="review-lap-title"><strong>${escapeHtml(range)}</strong>${glueButton}</div>${values}</div>`;
      }).join("");
      editTimes.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => readCorrections(false)));
      editTimes.querySelectorAll(".segment-input").forEach((input) => input.addEventListener("blur", () => {
        if (timeMode !== "cumulative" || !input.value.trim()) return;
        const parsed = parseTime(input.value);
        if (parsed !== null) input.value = formatCumulativeReviewTime(parsed);
        readCorrections(false);
      }));
      editTimes.querySelectorAll(".glue-next").forEach((button) => button.addEventListener("click", () => {
        syncLapGroupsFromInputs();
        const index = Number(button.dataset.glueIndex);
        const left = lapGroups[index];
        const right = lapGroups[index + 1];
        if (!left || !right) return;
        glueHistory.push(lapGroups.map((group) => ({ laps: [...group.laps], value: group.value, frequency: group.frequency })));
        const leftValue = Number.isInteger(left.value) && left.value > 0 ? left.value : null;
        const rightValue = Number.isInteger(right.value) && right.value > 0 ? right.value : null;
        const mergedFrequency = Number.isInteger(left.frequency) && Number.isInteger(right.frequency)
          ? (left.frequency === right.frequency ? left.frequency : null)
          : (Number.isInteger(left.frequency) ? left.frequency : (Number.isInteger(right.frequency) ? right.frequency : null));
        lapGroups.splice(index, 2, {
          laps: [...left.laps, ...right.laps],
          value: leftValue !== null || rightValue !== null ? (leftValue || 0) + (rightValue || 0) : null,
          frequency: mergedFrequency,
        });
        review.querySelector("#undo-glue").hidden = false;
        renderLapFields();
        readCorrections(false);
      }));
    }

    function readCorrections(showError = false) {
      syncLapGroupsFromInputs();
      const segments = lapGroups.map((group) => group.value);
      const frequencies = lapGroups.map((group) => group.frequency);
      const officialText = officialInput.value.trim();
      const officialTime = officialText ? parseTime(officialText) : null;
      const invalidSegments = segments.some((value) => value !== null && (!Number.isInteger(value) || value <= 0));
      const missingSegments = !segments.some((value) => Number.isInteger(value) && value > 0);
      const invalidFrequencies = frequencies.some((value) => Number.isNaN(value));
      const invalidOfficialTime = Boolean(officialText) && (officialTime === null || officialTime <= 0);
      const stoppedTime = segments.reduce((sum, value) => sum + (Number.isInteger(value) && value > 0 ? value : 0), 0);
      review.querySelector("#save-total").textContent = formatTime(stoppedTime);
      review.querySelector("#save-error").textContent = showError
        ? (invalidSegments || missingSegments
          ? (timeMode === "segment"
            ? "Abschnittszeiten bitte als Sekunden, z. B. 61,00, eingeben. Leere Runden sind erlaubt."
            : "Kumulierte Zeiten als m:ss,00 oder ohne Doppelpunkt als mss,00 eingeben. Leere Runden sind erlaubt.")
          : (invalidOfficialTime
            ? "Bitte m:ss,00 oder ohne Doppelpunkt mss,00 eingeben."
            : (invalidFrequencies ? "Frequenzen bitte als ganze Zahl von 1 bis 999 eingeben." : "")))
        : "";
      return invalidSegments || missingSegments || invalidOfficialTime || invalidFrequencies ? null : {
        segments,
        frequencies,
        officialTime,
        lapGroups: lapGroups.map((group) => [...group.laps]),
      };
    }
    renderLapFields();
    const editModeButton = review.querySelector("#edit-mode");
    const glueModeButton = review.querySelector("#glue-mode");
    function updateReviewModes() {
      glueModeButton.classList.toggle("active", glueMode);
      glueModeButton.setAttribute("aria-pressed", String(glueMode));
      review.querySelector("#glue-hint").hidden = !glueMode;
      renderLapFields();
    }
    function setEditMode(active) {
      if (editMode) syncLapGroupsFromInputs();
      editMode = active;
      if (!editMode) glueMode = false;
      reviewSummary.hidden = editMode;
      reviewEditor.hidden = !editMode;
      reviewTitle.textContent = editMode ? "Runden bearbeiten" : "Ergebnis prüfen";
      setDocumentTitle(`${editMode ? "Runden bearbeiten" : "Ergebnis prüfen"} – ${event.name}`);
      updateReviewModes();
      readCorrections(false);
      if (editMode) editTimes.querySelector(".segment-input")?.focus();
    }
    review.querySelectorAll("[data-time-mode]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.timeMode === timeMode) return;
      syncLapGroupsFromInputs();
      timeMode = button.dataset.timeMode;
      review.querySelectorAll("[data-time-mode]").forEach((candidate) => {
        const active = candidate.dataset.timeMode === timeMode;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      renderLapFields();
      readCorrections(false);
    }));
    editModeButton.addEventListener("click", () => setEditMode(true));
    review.querySelector("#finish-edit").addEventListener("click", () => setEditMode(false));
    glueModeButton.addEventListener("click", () => {
      syncLapGroupsFromInputs();
      glueMode = !glueMode;
      updateReviewModes();
    });
    review.querySelector("#undo-glue").addEventListener("click", () => {
      const previous = glueHistory.pop();
      if (!previous) return;
      lapGroups = previous;
      review.querySelector("#undo-glue").hidden = glueHistory.length === 0;
      renderLapFields();
      readCorrections(false);
    });
    officialInput.addEventListener("input", () => readCorrections(false));
    officialInput.addEventListener("blur", () => {
      if (!officialInput.value.trim()) return;
      const parsed = parseTime(officialInput.value);
      if (parsed !== null) officialInput.value = formatTime(parsed);
      readCorrections(false);
    });
    bindDialogClose(personDialog);
    bindDialogClose(participantPickerDialog);
    participantPickerTriggers.forEach((trigger) => trigger.addEventListener("click", () => {
      openParticipantPicker(review.querySelector(`#${trigger.dataset.selectId}`));
    }));
    participantSearch.addEventListener("input", () => {
      participantSearchClear.hidden = !participantSearch.value;
      renderParticipantPicker();
    });
    participantSearchClear.addEventListener("click", () => {
      participantSearch.value = "";
      participantSearchClear.hidden = true;
      renderParticipantPicker();
      participantSearch.focus();
    });
    participantFilterToggle.addEventListener("click", () => {
      const expanded = participantFilters.hidden;
      participantFilters.hidden = !expanded;
      participantFilterToggle.classList.toggle("active", expanded);
      participantFilterToggle.setAttribute("aria-expanded", String(expanded));
      participantFilterToggle.setAttribute("aria-label", expanded ? "Filter ausblenden" : "Filter anzeigen");
    });
    participantAgeFilter.addEventListener("change", () => {
      preferredParticipantAgeFilter = participantAgeFilter.value;
      participantFilterToggle.classList.toggle("filtered", Boolean(participantGenderFilter || participantAgeFilter.value));
      renderParticipantPicker();
    });
    review.querySelectorAll("[data-picker-gender]").forEach((button) => button.addEventListener("click", () => {
      if (button.disabled) return;
      participantGenderFilter = button.dataset.pickerGender;
      preferredParticipantGenderFilter = participantGenderFilter;
      review.querySelectorAll("[data-picker-gender]").forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      participantFilterToggle.classList.toggle("filtered", Boolean(participantGenderFilter || participantAgeFilter.value));
      renderParticipantPicker();
    }));
    participantPickerList.addEventListener("click", (clickEvent) => {
      const choice = clickEvent.target.closest("[data-person-id]");
      if (!choice || !activeParticipantSelect) return;
      activeParticipantSelect.value = choice.dataset.personId;
      updateParticipantTrigger(activeParticipantSelect);
      readCorrections(false);
      participantPickerDialog.close();
    });
    review.querySelector("#new-review-person").addEventListener("click", () => {
      personForm.reset();
      personForm.querySelector('[type="submit"]').disabled = false;
      review.querySelector("#review-person-error").textContent = "";
      showDialog(personDialog);
    });
    personForm.addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      const submitButton = submitEvent.submitter;
      try {
        submitButton.disabled = true;
        review.querySelector("#review-person-error").textContent = "";
        const values = Object.fromEntries(new FormData(personForm));
        const created = await api(`/events/${id}/participants`, { method: "POST", body: JSON.stringify(values) });
        const person = { id: created.id, name: values.name, birth_year: Number(values.birthYear), age_group: values.ageGroup, gender: values.gender, organization: values.organization };
        participants.push(person);
        participants.sort(compareParticipantsByOrganization);
        participantSelects.forEach((select) => {
          const option = document.createElement("option");
          option.value = person.id;
          option.textContent = `${person.name} · ${person.age_group} · ${person.organization}`;
          select.append(option);
        });
        const emptySelect = participantSelects.find((select) => !select.value) || participantSelects[0];
        emptySelect.value = person.id;
        updateParticipantTrigger(emptySelect);
        saveResult.disabled = participants.length < (item.team ? 4 : 1);
        personDialog.close();
        showToast("Person wurde hinzugefügt und ausgewählt.");
      } catch (err) {
        review.querySelector("#review-person-error").textContent = err.message;
        submitButton.disabled = false;
      }
    });
    function closeReview() {
      const corrections = readCorrections(false);
      if (corrections) {
        timer.segments = corrections.segments;
        timer.frequencies = corrections.frequencies;
        timer.lapGroups = corrections.lapGroups;
        timer.displayed = corrections.segments.reduce((sum, value) => sum + (value || 0), 0);
        timer.officialTime = corrections.officialTime;
        timer.note = noteInput.value;
        elements.clock.textContent = formatTime(timer.displayed);
      }
      review.hidden = true;
      elements["timer-view"].hidden = false;
      setReviewInteractionLock(false);
      setTimerInteractionLock(true);
      setDocumentTitle(`Timer – ${event.name}`);
      renderLaps(); updateProgress();
    }
    review.querySelector("#close-review").addEventListener("click", () => {
      if (editMode) {
        setEditMode(false);
        return;
      }
      closeReview();
    });
    review.querySelector("#discard-review").addEventListener("click", resetTimer);
    saveResult.addEventListener("click", async (event) => {
      const corrections = readCorrections(true);
      const participantIds = participantSelects.map((select) => select.value);
      const missingAssignment = participantIds.some((participantId) => !participantId);
      const duplicateAssignment = item.team && new Set(participantIds).size !== participantIds.length;
      const invalidMixedAssignment = item.mixed && !hasValidMixedTeam(participantIds, participants);
      if (!corrections || missingAssignment || duplicateAssignment || invalidMixedAssignment) {
        if (missingAssignment) review.querySelector("#save-error").textContent = item.team ? "Bitte alle vier Positionen besetzen." : "Bitte eine Person auswählen.";
        else if (duplicateAssignment) review.querySelector("#save-error").textContent = "Jede Person darf nur eine Position besetzen.";
        else if (invalidMixedAssignment) review.querySelector("#save-error").textContent = "Eine Mixed-Staffel benötigt zwei Frauen und zwei Männer.";
        return;
      }
      try {
        event.currentTarget.disabled = true;
        const assignment = item.team ? { participantIds } : { participantId: participantIds[0] };
        const synced = await saveResultOfflineFirst(id, { ...assignment, discipline: timer.discipline, segments: corrections.segments, frequencies: corrections.frequencies, lapGroups: corrections.lapGroups, officialTime: corrections.officialTime, note: noteInput.value.trim() });
        resetTimer();
        showToast(synced ? "Ergebnis gespeichert und synchronisiert." : "Ergebnis lokal gespeichert. Synchronisierung läuft.");
      } catch (err) {
        review.querySelector("#save-error").textContent = `Ergebnis konnte nicht sicher auf diesem Gerät gespeichert werden: ${err.message}`;
        event.currentTarget.disabled = false;
      }
    });
    window.scrollTo(0, 0);
  }

  bindDialogClose(elements["discipline-dialog"]);
  elements["mode-button"].addEventListener("click", () => {
    const availableGroups = availableModeGroups();
    if (availableGroups.length === 1) renderModeGroup(availableGroups[0].id, { allowBack: false });
    else renderModeCategories();
    showDialog(elements["discipline-dialog"], { focusField: false });
  });
  document.querySelector("#close-mode").addEventListener("click", () => elements["discipline-dialog"].close());
  modeBack.addEventListener("click", renderModeCategories);
  elements["discipline-dialog"].addEventListener("click", (event) => {
    const groupChoice = event.target.closest("[data-mode-group]");
    if (groupChoice) {
      renderModeGroup(groupChoice.dataset.modeGroup);
      return;
    }
    const disciplineChoice = event.target.closest("[data-discipline]");
    if (!disciplineChoice) return;
    timer.discipline = disciplineChoice.dataset.discipline;
    updateMode();
    elements["discipline-dialog"].close();
  });
  elements["left-action"].addEventListener("click", () => {
    if (timer.status === "stopped") {
      resetTimer();
      return;
    }
    if (!addSegment()) return;
    updateControls();
  });

  elements["timer-view"].addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, select, dialog")) return;
    if (timer.status !== "running") return;
    const actionsTop = elements["left-action"].parentElement.getBoundingClientRect().top;
    if (event.clientY < actionsTop) {
      tapFrequency();
      return;
    }
    if (event.clientY < document.documentElement.clientHeight / 2) return;
    if (timer.segments.length >= config().laps - 1) {
      elements["right-action"].click();
      return;
    }
    if (!addSegment()) return;
    updateControls();
  });

  elements["right-action"].addEventListener("click", () => {
    if (timer.status === "idle") {
      timer.status = "running";
      timer.startedAt = performance.now();
      timer.displayed = 0;
      timer.segments = [];
      timer.frequencies = [];
      timer.lapGroups = [];
      resetFrequencyCapture();
      elements["clock-status"].textContent = "Läuft";
      elements["mode-button"].disabled = true;
      renderLaps(); updateProgress(); updateControls(); drawClock();
      return;
    }
    if (timer.status === "running") {
      const finalTime = currentCs();
      const finalSegment = finalTime - capturedTotal();
      if (finalSegment <= 0) return;
      timer.displayed = finalTime;
      timer.officialTime = null;
      timer.status = "stopped";
      finishFrequency();
      if (timer.frequencies[timer.segments.length] === undefined) timer.frequencies[timer.segments.length] = null;
      timer.segments.push(finalSegment);
      cancelAnimationFrame(animationFrame);
      elements.clock.textContent = formatTime(timer.displayed);
      elements["clock-status"].textContent = "Gestoppt";
      renderLaps(); updateProgress(); updateControls();
      showReview();
      return;
    }
    timer.segments.pop();
    timer.frequencies.pop();
    resetFrequencyCapture();
    timer.officialTime = null;
    timer.status = "running";
    timer.startedAt = performance.now();
    elements["clock-status"].textContent = "Läuft";
    renderLaps(); updateProgress(); updateControls(); drawClock();
  });

  updateMode();
  updateControls();
  setTimerInteractionLock(true);
}

async function renderViewer(id, initialDiscipline = null, initialGender = null, options = {}) {
  const eventResponse = await api(`/events/${id}`);
  let event = eventResponse.event;
  const participants = eventResponse.participants;
  const resultsOnly = options.resultsOnly === true;
  const viewerRoot = `#/${resultsOnly ? "results" : "viewer"}/${id}`;
  const officialResultsUrl = safeExternalUrl(event.result_url);
  if (!eventCan(event, "can_view_results")) {
    setDocumentTitle(`Ergebnisse – ${event.name}`);
    app.innerHTML = `${resultsOnly ? "" : `<a class="back" href="#/event/${id}" data-history-back>${icon("arrow-left")} ${escapeHtml(event.name)}</a>`}<div class="empty"><strong>Kein Zugriff auf Ergebnisse</strong><p>Die Event-Einstellungen erlauben diese Ansicht für dein Konto nicht.</p></div>`;
    return;
  }
  participants.sort(compareParticipantsByOrganization);
  let eventPdfImage = null;
  let eventPdfImageReady = false;
  loadEventPdfImage(event).then((image) => {
    eventPdfImage = image;
    eventPdfImageReady = true;
    document.querySelector("#create-results-pdf")?.removeAttribute("disabled");
  });
  const initialItem = disciplines[initialDiscipline];
  const validInitialGender = initialItem?.mixed ? initialGender === "mixed" : ["female", "male"].includes(initialGender);
  let selected = initialItem && validInitialGender
    ? { discipline: initialDiscipline, gender: initialGender }
    : null;
  setDocumentTitle(`Ergebnisse – ${event.name}`);
  app.innerHTML = `
    <div id="viewer-overview-head" ${selected ? "hidden" : ""}>
    ${resultsOnly ? `<p class="eyebrow shared-results-event-name">${escapeHtml(event.name)}</p>` : `<a class="back" href="#/event/${id}" data-history-back>${icon("arrow-left")} ${escapeHtml(event.name)}</a>`}
    <div class="page-head viewer-page-head"><h1>Ergebnisse</h1>
      <div class="viewer-refresh">${officialResultsUrl ? `<a class="button secondary official-results-link" href="${escapeHtml(officialResultsUrl)}" target="_blank" rel="noopener noreferrer">${icon("link")} Offizielle Ergebnisse</a>` : ""}
      ${event.results_access === "everyone" ? `<button class="button secondary icon-button viewer-refresh-button" id="copy-results-link" type="button" aria-label="Öffentlichen Ergebnis-Link kopieren" title="Ergebnis-Link kopieren">${icon("link")}</button>` : ""}
      <button class="button secondary icon-button viewer-refresh-button" id="refresh-results" aria-label="Ergebnisse aktualisieren" title="Ergebnisse aktualisieren">${icon("refresh")}</button></div></div></div>
    <div id="results"><div class="loading">Ergebnisse werden geladen …</div></div>
    <dialog id="result-edit-dialog"><form class="dialog-body result-edit-form" id="result-edit-form">
      <div class="dialog-title-row"><h2>Ergebnis bearbeiten</h2><button type="button" class="button secondary icon-button" data-close aria-label="Schließen">${icon("x")}</button></div>
      <div id="result-edit-fields"></div>
      <p class="form-error" id="result-edit-error" role="alert"></p>
      <div class="form-actions"><button type="button" class="button secondary" data-close>Abbrechen</button><button class="button">Speichern</button></div>
      <div class="dialog-delete-row"><button type="button" class="button danger small" id="delete-result-dialog">${icon("trash")} Ergebnis löschen</button></div>
    </form></dialog>
    <dialog class="participant-picker-dialog" id="result-participant-picker-dialog" tabindex="-1"><div class="dialog-body participant-picker-body">
      <div class="dialog-title-row"><h2>Person auswählen</h2><button type="button" class="button secondary icon-button" data-close aria-label="Schließen">${icon("x")}</button></div>
      <div class="participant-search-row"><div class="field participant-search"><label for="result-participant-search">Suchen</label><div class="participant-search-control"><input id="result-participant-search" type="search" inputmode="search" autocomplete="off" placeholder="Name oder Gliederung"><button class="participant-search-clear" id="result-participant-search-clear" type="button" aria-label="Suche löschen" hidden>${icon("x")}</button></div></div><button class="participant-filter-toggle" id="result-participant-filter-toggle" type="button" aria-label="Filter anzeigen" aria-expanded="false" aria-controls="result-participant-filters">${icon("filter")}</button></div>
      <div class="participant-filters" id="result-participant-filters" hidden>
        <div class="field"><span class="label">Geschlecht</span><div class="participant-gender-filter" role="group" aria-label="Nach Geschlecht filtern"><button type="button" class="active" data-result-picker-gender="" aria-pressed="true">Alle</button><button type="button" data-result-picker-gender="female" aria-pressed="false">W</button><button type="button" data-result-picker-gender="male" aria-pressed="false">M</button></div></div>
        <div class="field"><label for="result-participant-age-filter">Altersklasse</label><select id="result-participant-age-filter"><option value="">Alle</option></select></div>
      </div>
      <div class="participant-picker-list" id="result-participant-picker-list" role="listbox" aria-label="Personen"></div>
      <p class="participant-picker-empty" id="result-participant-picker-empty" hidden>Keine Person gefunden.</p>
    </div></dialog>`;

  const overviewHead = document.querySelector("#viewer-overview-head");
  const resultsRoot = document.querySelector("#results");
  const refreshButton = document.querySelector("#refresh-results");
  const copyResultsLinkButton = document.querySelector("#copy-results-link");
  const resultEditDialog = document.querySelector("#result-edit-dialog");
  const resultEditForm = document.querySelector("#result-edit-form");
  const resultEditFields = document.querySelector("#result-edit-fields");
  const resultEditError = document.querySelector("#result-edit-error");
  const deleteResultButton = document.querySelector("#delete-result-dialog");
  const resultParticipantPickerDialog = document.querySelector("#result-participant-picker-dialog");
  const resultParticipantPickerList = document.querySelector("#result-participant-picker-list");
  const resultParticipantPickerEmpty = document.querySelector("#result-participant-picker-empty");
  const resultParticipantSearch = document.querySelector("#result-participant-search");
  const resultParticipantSearchClear = document.querySelector("#result-participant-search-clear");
  const resultParticipantFilters = document.querySelector("#result-participant-filters");
  const resultParticipantFilterToggle = document.querySelector("#result-participant-filter-toggle");
  const resultParticipantAgeFilter = document.querySelector("#result-participant-age-filter");
  let loading = false;
  let allResults = [];
  let editingResult = null;
  let resultEditLapGroups = [];
  let resultEditGlueHistory = [];
  let resultEditGlueMode = false;
  let activeResultParticipantSelect = null;
  let resultParticipantGenderFilter = "";
  let resultSelectionCategory = null;
  let preferredResultParticipantGenderFilter = "";
  let preferredResultParticipantAgeFilter = "";
  let requiredResultParticipantGenderFilter = "";

  bindDialogClose(resultEditDialog);
  bindDialogClose(resultParticipantPickerDialog);

  copyResultsLinkButton?.addEventListener("click", async () => {
    try {
      copyResultsLinkButton.disabled = true;
      const shareUrl = new URL(window.location.href);
      shareUrl.hash = `#/results/${id}`;
      try {
        await navigator.clipboard.writeText(shareUrl.href);
        showToast("Öffentlicher Ergebnis-Link wurde kopiert.");
      } catch {
        window.prompt("Ergebnis-Link kopieren:", shareUrl.href);
      }
    } catch (error) {
      showToast(error.message || "Ergebnis-Link konnte nicht erstellt werden.");
    } finally {
      copyResultsLinkButton.disabled = false;
    }
  });

  const genderName = (gender) => gender === "female" ? "Weiblich" : (gender === "male" ? "Männlich" : "Mixed");
  const participantName = (person) => `${person.name} (${birthYearText(person.birth_year)})`;

  function updateResultParticipantTrigger(select) {
    const trigger = resultEditFields.querySelector(`[data-select-id="${select.id}"]`);
    if (!trigger) return;
    const person = participants.find((candidate) => candidate.id === select.value);
    const value = trigger.querySelector(".participant-picker-value");
    value.innerHTML = person ? `${personAvatar(person)}<span>${escapeHtml(participantName(person))}</span>` : "Auswählen …";
    trigger.classList.toggle("selected", Boolean(person));
  }

  function renderResultParticipantAgeFilter() {
    const selectedAgeGroup = resultParticipantAgeFilter.value;
    const ageGroups = [...new Set(participants.map((person) => person.age_group).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "de", { numeric: true, sensitivity: "base" }));
    resultParticipantAgeFilter.innerHTML = `<option value="">Alle</option>${ageGroups.map((ageGroup) => `<option value="${escapeHtml(ageGroup)}">${escapeHtml(ageGroup)}</option>`).join("")}`;
    resultParticipantAgeFilter.value = ageGroups.includes(selectedAgeGroup) ? selectedAgeGroup : "";
  }

  function renderResultParticipantPicker() {
    const query = resultParticipantSearch.value.trim().toLocaleLowerCase("de-DE");
    const ageGroup = resultParticipantAgeFilter.value;
    const assignmentSelects = [...resultEditFields.querySelectorAll(".result-participant-select")];
    const matches = participants
      .filter((person) => !resultParticipantGenderFilter || person.gender === resultParticipantGenderFilter)
      .filter((person) => !ageGroup || person.age_group === ageGroup)
      .filter((person) => !query || [person.name, person.organization, person.age_group, person.birth_year]
        .some((value) => String(value).toLocaleLowerCase("de-DE").includes(query)))
      .sort(compareParticipantsByOrganization);
    resultParticipantPickerList.innerHTML = matches.map((person) => {
      const assignedElsewhere = assignmentSelects.find((select) => select !== activeResultParticipantSelect && select.value === person.id);
      const selectedPerson = activeResultParticipantSelect?.value === person.id;
      return `<button class="participant-picker-option ${selectedPerson ? "selected" : ""}" type="button" data-person-id="${person.id}" role="option" aria-selected="${selectedPerson}" ${assignedElsewhere ? "disabled" : ""}><span class="participant-picker-main">${personAvatar(person)}<span class="participant-picker-copy"><strong>${escapeHtml(participantName(person))}</strong><small>${escapeHtml(person.organization)} · ${escapeHtml(person.age_group)} · ${person.gender === "male" ? "m" : "w"}</small></span></span>${assignedElsewhere ? `<small>Position ${assignmentSelects.indexOf(assignedElsewhere) + 1}</small>` : (selectedPerson ? icon("check") : icon("arrow-right"))}</button>`;
    }).join("");
    resultParticipantPickerEmpty.hidden = matches.length !== 0;
  }

  function openResultParticipantPicker(select) {
    activeResultParticipantSelect = select;
    resultParticipantSearch.value = "";
    resultParticipantSearchClear.hidden = true;
    const assignmentSelects = [...resultEditFields.querySelectorAll(".result-participant-select")];
    requiredResultParticipantGenderFilter = disciplines[editingResult?.discipline]?.mixed
      ? mixedTeamRequiredGender(assignmentSelects, select, participants)
      : "";
    resultParticipantGenderFilter = requiredResultParticipantGenderFilter || preferredResultParticipantGenderFilter;
    resultParticipantAgeFilter.value = preferredResultParticipantAgeFilter;
    resultParticipantFilters.hidden = true;
    resultParticipantFilterToggle.classList.remove("active");
    resultParticipantFilterToggle.classList.toggle("filtered", Boolean(resultParticipantGenderFilter || preferredResultParticipantAgeFilter));
    resultParticipantFilterToggle.setAttribute("aria-expanded", "false");
    resultParticipantFilterToggle.setAttribute("aria-label", "Filter anzeigen");
    document.querySelectorAll("[data-result-picker-gender]").forEach((button) => {
      const gender = button.dataset.resultPickerGender;
      const active = gender === resultParticipantGenderFilter;
      button.disabled = Boolean(requiredResultParticipantGenderFilter && gender !== requiredResultParticipantGenderFilter);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    renderResultParticipantAgeFilter();
    renderResultParticipantPicker();
    showDialog(resultParticipantPickerDialog, { focusField: false });
  }

  function renderSelection() {
    document.body.classList.add("viewer-overview");
    overviewHead.hidden = false;
    setDocumentTitle(`Ergebnisse – ${event.name}`);
    const counts = new Map();
    allResults.forEach((result) => {
      const key = `${result.discipline}:${result.gender}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const availableDisciplines = Object.entries(disciplines).map(([disciplineId, item]) => ({
      disciplineId,
      item,
      femaleCount: counts.get(`${disciplineId}:female`) || 0,
      maleCount: counts.get(`${disciplineId}:male`) || 0,
    })).filter(({ femaleCount, maleCount }) => femaleCount > 0 || maleCount > 0);
    if (!resultSelectionCategory) {
      resultSelectionCategory = availableDisciplines.length > 0
        && availableDisciplines.every(({ item }) => item.group === "team")
        ? "team"
        : "individual";
    }
    const categoryEntries = resultSelectionCategory === "team"
      ? availableDisciplines.filter(({ item }) => item.group === "team")
      : availableDisciplines
        .filter(({ item }) => item.group !== "team")
        .sort((left, right) => Number(left.disciplineId === "normal") - Number(right.disciplineId === "normal"));
    const resultButton = (disciplineId, item, gender, count) => count
      ? `<button class="result-choice ${gender === "female" ? "female" : "male"}" data-discipline="${disciplineId}" data-gender="${gender}" aria-label="${escapeHtml(item.name)}, ${genderName(gender)}, ${count} ${count === 1 ? "Ergebnis" : "Ergebnisse"}"><strong>${escapeHtml(item.name)}</strong><span>${genderName(gender)}</span></button>`
      : `<span class="result-choice-space" aria-hidden="true"></span>`;
    resultsRoot.innerHTML = `<div class="result-selection" aria-label="Ergebnisgruppen">
      <div class="result-category-tabs" role="tablist" aria-label="Ergebnisart">
        <button type="button" role="tab" data-result-category="individual" aria-selected="${resultSelectionCategory === "individual"}" class="${resultSelectionCategory === "individual" ? "active" : ""}">Einzel</button>
        <button type="button" role="tab" data-result-category="team" aria-selected="${resultSelectionCategory === "team"}" class="${resultSelectionCategory === "team" ? "active" : ""}">Mannschaft</button>
      </div>
      ${categoryEntries.length
        ? `<div class="result-selection-group-rows" role="tabpanel">${categoryEntries.map(({ disciplineId, item, femaleCount, maleCount }) =>
          item.mixed
            ? `<div class="result-selection-row"><button class="result-choice mixed" data-discipline="${disciplineId}" data-gender="mixed" aria-label="${escapeHtml(item.name)}, Mixed, ${femaleCount + maleCount} Ergebnisse"><strong>${escapeHtml(item.name)}</strong><span>Mixed</span></button></div>`
            : `<div class="result-selection-row ${disciplineId === "normal" ? "custom-result-row" : ""}">${resultButton(disciplineId, item, "female", femaleCount)}${resultButton(disciplineId, item, "male", maleCount)}</div>`
        ).join("")}</div>`
        : `<div class="empty">Noch keine ${resultSelectionCategory === "team" ? "Mannschafts" : "Einzel"}ergebnisse.</div>`}
    </div>`;
    resultsRoot.querySelectorAll("[data-result-category]").forEach((button) => button.addEventListener("click", () => {
      resultSelectionCategory = button.dataset.resultCategory;
      renderSelection();
    }));
    resultsRoot.querySelectorAll(".result-choice").forEach((button) => button.addEventListener("click", () => {
      window.scrollTo(0, 0);
      location.hash = `${viewerRoot}/${button.dataset.discipline}/${button.dataset.gender}`;
    }));
  }

  function openResultEditor(result) {
    editingResult = result;
    resultEditError.textContent = "";
    resultEditForm.querySelector('button[type="submit"], button:not([type])').disabled = false;
    deleteResultButton.disabled = false;
    const item = disciplines[result.discipline];
    const lapGroups = resultLapGroups(result);
    resultEditLapGroups = result.segments.map((value, index) => ({
      laps: [...(lapGroups[index] || [index + 1])],
      value,
      frequency: result.frequencies?.[index] ?? null,
    }));
    resultEditGlueHistory = [];
    resultEditGlueMode = false;
    const displayName = result.team_members?.length
      ? "Mannschaft"
      : `${result.participant_name} (${birthYearText(result.birth_year)})`;
    const selectedParticipantIds = item.team
      ? [...(result.team_members || [])].sort((left, right) => left.position - right.position).map((member) => member.id)
      : [result.participant_id];
    const assignmentControl = (controlId, label, selectedId) => `<div class="field"><label for="${controlId}-picker">${label}</label><button class="participant-picker-trigger result-participant-picker-trigger" id="${controlId}-picker" type="button" data-select-id="${controlId}" aria-haspopup="dialog"><span class="participant-picker-value">Auswählen …</span>${icon("chevron-down")}</button><select class="result-participant-select" id="${controlId}" hidden tabindex="-1" aria-hidden="true"><option value="">Auswählen …</option>${participants.map((person) => `<option value="${person.id}" ${person.id === selectedId ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select></div>`;
    const assignmentMarkup = item.team
      ? `<fieldset class="team-assignment result-edit-team-assignment"><legend>Personen</legend>${Array.from({ length: 4 }, (_, index) => assignmentControl(`result-participant-${index + 1}`, `Position ${index + 1}`, selectedParticipantIds[index] || "")).join("")}</fieldset>`
      : assignmentControl("result-participant", "Person", selectedParticipantIds[0] || "");
    const stoppedTime = result.segments.reduce((sum, value) => sum + (Number.isInteger(value) && value > 0 ? value : 0), 0);
    resultEditFields.innerHTML = `
      <div class="result-edit-person"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(disciplines[result.discipline].name)}</span></div>
      <div class="result-edit-assignment">${assignmentMarkup}</div>
      <div class="review-time-summary result-edit-times-summary">
        <div class="field"><span class="label">Gestoppt</span><div class="total-summary"><strong id="result-edit-stopped">${formatTime(stoppedTime)}</strong></div></div>
        <label class="field"><span>Offiziell</span><input id="result-edit-official" inputmode="decimal" placeholder="m:ss,00" value="${result.official_centiseconds == null ? "" : formatTime(result.official_centiseconds)}"></label>
      </div>
      <div class="result-edit-lap-toolbar"><span class="label">Runden</span><div><button class="button secondary small" id="result-edit-glue-mode" type="button" aria-pressed="false">${icon("link")} Link</button><button class="button secondary small" id="result-edit-undo-glue" type="button" hidden>${icon("undo")} Rückgängig</button></div></div>
      <div class="result-edit-laps"></div>
      <label class="field result-edit-note-field"><span>Notiz <small>optional</small></span><textarea id="result-edit-note" maxlength="300" rows="2" placeholder="Kurzes Feedback">${escapeHtml(result.note || "")}</textarea></label>`;
    const assignmentSelects = [...resultEditFields.querySelectorAll(".result-participant-select")];
    assignmentSelects.forEach(updateResultParticipantTrigger);
    resultEditFields.querySelectorAll(".result-participant-picker-trigger").forEach((trigger) => trigger.addEventListener("click", () => {
      openResultParticipantPicker(resultEditFields.querySelector(`#${trigger.dataset.selectId}`));
    }));
    const updateStoppedTime = () => {
      const values = [...resultEditFields.querySelectorAll(".result-edit-segment")]
        .map((input) => input.value.trim() ? parseReviewTime(input.value) : null);
      const validTotal = values.reduce((sum, value) => sum + (Number.isInteger(value) ? value : 0), 0);
      resultEditFields.querySelector("#result-edit-stopped").textContent = formatTime(validTotal);
    };
    const syncResultEditLapValues = () => {
      const segmentInputs = [...resultEditFields.querySelectorAll(".result-edit-segment")];
      const frequencyInputs = [...resultEditFields.querySelectorAll(".result-edit-frequency")];
      const segments = segmentInputs.map((input) => input.value.trim() ? parseReviewTime(input.value) : null);
      const frequencies = frequencyInputs.map((input) => input.value.trim() ? Number(input.value) : null);
      if (segments.some((value, index) => segmentInputs[index].value.trim() && !Number.isInteger(value))) {
        resultEditError.textContent = "Lap-Zeiten bitte als Sekunden eingeben, zum Beispiel 32,45.";
        return false;
      }
      if (frequencies.some((value) => value !== null && (!Number.isInteger(value) || value < 1 || value > 999))) {
        resultEditError.textContent = "Frequenzen müssen zwischen 1 und 999 liegen.";
        return false;
      }
      resultEditLapGroups.forEach((group, index) => {
        group.value = segments[index];
        group.frequency = frequencies[index];
      });
      resultEditError.textContent = "";
      return true;
    };
    const renderResultEditLaps = () => {
      const lapsRoot = resultEditFields.querySelector(".result-edit-laps");
      lapsRoot.innerHTML = resultEditLapGroups.map((group, index) => `<div class="result-edit-lap-block">
        <div class="result-edit-lap">
          <strong>${escapeHtml(disciplineLapGroupLabel(result.discipline, group.laps))}</strong>
          <label><span>Zeit (s)</span><input class="result-edit-segment" inputmode="decimal" value="${group.value == null ? "" : formatReviewTime(group.value)}"></label>
          <label><span>Freq.</span><input class="result-edit-frequency" inputmode="numeric" value="${Number.isInteger(group.frequency) ? group.frequency : ""}"></label>
        </div>
        ${resultEditGlueMode && index < resultEditLapGroups.length - 1 ? `<button class="result-edit-glue-next" type="button" data-glue-index="${index}" aria-label="${escapeHtml(disciplineLapGroupLabel(result.discipline, group.laps))} mit der nächsten Runde verbinden" title="Mit nächster Runde verbinden">${icon("link")}</button>` : ""}
      </div>`).join("");
      lapsRoot.querySelectorAll(".result-edit-segment").forEach((input) => input.addEventListener("input", updateStoppedTime));
      lapsRoot.querySelectorAll(".result-edit-glue-next").forEach((button) => button.addEventListener("click", () => {
        if (!syncResultEditLapValues()) return;
        const index = Number(button.dataset.glueIndex);
        const left = resultEditLapGroups[index];
        const right = resultEditLapGroups[index + 1];
        if (!left || !right) return;
        resultEditGlueHistory.push(resultEditLapGroups.map((group) => ({ laps: [...group.laps], value: group.value, frequency: group.frequency })));
        const leftValue = Number.isInteger(left.value) && left.value > 0 ? left.value : null;
        const rightValue = Number.isInteger(right.value) && right.value > 0 ? right.value : null;
        const frequency = Number.isInteger(left.frequency) && Number.isInteger(right.frequency)
          ? (left.frequency === right.frequency ? left.frequency : null)
          : (Number.isInteger(left.frequency) ? left.frequency : (Number.isInteger(right.frequency) ? right.frequency : null));
        resultEditLapGroups.splice(index, 2, {
          laps: [...left.laps, ...right.laps],
          value: leftValue !== null || rightValue !== null ? (leftValue || 0) + (rightValue || 0) : null,
          frequency,
        });
        resultEditFields.querySelector("#result-edit-undo-glue").hidden = false;
        renderResultEditLaps();
        updateStoppedTime();
      }));
    };
    const glueModeButton = resultEditFields.querySelector("#result-edit-glue-mode");
    glueModeButton.addEventListener("click", () => {
      if (!syncResultEditLapValues()) return;
      resultEditGlueMode = !resultEditGlueMode;
      glueModeButton.classList.toggle("active", resultEditGlueMode);
      glueModeButton.setAttribute("aria-pressed", String(resultEditGlueMode));
      renderResultEditLaps();
    });
    resultEditFields.querySelector("#result-edit-undo-glue").addEventListener("click", () => {
      const previous = resultEditGlueHistory.pop();
      if (!previous) return;
      resultEditLapGroups = previous;
      resultEditFields.querySelector("#result-edit-undo-glue").hidden = resultEditGlueHistory.length === 0;
      renderResultEditLaps();
      updateStoppedTime();
    });
    renderResultEditLaps();
    showDialog(resultEditDialog, { focusField: false });
  }

  resultParticipantSearch.addEventListener("input", () => {
    resultParticipantSearchClear.hidden = !resultParticipantSearch.value;
    renderResultParticipantPicker();
  });
  resultParticipantSearchClear.addEventListener("click", () => {
    resultParticipantSearch.value = "";
    resultParticipantSearchClear.hidden = true;
    renderResultParticipantPicker();
    resultParticipantSearch.focus();
  });
  resultParticipantFilterToggle.addEventListener("click", () => {
    const expanded = resultParticipantFilters.hidden;
    resultParticipantFilters.hidden = !expanded;
    resultParticipantFilterToggle.classList.toggle("active", expanded);
    resultParticipantFilterToggle.setAttribute("aria-expanded", String(expanded));
    resultParticipantFilterToggle.setAttribute("aria-label", expanded ? "Filter ausblenden" : "Filter anzeigen");
  });
  resultParticipantAgeFilter.addEventListener("change", () => {
    preferredResultParticipantAgeFilter = resultParticipantAgeFilter.value;
    resultParticipantFilterToggle.classList.toggle("filtered", Boolean(resultParticipantGenderFilter || resultParticipantAgeFilter.value));
    renderResultParticipantPicker();
  });
  document.querySelectorAll("[data-result-picker-gender]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled) return;
    resultParticipantGenderFilter = button.dataset.resultPickerGender;
    preferredResultParticipantGenderFilter = resultParticipantGenderFilter;
    document.querySelectorAll("[data-result-picker-gender]").forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    });
    resultParticipantFilterToggle.classList.toggle("filtered", Boolean(resultParticipantGenderFilter || resultParticipantAgeFilter.value));
    renderResultParticipantPicker();
  }));
  resultParticipantPickerList.addEventListener("click", (clickEvent) => {
    const choice = clickEvent.target.closest("[data-person-id]");
    if (!choice || !activeResultParticipantSelect) return;
    activeResultParticipantSelect.value = choice.dataset.personId;
    updateResultParticipantTrigger(activeResultParticipantSelect);
    resultParticipantPickerDialog.close();
  });

  resultEditForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    if (!editingResult) return;
    const submitButton = submitEvent.submitter;
    const segmentInputs = [...resultEditFields.querySelectorAll(".result-edit-segment")];
    const frequencyInputs = [...resultEditFields.querySelectorAll(".result-edit-frequency")];
    const segments = segmentInputs.map((input) => input.value.trim() ? parseReviewTime(input.value) : null);
    const frequencies = frequencyInputs.map((input) => input.value.trim() ? Number(input.value) : null);
    const lapGroups = resultEditLapGroups.map((group) => [...group.laps]);
    const officialText = resultEditFields.querySelector("#result-edit-official").value.trim();
    const officialTime = officialText ? parseTime(officialText) : null;
    const note = resultEditFields.querySelector("#result-edit-note").value.trim();
    const assignmentSelects = [...resultEditFields.querySelectorAll(".result-participant-select")];
    const participantIds = assignmentSelects.map((select) => select.value);
    const item = disciplines[editingResult.discipline];
    if (participantIds.some((participantId) => !participantId)) {
      resultEditError.textContent = item.team ? "Bitte alle vier Positionen besetzen." : "Bitte eine Person auswählen.";
      return;
    }
    if (item.team && new Set(participantIds).size !== participantIds.length) {
      resultEditError.textContent = "Jede Person darf nur eine Position besetzen.";
      return;
    }
    if (item.mixed && !hasValidMixedTeam(participantIds, participants)) {
      resultEditError.textContent = "Eine Mixed-Staffel benötigt zwei Frauen und zwei Männer.";
      return;
    }
    if (segments.some((value, index) => segmentInputs[index].value.trim() && !Number.isInteger(value))) {
      resultEditError.textContent = "Lap-Zeiten bitte als Sekunden eingeben, zum Beispiel 32,45.";
      return;
    }
    if (!segments.some((value) => Number.isInteger(value) && value > 0)) {
      resultEditError.textContent = "Mindestens eine Lap-Zeit ist erforderlich.";
      return;
    }
    if (frequencies.some((value) => value !== null && (!Number.isInteger(value) || value < 1 || value > 999))) {
      resultEditError.textContent = "Frequenzen müssen zwischen 1 und 999 liegen.";
      return;
    }
    if (officialText && officialTime === null) {
      resultEditError.textContent = "Offizielle Zeit bitte als m:ss,00 eingeben.";
      return;
    }
    try {
      submitButton.disabled = true;
      resultEditError.textContent = "";
      const assignment = item.team ? { participantIds } : { participantId: participantIds[0] };
      await api(`/events/${id}/results/${editingResult.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...assignment, segments, frequencies, lapGroups, officialTime, note }),
      });
      resultEditDialog.close();
      editingResult = null;
      await loadResults();
    } catch (error) {
      resultEditError.textContent = error.message;
      submitButton.disabled = false;
    }
  });

  deleteResultButton.addEventListener("click", async () => {
    if (!editingResult || !confirm("Dieses Ergebnis unwiderruflich löschen?")) return;
    try {
      deleteResultButton.disabled = true;
      await api(`/events/${id}/results/${editingResult.id}`, { method: "DELETE" });
      resultEditDialog.close();
      editingResult = null;
      await loadResults();
    } catch (error) {
      resultEditError.textContent = error.message;
    } finally {
      deleteResultButton.disabled = false;
    }
  });

  function renderResultList() {
    document.body.classList.remove("viewer-overview");
    const item = disciplines[selected.discipline];
    overviewHead.hidden = true;
    setDocumentTitle(`${item.name} · ${genderName(selected.gender)} – ${event.name}`);
    const results = allResults.filter((result) => result.discipline === selected.discipline && (item.mixed || result.gender === selected.gender));
    const savedLapCount = results.reduce((maximum, result) => {
      const coveredLaps = resultLapGroups(result).flat();
      return Math.max(maximum, coveredLaps.length ? Math.max(...coveredLaps) : result.segments.length);
    }, 0);
    const lapCount = item.flexible ? savedLapCount : item.laps;
    const cardView = `<div class="result-list">
      ${results.map((result) => {
        const teamMembers = result.team_members || [];
        const lapGroups = resultLapGroups(result);
        const displayName = teamMembers.length ? "Mannschaft" : `${result.participant_name} (${birthYearText(result.birth_year)})`;
        const resultPerson = { name: result.participant_name, gender: result.gender, organization: result.organization };
        const resultIdentity = teamMembers.length
          ? `<strong>${displayName}</strong>`
          : `<div class="result-person-identity">${personAvatar(resultPerson)}<strong>${escapeHtml(displayName)}</strong></div>`;
        const details = teamMembers.length
          ? `<div class="result-team-members">${lapGroups.map((group, segmentIndex) => {
            const groupedMembers = group
              .map((position) => teamMembers.find((member) => member.position === position))
              .filter(Boolean);
            const segmentValue = result.segments[segmentIndex];
            const frequency = result.frequencies?.[segmentIndex];
            return `<div class="result-team-group ${group.length > 1 ? "glued" : ""}"><div class="result-team-group-people">${groupedMembers.map((member) => `<span class="result-team-member"><span class="result-team-person">${personAvatar(member)}<span>${member.position}. ${escapeHtml(member.name)} (${birthYearText(member.birth_year)})</span></span></span>`).join("")}</div><span class="result-team-split"><strong>${Number.isInteger(segmentValue) ? formatReviewTime(segmentValue) : "–"}</strong>${Number.isInteger(frequency) ? `<small>${frequency}/min</small>` : ""}</span></div>`;
          }).join("")}</div>`
          : `<div class="result-meta">${escapeHtml(result.age_group)} · ${escapeHtml(result.organization)}</div>`;
        const stoppedTime = result.segments.reduce((sum, value) => sum + (Number.isInteger(value) && value > 0 ? value : 0), 0);
        const expandedDetails = teamMembers.length
          ? (result.note ? `<details class="result-laps-details team-note-details"><summary>Notiz</summary><div class="result-feedback"><strong>Feedback</strong><p>${escapeHtml(result.note)}</p></div></details>` : "")
          : `<details class="result-laps-details"><summary>Details <span>${result.segments.length} Runden</span></summary>${result.note ? `<div class="result-feedback"><strong>Feedback</strong><p>${escapeHtml(result.note)}</p></div>` : ""}<div class="result-segments">${result.segments.map((value, lap) => {
            const group = lapGroups[lap] || [lap + 1];
            const glued = group.length > 1;
            return `<span class="${glued ? "glued-result-lap" : ""}"><span class="result-lap-label">${escapeHtml(disciplineLapGroupLabel(result.discipline, group))}${Number.isInteger(result.frequencies?.[lap]) ? `<small>${result.frequencies[lap]}/min</small>` : ""}</span><strong>${value === null ? "–" : formatTime(value)}</strong></span>`;
          }).join("")}</div></details>`;
        const editButton = !resultsOnly && eventCan(event, "can_edit_results") ? `<button class="button secondary small icon-button edit-result" data-id="${result.id}" aria-label="Ergebnis bearbeiten" title="Bearbeiten">${icon("pencil")}</button>` : "";
        const cardHead = teamMembers.length
          ? `<div class="result-head"><div>${resultIdentity}</div>${editButton}</div>${details}`
          : `<div class="result-head"><div>${resultIdentity}${details}</div>${editButton}</div>`;
        return `<article class="result-card">
        ${cardHead}
        <div class="result-times"><div><span>Gestoppt</span><strong>${formatTime(stoppedTime)}</strong></div><div class="official"><span>Offiziell</span><strong>${result.official_centiseconds == null ? "–" : formatTime(result.official_centiseconds)}</strong></div></div>
        ${expandedDetails}
      </article>`;
      }).join("")}</div>`;
    resultsRoot.innerHTML = `<a class="viewer-list-back" id="viewer-list-back" href="${viewerRoot}" ${resultsOnly ? "" : "data-history-back"}>${icon("arrow-left")} Ergebnisse</a>
      <div class="viewer-list-heading"><div class="viewer-list-title"><p class="eyebrow">${genderName(selected.gender)}</p><h2>${escapeHtml(item.name)}</h2></div>
        <button class="button secondary results-pdf-button" id="create-results-pdf" type="button" ${eventPdfImageReady ? "" : "disabled"}>PDF</button></div>
      ${results.length ? cardView : `<div class="empty">Noch keine Ergebnisse.</div>`}`;
    resultsRoot.querySelectorAll(".edit-result").forEach((button) => button.addEventListener("click", () => {
      const result = results.find((entry) => entry.id === button.dataset.id);
      if (result) openResultEditor(result);
    }));
    document.querySelector("#create-results-pdf").addEventListener("click", () => {
      const headers = [
        "Name",
        "AK",
        ...Array.from({ length: lapCount }, (_, lap) => disciplineLapLabel(selected.discipline, lap + 1)),
        "Gesamtzeit",
      ];
      const rows = results.map((result) => {
        const teamMembers = result.team_members || [];
        const person = teamMembers.length
          ? teamMembers.map((member) => `${member.position}. ${member.name} (${birthYearText(member.birth_year)})`).join(" / ")
          : `${result.participant_name} (${birthYearText(result.birth_year)})`;
        const ageGroup = teamMembers.length
          ? [...new Set(teamMembers.map((member) => member.age_group).filter(Boolean))].join("/")
          : result.age_group;
        const stoppedTime = result.segments.reduce((sum, value) => sum + (Number.isInteger(value) && value > 0 ? value : 0), 0);
        const lapCells = Array.from({ length: lapCount }, () => "–");
        const groups = resultLapGroups(result);
        result.segments.forEach((value, index) => {
          const group = groups[index] || [index + 1];
          const frequency = Number.isInteger(result.frequencies?.[index]) ? `${result.frequencies[index]}/min` : "";
          lapCells[group[0] - 1] = {
            main: value == null ? "–" : formatReviewTime(value),
            secondary: value == null ? "" : frequency,
            tone: "frequency",
            colSpan: group.length,
          };
          group.slice(1).forEach((lap) => { lapCells[lap - 1] = { skip: true }; });
        });
        const timeCell = {
          main: formatTime(stoppedTime),
          bold: true,
          secondary: result.official_centiseconds == null ? "" : `offi. ${formatTime(result.official_centiseconds)}`,
          tone: "muted",
        };
        return [person, ageGroup, ...lapCells, timeCell];
      });
      openPdf(createResultsPdf(event.name, `${item.name} - ${genderName(selected.gender)}`, headers, rows, eventPdfImage));
    });
  }

  function renderContent() {
    if (selected) renderResultList();
    else renderSelection();
  }

  function startManualCooldown() {
    const readyAt = Date.now() + 10_000;
    refreshButton.disabled = true;
    clearInterval(cooldownTimer);
    const updateButton = () => {
      const remaining = Math.ceil((readyAt - Date.now()) / 1000);
      if (remaining <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        refreshButton.disabled = false;
        refreshButton.innerHTML = icon("refresh");
        refreshButton.setAttribute("aria-label", "Ergebnisse aktualisieren");
        refreshButton.title = "Ergebnisse aktualisieren";
      } else {
        refreshButton.innerHTML = icon("refresh");
        refreshButton.setAttribute("aria-label", `Erneut in ${remaining} Sekunden`);
        refreshButton.title = `Erneut in ${remaining} Sekunden`;
      }
    };
    updateButton();
    cooldownTimer = setInterval(updateButton, 1000);
  }

  async function loadResults(silent = false) {
    if (loading) return;
    loading = true;
    try {
      const data = await api(`/events/${id}/results`);
      allResults = data.results;
      renderContent();
    } catch (err) {
      if (!silent) resultsRoot.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    } finally { loading = false; }
  }
  refreshButton.addEventListener("click", () => {
    startManualCooldown();
    loadResults();
  });
  await loadResults();
  if (typeof window.timerFirestoreApi.watchResults === "function") {
    routeCleanup = window.timerFirestoreApi.watchResults(id, (data) => {
      event = data.event || event;
      allResults = data.results || [];
      if (!eventCan(event, "can_view_results")) {
        selected = null;
        overviewHead.hidden = false;
        resultsRoot.innerHTML = `<div class="empty"><strong>Kein Zugriff auf Ergebnisse</strong><p>Die Event-Einstellungen erlauben diese Ansicht für dein Konto nicht.</p></div>`;
        return;
      }
      renderContent();
    }, (error) => {
      resultsRoot.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    });
  } else {
    refreshTimer = setInterval(() => loadResults(true), 60_000);
  }
}

async function renderRoute() {
  if (routeCleanup) {
    routeCleanup();
    routeCleanup = null;
  }
  clearInterval(refreshTimer);
  refreshTimer = null;
  clearInterval(cooldownTimer);
  cooldownTimer = null;
  cancelAnimationFrame(animationFrame);
  app.innerHTML = `<div class="loading">Wird geladen …</div>`;
  const current = route();
  document.body.classList.toggle("timer-page", current.page === "timer");
  document.body.classList.toggle("home-page", current.page === "home");
  document.body.classList.toggle("event-page", current.page === "event");
  document.body.classList.toggle("people-page", current.page === "people");
  document.body.classList.toggle("viewer-page", current.page === "viewer" || current.page === "results");
  document.body.classList.toggle("shared-results-page", current.page === "results");
  document.body.classList.toggle("settings-page", current.page === "settings");
  document.body.classList.remove("viewer-overview");
  setReviewInteractionLock(false);
  setTimerInteractionLock(false);
  try {
    if (current.page === "home") return await renderHome();
    if (!current.id) throw new Error("Die Adresse ist unvollständig.");
    if (current.page === "event") return await renderEvent(current.id);
    if (current.page === "settings") return await renderEventSettings(current.id, current.discipline);
    if (current.page === "people") return await renderPeople(current.id);
    if (current.page === "timer") return await renderTimer(current.id);
    if (current.page === "viewer") return await renderViewer(current.id, current.discipline, current.gender);
    if (current.page === "results") return await renderViewer(current.id, current.discipline, current.gender, { resultsOnly: true });
    throw new Error("Diese Seite gibt es nicht.");
  } catch (error) {
    renderError(error);
  } finally {
    app.focus({ preventScroll: true });
  }
}

document.addEventListener("click", (event) => {
  const accountTrigger = event.target.closest("[data-timer-account-open]");
  if (accountTrigger) {
    if (currentTimerAuth.authenticated && timerAccountDialog && !timerAccountDialog.open) timerAccountDialog.showModal();
    return;
  }
  const backLink = event.target.closest("[data-history-back]");
  if (!backLink) return;
  event.preventDefault();
  if (history.length > 1) history.back();
  else location.href = backLink.href;
});
timerAccountDialog?.querySelector("[data-timer-account-close]")?.addEventListener("click", () => timerAccountDialog.close());
timerAccountDialog?.addEventListener("click", (event) => {
  if (event.target === timerAccountDialog) timerAccountDialog.close();
});
timerAccountLogout?.addEventListener("click", async () => {
  try {
    timerAccountLogout.disabled = true;
    await window.timerFirestoreApi.signOut();
    timerAccountDialog.close();
    await refreshTimerAccount();
    await renderRoute();
    showToast("Du wurdest abgemeldet.");
  } catch (error) {
    showToast(error.message || "Abmelden fehlgeschlagen.");
  } finally {
    timerAccountLogout.disabled = false;
  }
});
window.addEventListener("timer-auth-change", () => refreshTimerAccount().catch(() => {}));
window.addEventListener("hashchange", renderRoute);
window.addEventListener("online", () => syncPendingResults({ includeBlocked: true }).catch(() => {}));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncPendingResults({ includeBlocked: true }).catch(() => {});
});
offlineSyncStatus?.addEventListener("click", async () => {
  try {
    const synced = await syncPendingResults({ includeBlocked: true, notify: true });
    if (synced) return;
    const pending = await getPendingResults();
    const error = pending.find((record) => record.lastError)?.lastError;
    showToast(error ? `Synchronisierung fehlgeschlagen: ${error}` : "Synchronisierung ist weiterhin ausstehend.");
  } catch (error) {
    showToast(`Synchronisierung fehlgeschlagen: ${error.message}`);
  }
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
updateOfflineSyncStatus()
  .then(() => syncPendingResults({ includeBlocked: true }))
  .catch(() => {});
refreshTimerAccount().catch(() => {});
renderRoute();
