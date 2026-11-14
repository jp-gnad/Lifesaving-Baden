const {
  escapeHtml, disciplines, disciplineGroups, disciplinesForEvent, disciplineForResult, enabledDisciplinesForEvent, eventCan, accessLabel, dateText, isPastEvent, formatTime, formatReviewTime, parseTime, disciplineLapLabel, disciplineLapGroupLabel, resultLapGroups
} = window.TimerCore;
const timeInput = window.TimerTimeInput.create({ parseTime });
const { renderGroups: renderParticipantGroups } = window.TimerParticipantPicker.create({ escapeHtml });
const { createResultsPdf, loadEventPdfImage, openPdf } = window.TimerResultsPdf.create({ eventIconUrls });

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

function accessSelect(name, value) {
  return `<label class="field"><span>Zugriff</span><select name="${name}">
    <option value="everyone" ${value === "everyone" ? "selected" : ""}>Jeder</option>
    <option value="authenticated" ${value === "authenticated" ? "selected" : ""}>Standard und höher</option>
    <option value="athlete" ${value === "athlete" ? "selected" : ""}>Sportler und höher</option>
    <option value="trainer" ${value === "trainer" ? "selected" : ""}>Trainer und höher</option>
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
const organizationCapMatchers = organizationCaps.map(([file, aliases]) => ({
  file, aliases: aliases.map((alias) => normalizedIdentity(alias)),
}));

const eventAssetBase = "https://raw.githubusercontent.com/jp-gnad/Lifesaving_Baden/main/web/assets/png/events/";

let refreshTimer = null;
let cooldownTimer = null;
let animationFrame = null;
let toastTimer = null;
let dialogScrollPosition = null;
let dialogReleaseFrame = null;
let dialogRestoreTimer = null;
let routeCleanup = null;
let routeVersion = 0;
let activeResultView = null;
let eventListTab = "current";
let currentTimerAuth = { user: null, authenticated: false, isOrganizer: false, isAdmin: false, role: "guest" };
let metadataVersion = 0;

const eventCache = window.TimerEventCache.create({
  load: async (id) => (await api(`/events/${encodeURIComponent(id)}?participants=0`)).event,
});
const saveQueue = window.TimerSaveQueue.create({
  store: window.TimerOfflineStore,
  request: api,
  getAccountId: async () => {
    const context = await window.timerFirestoreApi.getAuthContext();
    const id = window.timerFirestoreApi.getActiveAccountId();
    if ((context.user?.uid || null) !== id) throw new Error("Die Anmeldung wird gerade aktualisiert. Bitte erneut versuchen.");
    return id;
  },
  online: () => navigator.onLine,
  newId: () => crypto.randomUUID(),
  changed: updateOfflineSyncStatus,
  failed: (record, error) => showToast(`Übertragung ausstehend: ${error.message}`),
  completed: (record) => {
    if (record.operation?.path === `/events/${encodeURIComponent(record.eventId)}`) {
      if (record.operation.method === "PATCH") {
        eventCache.refresh(record.eventId).catch(() => {});
        saveQueue.sync({ includeBlocked: true }).catch(() => {});
      }
    }
  },
});

const peopleView = window.TimerPeopleView.create({
  app, api, saveInBackground, renderParticipantGroups, eventCan, compareParticipantsByOrganization, personAvatar, birthYearText, escapeHtml, icon, setDocumentTitle, showToast, bindDialogClose, openDialog, normalizedIdentity,
  getRouteVersion: () => routeVersion,
  setRouteCleanup: (cleanup) => { routeCleanup = cleanup; },
  refresh: () => renderRoute(),
  validateParticipant: (values) => window.timerFirestoreApi.validateParticipant(values),
});

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="./icons.svg?v=event-settings#${name}"></use></svg>`;
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
  const match = organizationCapMatchers.find(({ aliases }) => aliases.some((normalizedAlias) => {
    return normalizedOrganization.includes(normalizedAlias)
      || (normalizedOrganization.length >= 4 && normalizedAlias.includes(normalizedOrganization));
  }));
  return match ? `${capAssetBase}${encodeURIComponent(match.file)}` : null;
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
  return new URL("../login.html", window.location.href).href;
}

function timerAccountName(context = currentTimerAuth) {
  return context?.accountName || "Mitglied";
}

function timerAccountRole(context = currentTimerAuth) {
  if (context?.roleLabel) return context.roleLabel;
  if (context?.isAdmin) return "Admin";
  if (context?.isOrganizer) return "Organisator";
  return context?.authenticated ? "Standard" : "Nicht angemeldet";
}

function timerAccountAvatar(context = currentTimerAuth) {
  const user = context?.user;
  if (user?.photoURL) return `<img src="${escapeHtml(user.photoURL)}" alt="">`;
  return `<span>${escapeHtml(personInitials(timerAccountName(context)))}</span>`;
}

function renderTimerAccount(context) {
  currentTimerAuth = context || currentTimerAuth;
  const authError = document.querySelector("[data-timer-auth-error]");
  if (authError) {
    authError.hidden = !currentTimerAuth.authError;
    authError.textContent = currentTimerAuth.authError || "";
  }
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
  ["admin", "organizer", "trainer", "athlete", "standard"].forEach((role) => {
    roleElement.classList.toggle(`is-role-${role}`, currentTimerAuth.role === role);
  });
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
  const requestVersion = metadataVersion;
  try {
    if (!window.timerFirestoreApi) throw new Error("Firebase wurde nicht geladen.");
    const response = await window.timerFirestoreApi.request(path, options);
    if (requestVersion === metadataVersion && String(options.method || "GET").toUpperCase() === "GET") {
      await applyPendingView(response);
      if (requestVersion !== metadataVersion) throw Object.assign(new Error("Die Anmeldung hat sich geändert. Bitte erneut öffnen."), { status: 409 });
      if (response.event && response.participants && !path.includes("participants=0")) response.event.participant_count = response.participants.length;
      if (response.event) eventCache.remember(response.event);
      response.events?.forEach((event) => eventCache.remember(event));
    }
    return response;
  } catch (cause) {
    if (cause?.status) throw cause;
    const error = new Error(cause?.message || "Keine Internetverbindung.");
    error.isNetworkError = !navigator.onLine;
    error.status = cause?.status || 503;
    error.cause = cause;
    throw error;
  }
}

async function applyPendingView(response) {
  if (!response.event && !response.events) return;
  const pending = await saveQueue.list().catch(() => []);
  const projectEvent = (event) => {
    for (const record of pending) {
      if (record.eventId === event.id && record.operation?.path === `/events/${encodeURIComponent(event.id)}` && record.operation.method === "PATCH") {
        event = window.timerFirestoreApi.previewEventUpdate(event, record.payload);
      }
    }
    return event;
  };
  if (response.events) {
    const events = new Map(response.events.map((event) => [event.id, event]));
    for (const record of pending) {
      if (record.operation?.path === "/events" && record.operation.method === "POST") events.set(record.eventId, window.timerFirestoreApi.previewEvent(record.eventId, record.payload));
      if (record.operation?.path === `/events/${encodeURIComponent(record.eventId)}` && record.operation.method === "DELETE") events.delete(record.eventId);
    }
    response.events = [...events.values()].map(projectEvent);
  }
  if (!response.event) return;
  response.event = projectEvent(response.event);
  if (!response.participants) return;
  const people = new Map(response.participants.map((person) => [person.id, person]));
  const prefix = `/events/${encodeURIComponent(response.event.id)}/participants`;
  for (const record of pending) {
    const operation = record.operation;
    if (!operation || record.eventId !== response.event.id || !operation.path.startsWith(prefix)) continue;
    const imported = operation.path === `${prefix}/import` && operation.method === "POST";
    const payload = imported ? record.payload.previewParticipant : record.payload;
    const personId = operation.path === prefix || imported ? record.clientSubmissionId : decodeURIComponent(operation.path.slice(prefix.length + 1));
    if (operation.method === "DELETE") people.delete(personId);
    else if (payload?.name && payload.gender) people.set(personId, { ...people.get(personId), id: personId,
      name: payload.name, birth_year: Number(payload.birthYear) % 100, age_group: payload.ageGroup,
      gender: payload.gender, organization: payload.organization });
  }
  response.participants = [...people.values()];
}

