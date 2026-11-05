(function () {
  "use strict";
  const core = window.WorktimeCore;
  const $ = (id) => document.getElementById(id);
  const form = $("wt-form");
  const editor = $("wt-editor");
  const deleteDialog = $("wt-delete-dialog");
  const dateFormat = (date, options) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", ...options }).format(core.day(date));
  let user = null;
  let auth = null;
  let unsubscribe = null;
  let entries = [];
  let mode = "month";
  let anchor = core.today();
  let editing = null;
  let deleting = null;
  let generation = 0;
  let sessionId = 0;
  let loaded = false;
  let busy = false;
  let collection = null;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function message(text = "", error = false) {
    $("wt-message").textContent = text;
    $("wt-message").hidden = !text;
    $("wt-message").dataset.error = String(error);
  }
  function errorText(error) {
    if (error?.code === "permission-denied") return "Kein Zugriff auf diese Arbeitszeiten. Bitte lade die Seite neu.";
    if (error?.code === "not-found") return "Die Aufgabe wurde inzwischen gelöscht. Bitte lade die Übersicht neu.";
    return "Die Arbeitszeiten konnten nicht übertragen werden. Bitte prüfe deine Verbindung und versuche es erneut.";
  }
  function requireUser() {
    if (!user || auth?.currentUser?.uid !== user.uid) throw new Error("Die Anmeldung hat sich geändert. Bitte lade die Seite neu.");
  }
  function periodLabel() {
    const range = core.period(mode, anchor);
    if (mode === "month") return dateFormat(range.start, { month: "long", year: "numeric" });
    if (mode === "day") return dateFormat(anchor, { day: "numeric", month: "short", year: "numeric" });
    return `${dateFormat(range.start, { day: "numeric", month: "short" })} – ${dateFormat(core.shift(range.end, -1), { day: "numeric", month: "short", year: "numeric" })}`;
  }
  function updateControls() {
    $("wt-period-label").textContent = periodLabel();
    $("wt-anchor").value = anchor;
    $("wt-anchor").max = core.today();
    $("wt-next").disabled = core.period(mode, anchor).end > core.today();
    $("wt-prev").disabled = core.period(mode, anchor).start <= "2000-01-01";
    document.querySelectorAll("[data-period]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.period === mode)));
  }
  function svgNode(tag, attrs = {}, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function chart(summary) {
    const svg = svgNode("svg", { viewBox: "0 0 950 190", preserveAspectRatio: "none", "aria-hidden": "true" });
    const width = 902;
    const top = 12;
    const height = 145;
    const peak = Math.max(60, ...summary.buckets.map((bucket) => bucket.minutes));
    const maxHours = Math.ceil(peak / 60);
    for (let tick = 0; tick <= 2; tick += 1) {
      const y = top + height - tick * height / 2;
      svg.append(svgNode("line", { x1: 30, x2: 945, y1: y, y2: y, class: "wt-grid-line" }));
      svg.append(svgNode("text", { x: 22, y: y + 4, "text-anchor": "end" }, new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(tick * maxHours / 2)));
    }
    const slot = width / summary.buckets.length;
    summary.buckets.forEach((bucket, index) => {
      const x = 36 + index * slot;
      const barHeight = bucket.minutes / (maxHours * 60) * height;
      const label = mode === "day" ? bucket.label : dateFormat(bucket.key, { day: "numeric", month: "short" });
      const bar = svgNode("rect", { x: x + slot * .2, y: top + height - barHeight, width: slot * .6, height: barHeight, rx: 2, class: "wt-bar" });
      bar.append(svgNode("title", {}, `${label}: ${core.duration(bucket.minutes)}`));
      svg.append(bar);
      const showLabel = mode === "week" || (mode === "day" ? index % 4 === 0 : index === 0 || (index + 1) % 5 === 0);
      if (showLabel) svg.append(svgNode("text", { x: x + slot / 2, y: 181, "text-anchor": "middle" }, mode === "day" ? String(index).padStart(2, "0") : mode === "week" ? dateFormat(bucket.key, { weekday: "short" }) : String(index + 1)));
    });
    $("wt-chart").replaceChildren(svg);
    $("wt-chart").setAttribute("aria-label", `${periodLabel()}: ${core.duration(summary.total)}. ${summary.buckets.map((bucket) => `${mode === "day" ? bucket.label : dateFormat(bucket.key, { day: "numeric", month: "short" })}: ${core.duration(bucket.minutes)}`).join("; ")}`);
  }
  function actionButton(label, action, entry, path) {
    const button = node("button", "wt-icon-button");
    button.type = "button";
    button.setAttribute("aria-label", `${label}: ${entry.title}`);
    button.title = label;
    const icon = svgNode("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
    icon.append(svgNode("path", { d: path }));
    button.append(icon);
    button.addEventListener("click", () => action(entry));
    return button;
  }
  function render() {
    updateControls();
    if (!loaded) return;
    const filter = $("wt-filter").value;
    const summary = core.summarize(entries.filter((entry) => !filter || entry.category === filter), mode, anchor);
    $("wt-total").textContent = core.duration(summary.total);
    $("wt-count").textContent = summary.entries.length;
    $("wt-days").textContent = summary.days;
    $("wt-metrics").setAttribute("aria-busy", "false");
    chart(summary);
    $("wt-categories").replaceChildren(...Object.entries(core.categories).map(([category, label]) => {
      const item = node("div", "wt-category");
      const progress = node("progress");
      progress.max = summary.total || 1;
      progress.value = summary.byCategory[category];
      progress.setAttribute("aria-label", label);
      item.append(node("span", "", label), node("strong", "", core.duration(summary.byCategory[category])), progress);
      return item;
    }));
    const list = $("wt-list");
    list.setAttribute("aria-busy", "false");
    if (!summary.entries.length) {
      const empty = node("p", "wt-empty");
      empty.append(node("strong", "", filter ? "Keine Aufgaben in dieser Kategorie" : "Noch keine Aufgaben in diesem Zeitraum"), node("span", "", "Erfasse deine absolvierte Arbeit über „Aufgabe erfassen“."));
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...summary.entries.sort((a, b) => b.date.localeCompare(a.date) || b.startMinute - a.startMinute || a.id.localeCompare(b.id)).map((entry) => {
      const item = node("article", "wt-task");
      const date = node("div", "wt-task-date");
      date.append(node("strong", "", Number(entry.date.slice(8))), node("span", "", dateFormat(entry.date, { month: "short" })));
      const info = node("div", "wt-task-info");
      const meta = node("div", "wt-task-meta");
      meta.append(node("span", "", `${core.clock(entry.startMinute)} – ${core.clock(entry.endMinute)}${entry.endMinute < entry.startMinute ? " (+1 Tag)" : ""}`), node("span", "", core.categories[entry.category]));
      info.append(node("h3", "", entry.title), meta);
      if (entry.description) info.append(node("p", "wt-task-description", entry.description));
      const actions = node("div", "wt-task-actions");
      actions.append(actionButton("Bearbeiten", openEditor, entry, "m16 3 5 5M3 21l5-1L21 7a2 2 0 0 0-5-5L3 15v6Z"), actionButton("Löschen", openDelete, entry, "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"));
      item.append(date, info, node("strong", "wt-task-duration", core.duration(entry.durationMinutes)), actions);
      return item;
    }));
  }
  function clearSummary() {
    loaded = false;
    entries = [];
    for (const id of ["wt-total", "wt-count", "wt-days"]) $(id).textContent = "—";
    $("wt-chart").replaceChildren();
    $("wt-categories").replaceChildren();
    $("wt-metrics").setAttribute("aria-busy", "true");
    $("wt-list").setAttribute("aria-busy", "true");
    $("wt-list").replaceChildren(node("p", "wt-empty", "Arbeitszeiten werden geladen …"));
  }
  function subscribe() {
    unsubscribe?.();
    const current = ++generation;
    clearSummary();
    updateControls();
    if (!collection) return;
    const range = core.period(mode, anchor);
    const stamp = window.firebase.firestore.Timestamp;
    const query = collection.where("day", ">=", stamp.fromDate(core.day(range.start))).where("day", "<", stamp.fromDate(core.day(range.end))).orderBy("day", "desc");
    unsubscribe = query.onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
      if (current !== generation || auth?.currentUser?.uid !== user?.uid) return;
      // Wait for the server before displaying a cached collection after a role change.
      if (snapshot.metadata.fromCache) return;
      entries = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id, date: core.key(doc.data().day.toDate()) }));
      loaded = true;
      message();
      render();
    }, (error) => {
      if (current !== generation) return;
      clearSummary();
      if (error.code === "permission-denied") stop();
      message(errorText(error), true);
      const retry = node("button", "button button-secondary", "Erneut laden");
      retry.type = "button";
      retry.addEventListener("click", () => window.location.reload());
      $("wt-list").replaceChildren(node("p", "wt-empty", "Arbeitszeiten konnten nicht geladen werden."), retry);
      $("wt-list").setAttribute("aria-busy", "false");
    });
  }
  function start(nextAuth, nextUser) {
    stop();
    auth = nextAuth;
    user = nextUser;
    collection = window.firebase.firestore().collection("users").doc(user.uid).collection("worktimeEntries");
    $("wt-content").hidden = false;
    subscribe();
  }
  function stop() {
    generation += 1;
    sessionId += 1;
    unsubscribe?.();
    unsubscribe = null;
    collection = null;
    user = null;
    auth = null;
    editing = null;
    deleting = null;
    editor.close();
    deleteDialog.close();
    form.reset();
    setBusy(false);
    $("wt-content").hidden = true;
    clearSummary();
  }
  function setBusy(value) {
    busy = value;
    editor.querySelectorAll("input, select, textarea, button").forEach((element) => { element.disabled = value; });
    deleteDialog.querySelectorAll("button").forEach((element) => { element.disabled = value; });
    $("wt-save").textContent = value ? "Wird gespeichert …" : "Speichern";
  }
  function updateHint() {
    let hint = "Zeiten in Europe/Berlin.";
    try {
      const start = core.minutes(form.elements.start.value);
      const end = core.minutes(form.elements.end.value);
      if (end < start) hint = "Bis am Folgetag · Zuordnung zum Startdatum.";
    } catch { /* Incomplete times keep the default hint. */ }
    $("wt-time-hint").textContent = hint;
  }
  function openEditor(entry = null) {
    if (busy || !user) return;
    editing = entry?.id ? entry : null;
    form.reset();
    $("wt-editor-title").textContent = editing ? "Aufgabe bearbeiten" : "Aufgabe erfassen";
    form.elements.title.value = editing?.title || "";
    form.elements.date.max = core.today();
    form.elements.date.value = editing?.date || core.today();
    form.elements.start.value = editing ? core.clock(editing.startMinute) : "";
    form.elements.end.value = editing ? core.clock(editing.endMinute) : "";
    form.elements.category.value = editing?.category || "training";
    form.elements.description.value = editing?.description || "";
    $("wt-form-error").hidden = true;
    updateHint();
    editor.showModal();
  }
  function openDelete(entry) {
    if (busy || !user) return;
    deleting = entry;
    $("wt-delete-name").textContent = entry.title;
    $("wt-delete-error").hidden = true;
    deleteDialog.showModal();
  }
  form.addEventListener("input", updateHint);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const owner = user?.uid;
    const session = sessionId;
    try {
      requireUser();
      if (!navigator.onLine) throw new Error("Du bist offline. Bitte verbinde dich zum Speichern mit dem Internet.");
      const input = Object.fromEntries(new FormData(form));
      const data = core.prepare(input);
      const stamp = window.firebase.firestore.Timestamp;
      const timestamp = window.firebase.firestore.FieldValue.serverTimestamp;
      const record = { ...data, day: stamp.fromDate(data.day), startedAt: stamp.fromDate(data.startedAt), endedAt: stamp.fromDate(data.endedAt), updatedAt: timestamp() };
      const ref = editing ? collection.doc(editing.id) : collection.doc();
      const wasEditing = Boolean(editing);
      setBusy(true);
      if (wasEditing) await ref.update(record);
      else await ref.set({ ...record, createdAt: timestamp() });
      if (user?.uid !== owner || session !== sessionId) return;
      editor.close();
      const savedDate = core.key(data.day);
      const range = core.period(mode, anchor);
      if (savedDate < range.start || savedDate >= range.end) { anchor = savedDate; subscribe(); }
      message(wasEditing ? "Aufgabe gespeichert." : "Aufgabe erfasst.");
    } catch (error) {
      if (user?.uid !== owner || session !== sessionId) return;
      $("wt-form-error").hidden = false;
      $("wt-form-error").textContent = error.code ? errorText(error) : error.message;
    } finally {
      if (session === sessionId) setBusy(false);
    }
  });
  $("wt-delete-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !deleting) return;
    const owner = user?.uid;
    const session = sessionId;
    try {
      requireUser();
      if (!navigator.onLine) throw new Error("Du bist offline. Bitte verbinde dich zum Löschen mit dem Internet.");
      setBusy(true);
      await collection.doc(deleting.id).delete();
      if (user?.uid !== owner || session !== sessionId) return;
      deleteDialog.close();
      message("Aufgabe gelöscht.");
    } catch (error) {
      if (user?.uid !== owner || session !== sessionId) return;
      $("wt-delete-error").hidden = false;
      $("wt-delete-error").textContent = error.code ? errorText(error) : error.message;
    } finally {
      if (session === sessionId) setBusy(false);
    }
  });
  for (const dialog of [editor, deleteDialog]) dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  document.querySelectorAll("[data-wt-close]").forEach((button) => button.addEventListener("click", () => { if (!busy) editor.close(); }));
  document.querySelectorAll("[data-wt-delete-close]").forEach((button) => button.addEventListener("click", () => { if (!busy) deleteDialog.close(); }));
  $("wt-create").addEventListener("click", () => openEditor());
  $("wt-filter").addEventListener("change", render);
  document.querySelectorAll("[data-period]").forEach((button) => button.addEventListener("click", () => {
    if (mode === button.dataset.period) return;
    mode = button.dataset.period;
    subscribe();
  }));
  for (const [id, direction] of [["wt-prev", -1], ["wt-next", 1]]) $(id).addEventListener("click", () => {
    anchor = core.move(mode, anchor, direction);
    subscribe();
  });
  $("wt-today").addEventListener("click", () => { anchor = core.today(); subscribe(); });
  $("wt-anchor").addEventListener("change", () => {
    const value = $("wt-anchor").value;
    try { core.day(value); } catch { updateControls(); return; }
    if (value > core.today()) { updateControls(); return; }
    anchor = value;
    subscribe();
  });
  window.addEventListener("online", () => { if (user && !loaded) subscribe(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") updateControls(); });
  window.LifesavingWorktime = Object.freeze({ start, stop });
})();