async function updateOfflineSyncStatus() {
  if (!offlineSyncStatus || !offlineSyncText) return;
  try {
    const pending = await saveQueue.list();
    const hasError = pending.some((record) => record.blocked || record.lastError);
    offlineSyncStatus.hidden = !pending.length || (navigator.onLine && !hasError);
    offlineSyncStatus.classList.toggle("has-error", hasError);
    if (offlineSyncStatus.hidden) return;
    if (!navigator.onLine) {
      offlineSyncText.textContent = `Offline · ${pending.length} ${pending.length === 1 ? "Änderung wartet" : "Änderungen warten"}`;
    } else if (saveQueue.isSyncing()) {
      offlineSyncText.textContent = "Übertragung wird erneut versucht …";
    } else {
      offlineSyncText.textContent = `${pending.length} ${pending.length === 1 ? "Änderung nicht übertragen" : "Änderungen nicht übertragen"} · Erneut versuchen`;
    }
  } catch {
    offlineSyncStatus.hidden = true;
  }
}

async function syncPendingResults(options = {}) {
  const synced = await saveQueue.sync(options);
  if (options.notify && synced) showToast(`${synced} ${synced === 1 ? "Vorgang wurde" : "Vorgänge wurden"} synchronisiert.`);
  return synced;
}

async function saveResultOfflineFirst(eventId, payload) {
  return saveQueue.enqueue(eventId, payload);
}

async function saveInBackground(eventId, path, method, payload = {}) {
  return saveQueue.enqueue(eventId, payload, { path, method });
}

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { page: parts[0] || "home", id: parts[1] || null, discipline: parts[2] || null, gender: parts[3] || null };
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
  const version = routeVersion;
  setDocumentTitle("");
  const [firstPage, authContext] = await Promise.all([
    api("/events"),
    window.timerFirestoreApi.getAuthContext(),
  ]);
  if (version !== routeVersion) return;
  const events = firstPage.events;
  let nextCursor = firstPage.nextCursor;
  let hasMore = firstPage.hasMore === true;
  let disposed = false;
  app.innerHTML = `
    <div class="page-head">
      <h1>Events</h1>
      <button class="button secondary icon-button" id="copy-overview-link" type="button" aria-label="Link zur Eventübersicht kopieren" title="Link zur Eventübersicht kopieren">${icon("link")}</button>
      ${authContext.isOrganizer ? `<button class="button" id="new-event">${icon("plus")} Neues Event</button>` : ""}
    </div>
    <div class="event-tabs" role="tablist" aria-label="Events nach Datum">
      <button type="button" id="events-current-tab" role="tab" data-event-tab="current" aria-controls="event-list">Aktuell</button>
      <button type="button" id="events-past-tab" role="tab" data-event-tab="past" aria-controls="event-list">Vergangene</button>
    </div>
    <section class="section event-list-section" id="event-list" role="tabpanel" tabindex="0"></section>
    <div class="list-pagination"><span id="event-page-status" role="status"></span><button class="button secondary" id="more-events" type="button" ${hasMore ? "" : "hidden"}>Weitere Events laden</button></div>
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

  const eventList = document.querySelector("#event-list");
  const eventTabs = [...document.querySelectorAll("[data-event-tab]")];
  const renderEventList = () => {
    const now = new Date();
    const past = eventListTab === "past";
    const visibleEvents = events.filter((event) => isPastEvent(event, now) === past);
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    visibleEvents.sort((left, right) => {
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
    eventTabs.forEach((button) => {
      const active = button.dataset.eventTab === eventListTab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    eventList.setAttribute("aria-labelledby", `events-${eventListTab}-tab`);
    eventList.innerHTML = visibleEvents.length ? `<div class="stack">${visibleEvents.map((event) => `
        <a class="card event-row" href="#/event/${encodeURIComponent(event.id)}" aria-label="${escapeHtml(event.name)} öffnen">
          <div class="event-row-content">${eventIconMarkup(event, "event-list-icon")}<div class="event-row-copy"><h3>${escapeHtml(event.name)}</h3><div class="event-meta">
            <span class="meta-item">${icon("calendar")} ${escapeHtml(dateText(event.event_date))}</span>
            ${event.location ? `<span class="meta-item">${icon("location")} ${escapeHtml(event.location)}</span>` : ""}
          </div></div></div>
          <span class="event-row-arrow">${icon("arrow-right")}</span>
        </a>`).join("")}</div>` : `<div class="empty">${!events.length
      ? `Noch kein Event vorhanden.${authContext.isOrganizer ? " Lege das erste Event an." : ""}`
      : hasMore ? "Auf den geladenen Seiten gibt es hier keine Events. Weitere Events können nachgeladen werden."
      : past ? "Noch keine vergangenen Events vorhanden." : "Keine aktuellen Events vorhanden."}</div>`;
  };
  const moreEvents = document.querySelector("#more-events");
  const pageStatus = document.querySelector("#event-page-status");
  const updatePageStatus = () => {
    moreEvents.hidden = !hasMore;
    pageStatus.textContent = hasMore ? `${events.length} Events geladen` : "";
  };
  updatePageStatus();
  moreEvents.addEventListener("click", async () => {
    if (disposed || moreEvents.disabled || !hasMore) return;
    moreEvents.disabled = true;
    try {
      const page = await api(`/events?cursor=${encodeURIComponent(nextCursor)}`);
      if (disposed) return;
      const existing = new Set(events.map((event) => event.id));
      events.push(...page.events.filter((event) => !existing.has(event.id)));
      nextCursor = page.nextCursor;
      hasMore = page.hasMore === true;
      renderEventList();
      updatePageStatus();
    } catch (error) {
      if (!disposed) pageStatus.textContent = error.message;
    } finally { if (!disposed) moreEvents.disabled = false; }
  });
  eventTabs.forEach((button, index) => {
    const select = () => {
      eventListTab = button.dataset.eventTab;
      eventList.scrollTop = 0;
      renderEventList();
    };
    button.addEventListener("click", select);
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === "Home" ? 0 : event.key === "End" ? eventTabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + eventTabs.length) % eventTabs.length;
      eventTabs[target].click();
      eventTabs[target].focus();
    });
  });
  let midnightTimer;
  const refreshEventDates = () => {
    renderEventList();
    clearTimeout(midnightTimer);
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    midnightTimer = setTimeout(refreshEventDates, midnight.getTime() - now.getTime() + 50);
  };
  const resumeEventDates = () => {
    if (document.visibilityState === "visible") refreshEventDates();
  };
  document.addEventListener("visibilitychange", resumeEventDates);
  routeCleanup = () => {
    disposed = true;
    clearTimeout(midnightTimer);
    document.removeEventListener("visibilitychange", resumeEventDates);
  };
  refreshEventDates();

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
      // Validate locally with the same defaults as the adapter, then persist
      // the command before leaving the form. The ID survives every retry.
      window.timerFirestoreApi.previewEvent("draft", values);
      const created = await saveInBackground(null, "/events", "POST", values);
      if (version !== routeVersion) return;
      created.id = created.clientSubmissionId;
      eventCache.remember(window.timerFirestoreApi.previewEvent(created.id, values));
      dialog.close();
      history.pushState(null, "", `#/event/${created.id}`);
      location.hash = `#/settings/${created.id}`;
    } catch (err) {
      if (version !== routeVersion) return;
      error.textContent = err.message;
      submit.disabled = false;
    }
  });
}

async function renderEvent(id) {
  const version = routeVersion;
  const event = await eventCache.read(id);
  if (version !== routeVersion) return;
  setDocumentTitle(event.name);
  app.innerHTML = `
    <div class="page-head event-page-head"><div><div class="event-title-row">${eventIconMarkup(event, "event-title-icon")}<h1>${escapeHtml(event.name)}</h1><button class="button secondary icon-button" id="copy-event-link" type="button" aria-label="Event-Link kopieren" title="Event-Link kopieren">${icon("link")}</button>${eventCan(event, "can_manage_event") ? `<a class="button secondary icon-button" href="#/settings/${id}" aria-label="Event-Einstellungen" title="Event-Einstellungen">${icon("settings")}</a>` : ""}</div>
      <p class="event-summary">${escapeHtml(dateText(event.event_date))} · ${event.location ? escapeHtml(event.location) : "Kein Ort"} · ${eventCan(event, "can_view_participants") || eventCan(event, "can_use_timer") ? `${Number.isInteger(event.participant_count) ? `${event.participant_count} ` : ""}Personen` : "Personen geschützt"}</p></div>
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
  const version = routeVersion;
  const event = await eventCache.read(id);
  if (version !== routeVersion) return;
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
    const renderCheck = ([disciplineId, item]) => `<label class="settings-check"><input type="checkbox" name="enabledDisciplines" value="${disciplineId}" ${enabledDisciplines.has(disciplineId) ? "checked" : ""}><span>${escapeHtml(item.name)}</span></label>`;
    const standard = entries.filter(([, item]) => !item.additional).map(renderCheck).join("");
    const additional = entries.filter(([, item]) => item.additional).map(renderCheck).join("");
    return `<fieldset class="settings-section discipline-settings"><legend>${escapeHtml(group.name)}</legend><div class="discipline-settings-list">${standard}</div>${additional ? `<details class="additional-disciplines"><summary>Weitere Disziplinen</summary><div class="discipline-settings-list">${additional}</div></details>` : ""}</fieldset>`;
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
      </div><label class="field custom-pool-length" ${poolLength === "custom" ? "" : "hidden"}><span>Bahnlänge in Metern</span><input id="custom-pool-length" name="customPoolLength" type="number" min="1" max="10000" step="0.01" inputmode="decimal" value="${escapeHtml(event.custom_pool_length ?? "")}"></label></div></fieldset>`;
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
      const preview = window.timerFirestoreApi.previewEventUpdate(event, payload);
      await saveInBackground(id, `/events/${encodeURIComponent(id)}`, "PATCH", payload);
      if (version !== routeVersion) return;
      eventCache.remember(preview);
      if (activeSection && history.length > 2) history.go(-2);
      else if (activeSection) location.hash = `#/event/${id}`;
      else if (history.length > 1) history.back();
      else location.hash = `#/event/${id}`;
    } catch (err) {
      if (version !== routeVersion) return;
      error.textContent = err.message;
      submitButton.disabled = false;
    }
  });
  document.querySelector("#delete-event-settings")?.addEventListener("click", async (deleteEvent) => {
    const button = deleteEvent.currentTarget;
    if (!confirm(`Event „${event.name}“ mit allen Personen und Ergebnissen unwiderruflich löschen?`)) return;
    try {
      button.disabled = true;
      await saveInBackground(id, `/events/${encodeURIComponent(id)}`, "DELETE");
      if (version !== routeVersion) return;
      eventCache.forget(id);
      location.hash = "#/";
    } catch (err) {
      if (version !== routeVersion) return;
      document.querySelector("#event-settings-error").textContent = err.message;
      button.disabled = false;
    }
  });
}

async function renderPeople(id, viewData = null) {
  return peopleView.render(id, viewData);
}

async function renderTimer(id) {
  const version = routeVersion;
  const [event, authContext] = await Promise.all([
    eventCache.read(id),
    window.timerFirestoreApi.getAuthContext(),
  ]);
  if (version !== routeVersion) return;
  currentTimerAuth = authContext;
  if (!eventCan(event, "can_use_timer")) {
    setDocumentTitle(`Kein Timer-Zugriff – ${event.name}`);
    app.innerHTML = `<div class="timer-shell"><div class="timer-topbar"><a class="button secondary icon-button" href="#/event/${id}" data-history-back aria-label="Eine Ansicht zurück">${icon("arrow-left")}</a></div><div class="card timer-disabled"><h1>Kein Zugriff</h1><p>Die Zugriffsrechte dieses Events erlauben die Zeitnahme für dein Konto nicht.</p></div></div>`;
    setTimerInteractionLock(true);
    return;
  }
  const disciplines = disciplinesForEvent(event);
  const participants = [];
  const localParticipantDrafts = new Map();
  let participantsReady = false;
  let participantsLoading = null;
  let participantLoadError = "";
  let refreshReviewParticipants = null;
  function loadTimerParticipants() {
    if (participantsLoading) return participantsLoading;
    participantLoadError = "";
    participantsLoading = api(`/events/${encodeURIComponent(id)}`).then((data) => {
      if (version !== routeVersion) return;
      participants.splice(0, participants.length, ...data.participants);
      for (const person of localParticipantDrafts.values()) {
        if (!participants.some((candidate) => candidate.id === person.id)) participants.push(person);
      }
      participants.sort(compareParticipantsByOrganization);
      participantsReady = true;
    }).catch((error) => {
      if (version === routeVersion) participantLoadError = error.message;
    }).finally(() => {
      participantsLoading = null;
      if (version === routeVersion) refreshReviewParticipants?.();
    });
    return participantsLoading;
  }
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
        <div class="timer-corrections"><button class="undo-lap" id="undo-lap" type="button" aria-label="Letzte Runde zurücknehmen" title="Letzte Runde zurücknehmen" disabled>${icon("undo")}</button><button class="review-result" id="review-result" type="button" aria-label="Ergebnis prüfen" title="Ergebnis prüfen" disabled>${icon("arrow-right")}</button></div>
      </section>
      <div class="card lap-list" id="lap-list" hidden></div>
      <dialog id="discipline-dialog"><div class="dialog-body mode-dialog-body"><div class="mode-dialog-header"><button class="button secondary icon-button" id="mode-back" type="button" aria-label="Zurück zu den Kategorien" hidden>${icon("arrow-left")}</button><h2 id="mode-dialog-title">Stoppmodus</h2><button class="button secondary icon-button" id="close-mode" aria-label="Menü schließen">${icon("x")}</button></div>
        <div class="discipline-list" id="mode-category-list"></div>
        <div class="discipline-list" id="mode-discipline-list" hidden></div>
      </div></dialog>
      </div>
      <section class="review-view" id="review-view" hidden></section>
    </div>`;

  const elements = Object.fromEntries(["timer-view", "review-view", "mode-button", "mode-name", "mode-laps", "discipline-dialog", "clock-status", "clock", "frequency-progress", "left-action", "right-action", "undo-lap", "review-result", "progress", "lap-list"].map((key) => [key, document.querySelector(`#${key}`)]));
  let frequencyFeedbackTimer = null;

  const currentCs = () => timer.status === "running" ? timer.displayed + Math.floor((performance.now() - timer.startedAt) / 10) : timer.displayed;
  const capturedTotal = () => timer.segments.reduce((sum, value) => sum + value, 0);
  const config = () => disciplines[timer.discipline];
  const modeTitle = document.querySelector("#mode-dialog-title");
  const modeBack = document.querySelector("#mode-back");
  const modeCategoryList = document.querySelector("#mode-category-list");
  const modeDisciplineList = document.querySelector("#mode-discipline-list");

  function canSelectDiscipline(disciplineId) {
    if (!enabledDisciplineIds.includes(disciplineId) || timer.status === "stopped") return false;
    // Completed segments plus the live lap must fit into the new discipline.
    return disciplines[disciplineId].laps > timer.segments.length;
  }

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
      const detail = isNormal ? "max. 20 Laps" : `${groupDisciplines.filter((item) => !item.additional).length} Disziplinen${groupDisciplines.some((item) => item.additional) ? " + weitere" : ""}`;
      const action = isNormal ? `data-discipline="${enabledDisciplineIds.find((disciplineId) => disciplines[disciplineId].group === "normal")}"` : `data-mode-group="${group.id}"`;
      const trailingIcon = selected ? icon("check") : (isNormal ? "" : icon("arrow-right"));
      const selectable = enabledDisciplineIds.some((disciplineId) => disciplines[disciplineId].group === group.id && canSelectDiscipline(disciplineId));
      return `<button class="discipline-choice mode-category ${selected ? "selected" : ""}" type="button" ${action} ${selectable ? "" : "disabled"}><span><strong>${group.name}</strong><small>${detail}${selectable ? "" : " · Zu wenige Runden"}</small></span><span class="choice-check">${trailingIcon}</span></button>`;
    }).join("");
  }

  function renderModeGroup(groupId, { allowBack = true } = {}) {
    const group = disciplineGroups.find((item) => item.id === groupId);
    if (!group) return;
    modeTitle.textContent = group.name;
    modeBack.hidden = !allowBack;
    modeCategoryList.hidden = true;
    modeDisciplineList.hidden = false;
    const entries = Object.entries(disciplines)
      .filter(([disciplineId, item]) => item.group === groupId && enabledDisciplineIds.includes(disciplineId));
    const renderChoice = ([disciplineId, item]) => {
      const selected = disciplineId === timer.discipline;
      const selectable = canSelectDiscipline(disciplineId);
      return `<button class="discipline-choice ${selected ? "selected" : ""}" type="button" data-discipline="${disciplineId}" ${selectable ? "" : "disabled"}><span><strong>${item.name}</strong><small>${item.flexible ? "max. " : ""}${item.laps} Laps${selectable ? "" : ` · Zu kurz für Runde ${timer.segments.length + 1}`}</small></span><span class="choice-check">${selected ? icon("check") : ""}</span></button>`;
    };
    const standard = entries.filter(([, item]) => !item.additional).map(renderChoice).join("");
    const additional = entries.filter(([, item]) => item.additional).map(renderChoice).join("");
    modeDisciplineList.innerHTML = standard + (additional ? `<details class="additional-disciplines"><summary>Weitere Disziplinen</summary><div class="discipline-list">${additional}</div></details>` : "");
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
        return `<div class="lap-row ${isCurrent ? "current" : ""}"><span>${escapeHtml(disciplineLapLabel(timer.discipline, index + 1, event))}</span>${lapValues(time, index, isCurrent, value === undefined && !isCurrent)}</div>`;
      }).join("");
      return;
    }

    elements["lap-list"].hidden = timer.segments.length === 0 && !hasLiveLap;
    const liveRow = hasLiveLap ? `<div class="lap-row current"><span>${escapeHtml(disciplineLapLabel(timer.discipline, timer.segments.length + 1, event))}</span>${lapValues(formatTime(currentCs() - capturedTotal()), timer.segments.length, true)}</div>` : "";
    const completedRows = timer.segments.map((value, index) => ({ value, index })).reverse().map(({ value, index }) => {
      return `<div class="lap-row"><span>${escapeHtml(disciplineLapLabel(timer.discipline, index + 1, event))}</span>${lapValues(formatTime(value), index)}</div>`;
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
    elements["mode-button"].disabled = timer.status === "stopped";
    elements["undo-lap"].disabled = timer.status !== "running" || timer.segments.length === 0;
    elements["review-result"].disabled = timer.status !== "stopped";
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
    refreshReviewParticipants = null;
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

  function undoLap() {
    if (timer.status !== "running" || timer.segments.length === 0) return;
    timer.segments.pop();
    // Frequency measurements belong to the discarded boundaries. Start a fresh
    // capture for the combined live lap, without changing the stopwatch origin.
    timer.frequencies.length = timer.segments.length;
    timer.lapGroups = [];
    resetFrequencyCapture();
    renderLaps(); updateProgress(); updateControls();
  }

  function reopenReview() {
    if (timer.status !== "stopped") return;
    // Keep the existing editor and its assignments/drafts when switching back.
    elements["timer-view"].hidden = true;
    elements["review-view"].hidden = false;
    setTimerInteractionLock(false);
    setReviewInteractionLock(true);
    setDocumentTitle(`Ergebnis prüfen – ${event.name}`);
    window.scrollTo(0, 0);
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
    const optionMarkup = () => participants.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join("");
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
      <div class="field official-time-field"><label for="official-time">Offizielle Zeit</label><input id="official-time" inputmode="numeric" enterkeyhint="done" placeholder="z. B. 1:23,45" value="${timer.officialTime === null ? "" : formatTime(timer.officialTime)}" aria-describedby="save-error"></div></div>
      ${item.team ? `${assignmentMarkup}<button class="button secondary add-review-person" id="new-review-person" type="button">${icon("user-plus")} Neue Person</button>` : `<div class="review-assignment-row">${assignmentMarkup}<button class="button secondary add-review-person" id="new-review-person" type="button">${icon("user-plus")} Neu</button></div>`}
      <label class="field review-note-field" for="result-note"><span>Notiz <small>optional</small></span><textarea id="result-note" maxlength="300" rows="2" placeholder="Kurzes Feedback">${escapeHtml(timer.note)}</textarea></label>
      <p class="form-error" id="save-error" role="alert"></p>
      <p class="muted small" id="review-participant-status" role="status"></p><button class="button secondary small" id="retry-review-participants" type="button" hidden>Personen erneut laden</button>
      <div class="form-actions save-actions"><button class="button" id="save-result" ${participants.length >= (item.team ? 4 : 1) ? "" : "disabled"}>${icon("save")} Ergebnis speichern</button></div></section>
      <section class="review-editor" id="review-editor" hidden>
        <div class="review-tools"><div class="time-mode-toggle" role="group" aria-label="Zeitdarstellung"><button type="button" class="active" data-time-mode="segment" aria-pressed="true">Abschnitte</button><button type="button" data-time-mode="cumulative" aria-pressed="false">Kumuliert</button></div><div class="review-mode-actions"><button class="button secondary small glue-mode-toggle" id="glue-mode" type="button" aria-pressed="false">${icon("link")} Link</button><button class="button secondary small" id="finish-edit" type="button">${icon("check")} Fertig</button></div></div>
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
    let savingResult = false;
    let activeParticipantSelect = null;
    let participantGenderFilter = "";
    let preferredParticipantGenderFilter = "";
    let preferredParticipantAgeFilter = "";
    let requiredParticipantGenderFilter = "";
    refreshReviewParticipants = () => {
      const status = review.querySelector("#review-participant-status");
      status.textContent = participantsReady ? "" : (participantLoadError || "Personen werden im Hintergrund geladen …");
      status.hidden = participantsReady;
      review.querySelector("#retry-review-participants").hidden = participantsReady || !participantLoadError;
      participantSelects.forEach((select) => {
        const selected = select.value;
        select.innerHTML = `<option value="">Auswählen …</option>${optionMarkup()}`;
        select.value = selected;
        updateParticipantTrigger(select);
      });
      saveResult.disabled = savingResult || participants.length < (item.team ? 4 : 1);
      renderParticipantAgeFilter();
      renderParticipantPicker();
    };
    review.querySelector("#retry-review-participants").addEventListener("click", () => {
      loadTimerParticipants();
      refreshReviewParticipants();
    });

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
      participantPickerList.innerHTML = renderParticipantGroups(matches, (person) => {
        const assignedElsewhere = participantSelects.find((select) => select !== activeParticipantSelect && select.value === person.id);
        const selected = activeParticipantSelect?.value === person.id;
        return `<button class="participant-picker-option ${selected ? "selected" : ""}" type="button" data-person-id="${escapeHtml(person.id)}" role="option" aria-selected="${selected}" ${assignedElsewhere ? "disabled" : ""}><span class="participant-picker-main">${personAvatar(person)}<span class="participant-picker-copy"><strong>${escapeHtml(participantName(person))}</strong><small>${escapeHtml(person.organization)} · ${escapeHtml(person.age_group)} · ${person.gender === "male" ? "m" : "w"}</small></span></span>${assignedElsewhere ? `<small>Position ${participantSelects.indexOf(assignedElsewhere) + 1}</small>` : (selected ? icon("check") : icon("arrow-right"))}</button>`;
      });
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
          group.value = timeInput.parse(timeText) ?? Number.NaN;
        } else {
          const cumulative = timeInput.parse(timeText);
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
          : (timeMode === "segment" ? formatTime(group.value) : formatTime(cumulative));
        const range = disciplineLapGroupLabel(timer.discipline, group.laps, event);
        const glueButton = glueMode && index < lapGroups.length - 1
          ? `<button class="glue-next" type="button" data-glue-index="${index}" aria-label="${escapeHtml(range)} mit ${escapeHtml(disciplineLapGroupLabel(timer.discipline, lapGroups[index + 1].laps, event))} verbinden" title="Mit nächster Runde verbinden">${icon("link")}</button>`
          : "";
        const values = editMode
          ? `<div class="review-lap-inputs"><label><span>${timeMode === "segment" ? "Zeit" : "Kumuliert"}</span><input class="segment-input" id="segment-${index}" inputmode="numeric" enterkeyhint="next" value="${displayedTime}" aria-label="Zeit ${range}" aria-describedby="save-error"></label><label><span>Freq.</span><input class="frequency-input" id="frequency-${index}" inputmode="numeric" value="${Number.isInteger(group.frequency) ? group.frequency : ""}" aria-label="Frequenz ${range}" aria-describedby="save-error"></label></div>`
          : `<div class="review-lap-values"><strong>${displayedTime || "–"}</strong>${Number.isInteger(group.frequency) ? `<small>${group.frequency}/min</small>` : ""}<input class="segment-input" id="segment-${index}" type="hidden" value="${displayedTime}"><input class="frequency-input" id="frequency-${index}" type="hidden" value="${Number.isInteger(group.frequency) ? group.frequency : ""}"></div>`;
        return `<div class="field review-lap-field ${group.laps.length > 1 ? "glued" : ""} ${editMode ? "editable" : ""}"><div class="review-lap-title"><strong>${escapeHtml(range)}</strong>${glueButton}</div>${values}</div>`;
      }).join("");
      editTimes.querySelectorAll(".frequency-input").forEach((input) => input.addEventListener("input", () => readCorrections(false)));
      editTimes.querySelectorAll(".segment-input").forEach((input) => timeInput.bind(input, () => readCorrections(false)));
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
      const officialTime = officialText ? timeInput.parse(officialText) : null;
      const invalidSegments = segments.some((value) => value !== null && (!Number.isInteger(value) || value <= 0));
      const missingSegments = !segments.some((value) => Number.isInteger(value) && value > 0);
      const invalidFrequencies = frequencies.some((value) => Number.isNaN(value));
      const invalidOfficialTime = Boolean(officialText) && (officialTime === null || officialTime <= 0);
      const stoppedTime = segments.reduce((sum, value) => sum + (Number.isInteger(value) && value > 0 ? value : 0), 0);
      review.querySelector("#save-total").textContent = formatTime(stoppedTime);
      review.querySelector("#save-error").textContent = showError
        ? (invalidSegments || missingSegments
          ? (timeMode === "segment"
            ? "Abschnittszeiten bitte als m:ss,00 eingeben. Trennzeichen werden beim Tippen ergänzt. Leere Runden sind erlaubt."
            : "Kumulierte Zeiten als m:ss,00 eingeben. Trennzeichen werden beim Tippen ergänzt. Leere Runden sind erlaubt.")
          : (invalidOfficialTime
            ? "Bitte eine gültige Zeit im Format m:ss,00 eingeben."
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
    timeInput.bind(officialInput, () => readCorrections(false));
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
        window.timerFirestoreApi.validateParticipant(values);
        const created = await saveInBackground(id, `/events/${encodeURIComponent(id)}/participants`, "POST", values);
        if (version !== routeVersion) return;
        const person = { id: created.clientSubmissionId, name: values.name, birth_year: Number(values.birthYear), age_group: values.ageGroup, gender: values.gender, organization: values.organization };
        localParticipantDrafts.set(person.id, person);
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
      } catch (err) {
        if (version !== routeVersion) return;
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
      const button = event.currentTarget;
      if (savingResult) return;
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
        savingResult = true;
        button.disabled = true;
        const assignment = item.team ? { participantIds } : { participantId: participantIds[0] };
        await saveResultOfflineFirst(id, { ...assignment, discipline: timer.discipline, segments: corrections.segments, frequencies: corrections.frequencies, lapGroups: corrections.lapGroups, officialTime: corrections.officialTime, note: noteInput.value.trim() });
        if (version !== routeVersion || authContext.user?.uid !== currentTimerAuth.user?.uid) return;
        resetTimer();
      } catch (err) {
        if (version !== routeVersion) return;
        savingResult = false;
        review.querySelector("#save-error").textContent = `Ergebnis konnte nicht sicher auf diesem Gerät gespeichert werden: ${err.message}`;
        button.disabled = false;
      }
    });
    window.scrollTo(0, 0);
    refreshReviewParticipants();
  }

  bindDialogClose(elements["discipline-dialog"]);
  elements["mode-button"].addEventListener("click", () => {
    if (timer.status === "stopped") return;
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
    if (!disciplineChoice || !canSelectDiscipline(disciplineChoice.dataset.discipline)) return;
    timer.discipline = disciplineChoice.dataset.discipline;
    updateMode();
    updateControls();
    elements["discipline-dialog"].close();
  });
  window.TimerControlInput.bindRelease(elements["undo-lap"], undoLap);
  window.TimerControlInput.bindRelease(elements["review-result"], reopenReview);
  window.TimerControlInput.bindRelease(elements["left-action"], () => {
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

  window.TimerControlInput.bindRelease(elements["right-action"], () => {
    if (timer.status === "idle") {
      timer.status = "running";
      timer.startedAt = performance.now();
      timer.displayed = 0;
      timer.segments = [];
      timer.frequencies = [];
      timer.lapGroups = [];
      resetFrequencyCapture();
      elements["clock-status"].textContent = "Läuft";
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
  loadTimerParticipants();
}

async function renderViewer(id, initialDiscipline = null, initialGender = null, options = {}) {
  const version = routeVersion;
  const eventResponse = await api(`/events/${id}?participants=0`);
  if (version !== routeVersion) return;
  let event = eventResponse.event;
  let participants = [];
  let participantsReady = false;
  let participantsLoading = null;
  const isCurrent = () => version === routeVersion;
  const resultsOnly = options.resultsOnly === true;
  const viewerRoot = `#/${resultsOnly ? "results" : "viewer"}/${id}`;
  const officialResultsUrl = safeExternalUrl(event.result_url);
  if (!eventCan(event, "can_view_results")) {
    setDocumentTitle(`Ergebnisse – ${event.name}`);
    app.innerHTML = `${resultsOnly ? "" : `<a class="back" href="#/event/${id}" data-history-back>${icon("arrow-left")} ${escapeHtml(event.name)}</a>`}<div class="empty"><strong>Kein Zugriff auf Ergebnisse</strong><p>Die Event-Einstellungen erlauben diese Ansicht für dein Konto nicht.</p></div>`;
    return;
  }
  let eventPdfImage = null;
  let eventPdfImageReady = false;
  loadEventPdfImage(event).then((image) => {
    if (!isCurrent()) return;
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
    <nav class="list-pagination" aria-label="Ergebnisseiten">
      <button class="button secondary" id="results-previous" type="button" disabled>Zurück</button>
      <span id="results-page-status" role="status">Ergebnisse werden geladen …</span>
      <button class="button secondary" id="results-next" type="button" disabled>Weiter</button>
    </nav>
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
  let pageResults = [];
  let exporting = false;
  let pageIndex = 0;
  let hasMore = false;
  let pagePending = true;
  const previousPage = document.querySelector("#results-previous");
  const nextPage = document.querySelector("#results-next");
  const pageStatus = document.querySelector("#results-page-status");
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
    resultParticipantPickerList.innerHTML = renderParticipantGroups(matches, (person) => {
      const assignedElsewhere = assignmentSelects.find((select) => select !== activeResultParticipantSelect && select.value === person.id);
      const selectedPerson = activeResultParticipantSelect?.value === person.id;
      return `<button class="participant-picker-option ${selectedPerson ? "selected" : ""}" type="button" data-person-id="${escapeHtml(person.id)}" role="option" aria-selected="${selectedPerson}" ${assignedElsewhere ? "disabled" : ""}><span class="participant-picker-main">${personAvatar(person)}<span class="participant-picker-copy"><strong>${escapeHtml(participantName(person))}</strong><small>${escapeHtml(person.organization)} · ${escapeHtml(person.age_group)} · ${person.gender === "male" ? "m" : "w"}</small></span></span>${assignedElsewhere ? `<small>Position ${assignmentSelects.indexOf(assignedElsewhere) + 1}</small>` : (selectedPerson ? icon("check") : icon("arrow-right"))}</button>`;
    });
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
    pageResults.forEach((result) => {
      const key = `${result.discipline}:${result.gender}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const availableDisciplines = Object.entries(disciplines).map(([disciplineId, item]) => ({
      disciplineId,
      item,
      femaleCount: counts.get(`${disciplineId}:female`) || 0,
      maleCount: counts.get(`${disciplineId}:male`) || 0,
    })).filter(({ femaleCount, maleCount }) => hasMore || pageIndex > 0 || femaleCount > 0 || maleCount > 0);
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
    const resultButton = (disciplineId, item, gender, count) => count || hasMore || pageIndex > 0
      ? `<button class="result-choice ${gender === "female" ? "female" : "male"}" data-discipline="${disciplineId}" data-gender="${gender}" aria-label="${escapeHtml(item.name)}, ${genderName(gender)}, ${count} ${count === 1 ? "Ergebnis" : "Ergebnisse"} auf dieser Seite"><strong>${escapeHtml(item.name)}</strong><span>${genderName(gender)}</span></button>`
      : `<span class="result-choice-space" aria-hidden="true"></span>`;
    const renderResultChoice = ({ disciplineId, item, femaleCount, maleCount }) => item.mixed
      ? `<div class="result-selection-row"><button class="result-choice mixed" data-discipline="${disciplineId}" data-gender="mixed" aria-label="${escapeHtml(item.name)}, Mixed, ${femaleCount + maleCount} Ergebnisse auf dieser Seite"><strong>${escapeHtml(item.name)}</strong><span>Mixed</span></button></div>`
      : `<div class="result-selection-row ${disciplineId === "normal" ? "custom-result-row" : ""}">${resultButton(disciplineId, item, "female", femaleCount)}${resultButton(disciplineId, item, "male", maleCount)}</div>`;
    const standard = categoryEntries.filter(({ item }) => !item.additional).map(renderResultChoice).join("");
    const additional = categoryEntries.filter(({ item }) => item.additional).map(renderResultChoice).join("");
    resultsRoot.innerHTML = `<div class="result-selection" aria-label="Ergebnisgruppen">
      <div class="result-category-tabs" role="tablist" aria-label="Ergebnisart">
        <button type="button" role="tab" data-result-category="individual" aria-selected="${resultSelectionCategory === "individual"}" class="${resultSelectionCategory === "individual" ? "active" : ""}">Einzel</button>
        <button type="button" role="tab" data-result-category="team" aria-selected="${resultSelectionCategory === "team"}" class="${resultSelectionCategory === "team" ? "active" : ""}">Mannschaft</button>
      </div>
      ${categoryEntries.length
        ? `<div class="result-selection-group-rows" role="tabpanel">${standard}${additional ? `<details class="additional-disciplines"><summary>Weitere Disziplinen</summary><div class="result-selection-group-rows">${additional}</div></details>` : ""}</div>`
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

  async function openResultEditor(result) {
    try {
      if (!participantsReady) {
        participantsLoading ||= api(`/events/${id}`).finally(() => { participantsLoading = null; });
        const data = await participantsLoading;
        if (!isCurrent()) return;
        participants = data.participants.sort(compareParticipantsByOrganization);
        participantsReady = true;
      }
      if (!eventCan(event, "can_edit_results")) return;
    } catch (error) { if (isCurrent()) showToast(error.message); return; }
    editingResult = result;
    resultEditError.textContent = "";
    resultEditForm.querySelector('button[type="submit"], button:not([type])').disabled = false;
    deleteResultButton.disabled = false;
    const item = disciplineForResult(result, event);
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
    const assignmentControl = (controlId, label, selectedId) => `<div class="field"><label for="${controlId}-picker">${label}</label><button class="participant-picker-trigger result-participant-picker-trigger" id="${controlId}-picker" type="button" data-select-id="${controlId}" aria-haspopup="dialog"><span class="participant-picker-value">Auswählen …</span>${icon("chevron-down")}</button><select class="result-participant-select" id="${controlId}" hidden tabindex="-1" aria-hidden="true"><option value="">Auswählen …</option>${participants.map((person) => `<option value="${escapeHtml(person.id)}" ${person.id === selectedId ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select></div>`;
    const assignmentMarkup = item.team
      ? `<fieldset class="team-assignment result-edit-team-assignment"><legend>Personen</legend>${Array.from({ length: 4 }, (_, index) => assignmentControl(`result-participant-${index + 1}`, `Position ${index + 1}`, selectedParticipantIds[index] || "")).join("")}</fieldset>`
      : assignmentControl("result-participant", "Person", selectedParticipantIds[0] || "");
    const stoppedTime = result.segments.reduce((sum, value) => sum + (Number.isInteger(value) && value > 0 ? value : 0), 0);
    resultEditFields.innerHTML = `
      <div class="result-edit-person"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(disciplines[result.discipline].name)}</span></div>
      <div class="result-edit-assignment">${assignmentMarkup}</div>
      <div class="review-time-summary result-edit-times-summary">
        <div class="field"><span class="label">Gestoppt</span><div class="total-summary"><strong id="result-edit-stopped">${formatTime(stoppedTime)}</strong></div></div>
        <label class="field"><span>Offiziell</span><input id="result-edit-official" inputmode="numeric" placeholder="m:ss,00" value="${result.official_centiseconds == null ? "" : formatTime(result.official_centiseconds)}"></label>
      </div>
      <div class="result-edit-lap-toolbar"><span class="label">Runden</span><div><button class="button secondary small" id="result-edit-glue-mode" type="button" aria-pressed="false">${icon("link")} Link</button><button class="button secondary small" id="result-edit-undo-glue" type="button" hidden>${icon("undo")} Rückgängig</button></div></div>
      <div class="result-edit-laps"></div>
      <label class="field result-edit-note-field"><span>Notiz <small>optional</small></span><textarea id="result-edit-note" maxlength="300" rows="2" placeholder="Kurzes Feedback">${escapeHtml(result.note || "")}</textarea></label>`;
    const assignmentSelects = [...resultEditFields.querySelectorAll(".result-participant-select")];
    assignmentSelects.forEach(updateResultParticipantTrigger);
    resultEditFields.querySelectorAll(".result-participant-picker-trigger").forEach((trigger) => trigger.addEventListener("click", () => {
      openResultParticipantPicker(resultEditFields.querySelector(`#${trigger.dataset.selectId}`));
    }));
    timeInput.bind(resultEditFields.querySelector("#result-edit-official"));
    const updateStoppedTime = () => {
      const values = [...resultEditFields.querySelectorAll(".result-edit-segment")]
        .map((input) => input.value.trim() ? timeInput.parse(input.value) : null);
      const validTotal = values.reduce((sum, value) => sum + (Number.isInteger(value) ? value : 0), 0);
      resultEditFields.querySelector("#result-edit-stopped").textContent = formatTime(validTotal);
    };
    const syncResultEditLapValues = () => {
      const segmentInputs = [...resultEditFields.querySelectorAll(".result-edit-segment")];
      const frequencyInputs = [...resultEditFields.querySelectorAll(".result-edit-frequency")];
      const segments = segmentInputs.map((input) => input.value.trim() ? timeInput.parse(input.value) : null);
      const frequencies = frequencyInputs.map((input) => input.value.trim() ? Number(input.value) : null);
      if (segments.some((value, index) => segmentInputs[index].value.trim() && !Number.isInteger(value))) {
        resultEditError.textContent = "Lap-Zeiten bitte als m:ss,00 eingeben, zum Beispiel 1:23,45.";
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
          <strong>${escapeHtml(disciplineLapGroupLabel(result.discipline, group.laps, result))}</strong>
          <label><span>Zeit</span><input class="result-edit-segment" inputmode="numeric" value="${group.value == null ? "" : formatTime(group.value)}"></label>
          <label><span>Freq.</span><input class="result-edit-frequency" inputmode="numeric" value="${Number.isInteger(group.frequency) ? group.frequency : ""}"></label>
        </div>
        ${resultEditGlueMode && index < resultEditLapGroups.length - 1 ? `<button class="result-edit-glue-next" type="button" data-glue-index="${index}" aria-label="${escapeHtml(disciplineLapGroupLabel(result.discipline, group.laps, result))} mit der nächsten Runde verbinden" title="Mit nächster Runde verbinden">${icon("link")}</button>` : ""}
      </div>`).join("");
      lapsRoot.querySelectorAll(".result-edit-segment").forEach((input) => timeInput.bind(input, updateStoppedTime));
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
    const segments = segmentInputs.map((input) => input.value.trim() ? timeInput.parse(input.value) : null);
    const frequencies = frequencyInputs.map((input) => input.value.trim() ? Number(input.value) : null);
    const lapGroups = resultEditLapGroups.map((group) => [...group.laps]);
    const officialText = resultEditFields.querySelector("#result-edit-official").value.trim();
    const officialTime = officialText ? timeInput.parse(officialText) : null;
    const note = resultEditFields.querySelector("#result-edit-note").value.trim();
    const assignmentSelects = [...resultEditFields.querySelectorAll(".result-participant-select")];
    const participantIds = assignmentSelects.map((select) => select.value);
    const item = disciplineForResult(editingResult, event);
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
      resultEditError.textContent = "Lap-Zeiten bitte als m:ss,00 eingeben, zum Beispiel 1:23,45.";
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
      await saveInBackground(id, `/events/${encodeURIComponent(id)}/results/${encodeURIComponent(editingResult.id)}`, "PATCH",
        { ...assignment, segments, frequencies, lapGroups, officialTime, note });
      if (!isCurrent()) return;
      resultEditDialog.close();
      editingResult = null;
      // The live page receives the committed change without a second query.
    } catch (error) {
      resultEditError.textContent = error.message;
      submitButton.disabled = false;
    }
  });

  deleteResultButton.addEventListener("click", async () => {
    if (!editingResult || !confirm("Dieses Ergebnis unwiderruflich löschen?")) return;
    try {
      deleteResultButton.disabled = true;
      await saveInBackground(id, `/events/${encodeURIComponent(id)}/results/${encodeURIComponent(editingResult.id)}`, "DELETE");
      if (!isCurrent()) return;
      resultEditDialog.close();
      editingResult = null;
      // The live page receives the committed change without a second query.
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
    const results = pageResults.filter((result) => result.discipline === selected.discipline && (item.mixed || result.gender === selected.gender));
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
            return `<span class="${glued ? "glued-result-lap" : ""}"><span class="result-lap-label">${escapeHtml(disciplineLapGroupLabel(result.discipline, group, result))}${Number.isInteger(result.frequencies?.[lap]) ? `<small>${result.frequencies[lap]}/min</small>` : ""}</span><strong>${value === null ? "–" : formatTime(value)}</strong></span>`;
          }).join("")}</div></details>`;
        const editButton = !resultsOnly && eventCan(event, "can_edit_results") ? `<button class="button secondary small icon-button edit-result" data-id="${escapeHtml(result.id)}" aria-label="Ergebnis bearbeiten" title="Bearbeiten">${icon("pencil")}</button>` : "";
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
        <button class="button secondary results-pdf-button" id="create-results-pdf" type="button" ${eventPdfImageReady && !exporting ? "" : "disabled"}>PDF</button></div>
      ${results.length ? cardView : `<div class="empty">${hasMore || pageIndex > 0 ? "Keine Ergebnisse dieser Gruppe auf dieser Seite. Weitere Seiten sind über die Seitennavigation erreichbar." : "Noch keine Ergebnisse."}</div>`}`;
    resultsRoot.querySelectorAll(".edit-result").forEach((button) => button.addEventListener("click", () => {
      const result = results.find((entry) => entry.id === button.dataset.id);
      if (result) openResultEditor(result);
    }));
    document.querySelector("#create-results-pdf").addEventListener("click", async (click) => {
      if (exporting) return;
      exporting = true;
      const button = click.currentTarget;
      const exportSelection = { ...selected };
      button.disabled = true;
      try {
        const all = await window.TimerResultFeed.readAll(
          (cursor) => api(`/events/${id}/results${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
          () => { if (!isCurrent()) throw new Error("Ansicht wurde geschlossen."); },
        );
        const results = all.filter((result) => result.discipline === exportSelection.discipline && (item.mixed || result.gender === exportSelection.gender))
          .sort((left, right) => (left.official_centiseconds ?? left.total_centiseconds) - (right.official_centiseconds ?? right.total_centiseconds) || left.created_at.localeCompare(right.created_at));
        const lapCount = item.flexible || exportSelection.discipline === "obstacle100"
          ? results.reduce((max, result) => Math.max(max, ...resultLapGroups(result).flat(), result.segments.length), 0)
          : item.laps;
        const mixedCourses = exportSelection.discipline === "obstacle100"
          && new Set(results.map((result) => disciplineForResult(result, event).laps)).size > 1;
        const labelContext = exportSelection.discipline === "obstacle100" ? { poolLength: lapCount === 2 ? "50" : "25" } : event;
        const headers = [
          "Name",
          "AK",
          ...Array.from({ length: lapCount }, (_, lap) => mixedCourses ? `${(lap + 1) * 100 / lapCount} m` : disciplineLapLabel(exportSelection.discipline, lap + 1, labelContext)),
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
            const originalGroup = groups[index] || [index + 1];
            const scale = mixedCourses ? lapCount / disciplineForResult(result, event).laps : 1;
            const group = originalGroup.flatMap((lap) => Array.from({ length: scale }, (_, part) => (lap - 1) * scale + part + 1));
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
        openPdf(createResultsPdf(event.name, `${item.name} - ${genderName(exportSelection.gender)}`, headers, rows, eventPdfImage));
      } catch (error) { if (isCurrent()) showToast(error.message); }
      finally {
        exporting = false;
        if (isCurrent()) document.querySelector("#create-results-pdf")?.toggleAttribute("disabled", !eventPdfImageReady);
      }
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

  const feed = window.timerFirestoreApi.watchResults(id, (data) => {
    if (!isCurrent()) return;
    event = data.event;
    pageResults = data.results;
    pageIndex = data.pageIndex;
    hasMore = data.hasMore;
    pagePending = false;
    previousPage.disabled = pageIndex === 0 || !eventCan(event, "can_view_results");
    nextPage.disabled = !hasMore || !eventCan(event, "can_view_results");
    pageStatus.textContent = `Seite ${pageIndex + 1} · ${pageResults.length} Ergebnisse auf dieser Seite (nach Zeit sortiert)`;
    if (!eventCan(event, "can_view_results")) {
      selected = null;
      overviewHead.hidden = false;
      pageStatus.textContent = "";
      resultsRoot.innerHTML = `<div class="empty"><strong>Kein Zugriff auf Ergebnisse</strong><p>Die Event-Einstellungen erlauben diese Ansicht für dein Konto nicht.</p></div>`;
      return;
    }
    renderContent();
  }, (error) => {
    if (!isCurrent()) return;
    pageResults = [];
    hasMore = false;
    pagePending = false;
    refreshButton.disabled = false;
    previousPage.disabled = true;
    nextPage.disabled = true;
    resultsRoot.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  });
  const changePage = (direction) => {
    if (pagePending) return;
    if (!feed[direction]()) return;
    pagePending = true;
    previousPage.disabled = true;
    nextPage.disabled = true;
    pageStatus.textContent = "Ergebnisse werden geladen …";
  };
  previousPage.addEventListener("click", () => changePage("previous"));
  nextPage.addEventListener("click", () => changePage("next"));
  refreshButton.addEventListener("click", () => {
    if (pagePending) return;
    startManualCooldown();
    feed.refresh();
  });
  activeResultView = {
    id, page: resultsOnly ? "results" : "viewer",
    select(discipline, gender) {
      const item = disciplines[discipline];
      selected = item && (item.mixed ? gender === "mixed" : ["female", "male"].includes(gender)) ? { discipline, gender } : null;
      if (eventCan(event, "can_view_results")) renderContent();
    },
  };
  routeCleanup = () => {
    feed.stop();
    activeResultView = null;
  };
}

async function renderRoute(change) {
  const current = route();
  if (change?.type === "hashchange" && activeResultView?.id === current.id && activeResultView.page === current.page) {
    activeResultView.select(current.discipline, current.gender);
    app.focus({ preventScroll: true });
    return;
  }
  routeVersion += 1;
  const version = routeVersion;
  window.timerFirestoreApi.clearParticipantCache?.();
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
    if (version === routeVersion) renderError(error);
  } finally {
    if (version === routeVersion) app.focus({ preventScroll: true });
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
window.addEventListener("timer-auth-change", (event) => {
  if (event.detail?.participantsInvalidated) { metadataVersion += 1; eventCache.clear(); }
  syncPendingResults({ includeBlocked: event.detail?.participantsInvalidated === true }).catch(() => {});
  refreshTimerAccount().catch(() => {});
  if (event.detail?.participantsInvalidated && (activeResultView || document.querySelector("#person-form"))) renderRoute();
});
window.addEventListener("hashchange", renderRoute);
window.addEventListener("online", () => syncPendingResults({ includeBlocked: true }).catch(() => {}));
window.addEventListener("offline", () => updateOfflineSyncStatus());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncPendingResults({ includeBlocked: true }).catch(() => {});
});
offlineSyncStatus?.addEventListener("click", async () => {
  showToast(saveQueue.isSyncing() ? "Übertragung läuft im Hintergrund." : "Synchronisierung wird im Hintergrund versucht.");
  try {
    const synced = await syncPendingResults({ includeBlocked: true, notify: true });
    if (synced) return;
    const pending = await saveQueue.list();
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
