(function () {
  "use strict";
  const core = window.WorktimeCore;
  const $ = (id) => document.getElementById(id);
  const form = $("wt-form");
  const editor = $("wt-editor");
  const deleteDialog = $("wt-delete-dialog");
  const organizationsDialog = $("wt-organizations-dialog");
  const mobile = window.matchMedia("(max-width: 700px)");
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
  let settingsRef = null;
  let unsubscribeSettings = null;
  let organizations = ["", "", ""];
  let settingsLoaded = false;
  let activeTab = "tasks";
  let previousStartDate = "";
  const currentMode = () => activeTab === "tasks" || mobile.matches ? "month" : mode;
  const organizationColor = (slot) => ({ "-1": "#898994", 0: "#51bd93", 1: "#77a9dc", 2: "#d6b66b" })[slot];
  const organizationLabel = (slot, summary) => Number(slot) === -1 ? "Ohne Gliederung" : organizations[slot] || summary.entries.find((entry) => entry.organization === Number(slot))?.organizationName || `Gliederung ${Number(slot) + 1}`;

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
    if (String(error?.code || "").startsWith("worktime/")) return error.message;
    if (error?.code === "permission-denied") return "Kein Zugriff auf diese Arbeitszeiten. Bitte lade die Seite neu.";
    if (error?.code === "not-found") return "Die Aufgabe wurde inzwischen gelöscht. Bitte lade die Übersicht neu.";
    return "Die Arbeitszeiten konnten nicht übertragen werden. Bitte prüfe deine Verbindung und versuche es erneut.";
  }
  function requireUser() {
    if (!user || auth?.currentUser?.uid !== user.uid) throw new Error("Die Anmeldung hat sich geändert. Bitte lade die Seite neu.");
  }
  function periodLabel() {
    const range = core.period(currentMode(), anchor);
    if (currentMode() === "month") return dateFormat(range.start, { month: "long", year: "numeric" });
    if (currentMode() === "day") return dateFormat(anchor, { day: "numeric", month: "short", year: "numeric" });
    return `${dateFormat(range.start, { day: "numeric", month: "short" })} – ${dateFormat(core.shift(range.end, -1), { day: "numeric", month: "short", year: "numeric" })}`;
  }
  function updateControls() {
    $("wt-period-label").textContent = periodLabel();
    $("wt-anchor").value = anchor;
    $("wt-next").disabled = false;
    $("wt-prev").disabled = core.period(currentMode(), anchor).start <= "2000-01-01";
    document.querySelectorAll("[data-period]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.period === mode)));
  }
  function svgNode(tag, attrs = {}, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function chart(summary) {
    const compact = mobile.matches;
    const buckets = compact ? core.compactBuckets(summary) : summary.buckets;
    const chartWidth = compact ? 340 : 950;
    const svg = svgNode("svg", { viewBox: `0 0 ${chartWidth} 190`, preserveAspectRatio: "none", "aria-hidden": "true" });
    const width = chartWidth - 48;
    const top = 12;
    const height = 145;
    const peak = Math.max(60, ...buckets.map((bucket) => bucket.minutes));
    const maxHours = Math.ceil(peak / 60);
    for (let tick = 0; tick <= 2; tick += 1) {
      const y = top + height - tick * height / 2;
      svg.append(svgNode("line", { x1: 30, x2: chartWidth - 5, y1: y, y2: y, class: "wt-grid-line" }));
      svg.append(svgNode("text", { x: 22, y: y + 4, "text-anchor": "end" }, new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(tick * maxHours / 2)));
    }
    const slot = width / buckets.length;
    buckets.forEach((bucket, index) => {
      const x = 36 + index * slot;
      const label = compact || currentMode() === "day" ? bucket.label : dateFormat(bucket.key, { day: "numeric", month: "short" });
      let accumulated = 0;
      for (const organization of [0, 1, 2, -1]) {
        const minutes = bucket.byOrganization[organization];
        if (!minutes) continue;
        const barHeight = minutes / (maxHours * 60) * height;
        accumulated += barHeight;
        const bar = svgNode("rect", { x: x + slot * .2, y: top + height - accumulated, width: slot * .6, height: barHeight, fill: organizationColor(organization), class: "wt-bar", "data-organization": organization });
        bar.append(svgNode("title", {}, `${label} · ${organizationLabel(organization, summary)}: ${core.duration(minutes)}`));
        svg.append(bar);
      }
      const showLabel = compact || currentMode() === "week" || (currentMode() === "day" ? index % 4 === 0 : index === 0 || (index + 1) % 5 === 0);
      if (showLabel) svg.append(svgNode("text", { x: x + slot / 2, y: 181, "text-anchor": "middle" }, compact ? bucket.label : currentMode() === "day" ? String(index).padStart(2, "0") : currentMode() === "week" ? dateFormat(bucket.key, { weekday: "short" }) : String(index + 1)));
    });
    $("wt-chart").replaceChildren(svg);
    $("wt-legend").replaceChildren(...[0, 1, 2, -1].filter((organization) => summary.byOrganization[organization] > 0).map((organization) => {
      const label = node("span", "wt-legend-item");
      const marker = node("i", "wt-org-stripe");
      marker.style.backgroundColor = organizationColor(organization);
      marker.setAttribute("aria-hidden", "true");
      label.append(marker, node("span", "", organizationLabel(organization, summary)), node("strong", "", core.duration(summary.byOrganization[organization])));
      return label;
    }));
    $("wt-chart-unit").textContent = compact ? "Stunden · Tage im Monat" : "Stunden";
    $("wt-chart").setAttribute("aria-label", `${periodLabel()}: ${core.duration(summary.total)}. ${buckets.map((bucket) => `${compact || currentMode() === "day" ? bucket.label : dateFormat(bucket.key, { day: "numeric", month: "short" })}: ${core.duration(bucket.minutes)}. ${[0, 1, 2, -1].filter((slot) => bucket.byOrganization[slot] > 0).map((slot) => `${organizationLabel(slot, summary)} ${core.duration(bucket.byOrganization[slot])}`).join(", ")}`).join("; ")}`);
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
    const filter = activeTab === "stats" && !mobile.matches ? $("wt-filter").value : "";
    const organizationFilter = activeTab === "stats" && !mobile.matches ? $("wt-organization-filter").value : "";
    const summary = core.summarize(entries.filter((entry) => (!filter || entry.category === filter) && (!organizationFilter || String(entry.organization) === organizationFilter)), currentMode(), anchor);
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
      empty.append(node("strong", "", filter ? "Keine passenden Aufgaben" : "Noch keine Aufgaben in diesem Zeitraum"), node("span", "", "Starte mit „Aufgabe hinzufügen“."));
      list.replaceChildren(empty);
      return;
    }
    const rows = [];
    let lastDate = "";
    let group = null;
    for (const entry of summary.entries.sort((a, b) => b.date.localeCompare(a.date) || b.startMinute - a.startMinute || a.id.localeCompare(b.id))) {
      if (entry.date !== lastDate) {
        group = node("section", "wt-day-group");
        const heading = node("h2", "wt-day-heading", dateFormat(entry.date, { weekday: "long", day: "numeric", month: "long" }));
        heading.id = `wt-day-${entry.date}`;
        group.setAttribute("aria-labelledby", heading.id);
        group.append(heading);
        rows.push(group);
        lastDate = entry.date;
      }
      const item = node("article", "wt-task");
      const info = node("div", "wt-task-info");
      const meta = node("div", "wt-task-meta");
      meta.append(node("span", "", core.categories[entry.category]));
      if (entry.organization >= 0) {
        const stripe = node("span", "wt-org-stripe");
        stripe.dataset.organization = entry.organization;
        stripe.title = entry.organizationName;
        stripe.setAttribute("role", "img");
        stripe.setAttribute("aria-label", `Gliederung: ${entry.organizationName}`);
        item.append(stripe);
      }
      info.append(node("h3", "", entry.title), meta);
      const actions = node("div", "wt-task-actions");
      actions.append(actionButton("Bearbeiten", openEditor, entry, "m16 3 5 5M3 21l5-1L21 7a2 2 0 0 0-5-5L3 15v6Z"));
      item.append(info, node("strong", "wt-task-duration", core.duration(entry.durationMinutes)), actions);
      group.append(item);
    }
    list.replaceChildren(...rows);
  }
  function clearSummary() {
    loaded = false;
    entries = [];
    for (const id of ["wt-total", "wt-count", "wt-days"]) $(id).textContent = "—";
    $("wt-chart").replaceChildren();
    $("wt-categories").replaceChildren();
    $("wt-legend").replaceChildren();
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
    const range = core.period(currentMode(), anchor);
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
    settingsRef = window.firebase.firestore().collection("users").doc(user.uid).collection("worktimeSettings").doc("preferences");
    const currentSession = sessionId;
    unsubscribeSettings = settingsRef.onSnapshot((snapshot) => {
      if (currentSession !== sessionId) return;
      organizations = snapshot.exists ? snapshot.data().organizations : ["", "", ""];
      settingsLoaded = true;
      refreshOrganizations();
      render();
    }, () => { settingsLoaded = false; message("Gliederungen konnten nicht geladen werden. Bitte lade die Seite neu.", true); });
    $("wt-content").hidden = false;
    $("wt-add-bar").hidden = activeTab !== "tasks";
    subscribe();
  }
  function stop() {
    generation += 1;
    sessionId += 1;
    unsubscribe?.();
    unsubscribeSettings?.();
    unsubscribe = null;
    collection = null;
    settingsRef = null;
    unsubscribeSettings = null;
    organizations = ["", "", ""];
    settingsLoaded = false;
    user = null;
    auth = null;
    editing = null;
    deleting = null;
    editor.close();
    deleteDialog.close();
    organizationsDialog.close();
    form.reset();
    setBusy(false);
    $("wt-content").hidden = true;
    $("wt-add-bar").hidden = true;
    clearSummary();
  }
  function setBusy(value) {
    busy = value;
    editor.querySelectorAll("input, select, textarea, button").forEach((element) => { element.disabled = value; });
    deleteDialog.querySelectorAll("button").forEach((element) => { element.disabled = value; });
    organizationsDialog.querySelectorAll("input, button").forEach((element) => { element.disabled = value; });
    $("wt-save").textContent = value ? "Wird gespeichert …" : "Speichern";
  }
  function refreshOrganizations(selected = form.elements.organization.value || "-1", previousName = form.elements.organization.selectedOptions[0]?.dataset.name || "") {
    const slot = Number(String(selected).split(":")[0]);
    const options = [node("option", "", "Keine Gliederung")];
    options[0].value = "-1";
    if (slot >= 0 && previousName && previousName !== organizations[slot]) {
      const previous = node("option", "", previousName);
      previous.value = `${slot}:previous`;
      previous.dataset.name = previousName;
      options.push(previous);
      selected = previous.value;
    }
    organizations.forEach((name, index) => {
      if (!name) return;
      const option = node("option", "", name);
      option.value = String(index);
      option.dataset.name = name;
      options.push(option);
    });
    form.elements.organization.replaceChildren(...options);
    form.elements.organization.value = String(selected);
    if (!form.elements.organization.value) form.elements.organization.value = "-1";
    const filter = $("wt-organization-filter");
    const filterValue = filter.value;
    const all = node("option", "", "Alle Gliederungen");
    all.value = "";
    filter.replaceChildren(all, ...organizations.flatMap((name, index) => {
      if (!name) return [];
      const option = node("option", "", name);
      option.value = String(index);
      return [option];
    }));
    filter.value = filterValue;
    if (!filter.value) filter.value = "";
  }
  function selectTab(tab, focus = false) {
    const previousMode = currentMode();
    activeTab = tab;
    document.body.dataset.worktimeTab = tab;
    $("wt-add-bar").hidden = tab !== "tasks";
    for (const name of ["tasks", "stats"]) {
      const selected = tab === name;
      $( `wt-${name}-tab`).setAttribute("aria-selected", String(selected));
      $( `wt-${name}-tab`).tabIndex = selected ? 0 : -1;
      $( `wt-${name}-panel`).hidden = !selected;
    }
    if (focus) $( `wt-${tab}-tab`).focus();
    if (previousMode !== currentMode()) subscribe();
    else render();
  }
  function updateHint() {
    let hint = "Zeiten in Europe/Berlin.";
    try {
      const start = core.instant(form.elements.startDate.value, core.minutes(form.elements.start.value));
      const end = core.instant(form.elements.endDate.value, core.minutes(form.elements.end.value));
      if (end > start) hint = `${core.duration((end - start) / 60000)} · Zuordnung zum Startdatum.`;
    } catch { /* Incomplete times keep the default hint. */ }
    $("wt-time-hint").textContent = hint;
  }
  function openEditor(entry = null) {
    if (busy || !user) return;
    editing = entry?.id ? entry : null;
    form.reset();
    $("wt-editor-title").textContent = editing ? "Aufgabe bearbeiten" : "Aufgabe hinzufügen";
    form.elements.title.value = editing?.title || "";
    form.elements.startDate.value = editing?.date || core.today();
    form.elements.endDate.value = editing ? core.recordEndDate(editing) : core.today();
    previousStartDate = form.elements.startDate.value;
    form.elements.start.value = editing ? core.clock(editing.startMinute) : "";
    form.elements.end.value = editing ? core.clock(editing.endMinute) : "";
    form.elements.category.value = editing?.category || "training";
    form.elements.description.value = editing?.description || "";
    refreshOrganizations(editing?.organization ?? -1, editing?.organizationName || "");
    $("wt-editor-delete").hidden = !editing;
    $("wt-form-error").hidden = true;
    updateHint();
    editor.showModal();
    const touchInput = window.matchMedia("(pointer: coarse)").matches;
    const initialFocus = mobile.matches || touchInput ? $("wt-editor-title") : form.elements.title;
    initialFocus.focus({ preventScroll: true });
    editor.scrollTop = 0;
  }
  function openDelete(entry) {
    if (busy || !user) return;
    deleting = entry;
    editor.close();
    $("wt-delete-name").textContent = entry.title;
    $("wt-delete-error").hidden = true;
    deleteDialog.showModal();
    deleteDialog.scrollTop = 0;
  }
  form.addEventListener("input", updateHint);
  form.elements.startDate.addEventListener("change", () => {
    const value = form.elements.startDate.value;
    if (!value) return;
    if (form.elements.endDate.value === previousStartDate || form.elements.endDate.value < value) form.elements.endDate.value = value;
    previousStartDate = value;
    updateHint();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const owner = user?.uid;
    const session = sessionId;
    try {
      requireUser();
      if (!navigator.onLine) throw new Error("Du bist offline. Bitte verbinde dich zum Speichern mit dem Internet.");
      const input = Object.fromEntries(new FormData(form));
      input.organizationName = form.elements.organization.selectedOptions[0]?.dataset.name || "";
      input.organization = input.organization.split(":")[0];
      const data = core.prepare(input);
      const stamp = window.firebase.firestore.Timestamp;
      const record = { ...data, day: stamp.fromDate(data.day), endDay: stamp.fromDate(data.endDay), startedAt: stamp.fromDate(data.startedAt), endedAt: stamp.fromDate(data.endedAt) };
      const ref = editing ? collection.doc(editing.id) : collection.doc();
      const wasEditing = Boolean(editing);
      setBusy(true);
      await window.WorktimeStore.commit(window.firebase.firestore(), owner, ref.id, record, window.firebase.firestore, () => {
        requireUser();
        if (session !== sessionId) throw new Error("Die Anmeldung hat sich geändert.");
      }, wasEditing);
      if (user?.uid !== owner || session !== sessionId) return;
      editor.close();
      const savedDate = core.key(data.day);
      const range = core.period(currentMode(), anchor);
      if (savedDate < range.start || savedDate >= range.end) { anchor = savedDate; subscribe(); }
      message();
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
      await window.WorktimeStore.commit(window.firebase.firestore(), owner, deleting.id, null, window.firebase.firestore, () => {
        requireUser();
        if (session !== sessionId) throw new Error("Die Anmeldung hat sich geändert.");
      });
      if (user?.uid !== owner || session !== sessionId) return;
      deleteDialog.close();
      message();
    } catch (error) {
      if (user?.uid !== owner || session !== sessionId) return;
      $("wt-delete-error").hidden = false;
      $("wt-delete-error").textContent = error.code ? errorText(error) : error.message;
    } finally {
      if (session === sessionId) setBusy(false);
    }
  });
  for (const dialog of [editor, deleteDialog, organizationsDialog]) dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  document.querySelectorAll("[data-wt-close]").forEach((button) => button.addEventListener("click", () => { if (!busy) editor.close(); }));
  document.querySelectorAll("[data-wt-delete-close]").forEach((button) => button.addEventListener("click", () => { if (!busy) deleteDialog.close(); }));
  $("wt-create").addEventListener("click", () => openEditor());
  $("wt-editor-delete").addEventListener("click", () => { if (editing) openDelete(editing); });
  for (const tab of ["tasks", "stats"]) {
    $( `wt-${tab}-tab`).addEventListener("click", () => selectTab(tab));
    $( `wt-${tab}-tab`).addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        selectTab(event.key === "Home" ? "tasks" : event.key === "End" ? "stats" : activeTab === "tasks" ? "stats" : "tasks", true);
      }
    });
  }
  $("wt-organizations-open").addEventListener("click", () => {
    if (busy || !user) return;
    if (!settingsLoaded) { message("Deine Gliederungen werden noch geladen. Bitte versuche es gleich erneut.", true); return; }
    const settingsForm = $("wt-organizations-form");
    organizations.forEach((name, index) => { settingsForm.elements[`organization${index}`].value = name; });
    $("wt-organizations-error").hidden = true;
    organizationsDialog.showModal();
    organizationsDialog.scrollTop = 0;
  });
  for (const id of ["wt-organizations-close", "wt-organizations-cancel"]) $(id).addEventListener("click", () => { if (!busy) organizationsDialog.close(); });
  $("wt-organizations-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const session = sessionId;
    try {
      requireUser();
      if (!navigator.onLine) throw new Error("Bitte verbinde dich zum Speichern mit dem Internet.");
      const values = [0, 1, 2].map((index) => $("wt-organizations-form").elements[`organization${index}`].value.trim());
      setBusy(true);
      await settingsRef.set({ organizations: values });
      if (session !== sessionId) return;
      organizations = values;
      refreshOrganizations();
      render();
      organizationsDialog.close();
      message();
    } catch (error) {
      if (session !== sessionId) return;
      $("wt-organizations-error").hidden = false;
      $("wt-organizations-error").textContent = error.code ? errorText(error) : error.message;
    } finally { if (session === sessionId) setBusy(false); }
  });
  $("wt-filter").addEventListener("change", render);
  $("wt-organization-filter").addEventListener("change", render);
  document.querySelectorAll("[data-period]").forEach((button) => button.addEventListener("click", () => {
    if (mode === button.dataset.period) return;
    mode = button.dataset.period;
    subscribe();
  }));
  for (const [id, direction] of [["wt-prev", -1], ["wt-next", 1]]) $(id).addEventListener("click", () => {
    anchor = core.move(currentMode(), anchor, direction);
    subscribe();
  });
  $("wt-today").addEventListener("click", () => { anchor = core.today(); subscribe(); });
  $("wt-anchor").addEventListener("change", () => {
    const value = $("wt-anchor").value;
    try { core.day(value); } catch { updateControls(); return; }
    anchor = value;
    subscribe();
  });
  window.addEventListener("online", () => { if (user && !loaded) subscribe(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") updateControls(); });
  mobile.addEventListener("change", () => {
    if (!user) return;
    if (activeTab === "stats" && mode !== "month") subscribe();
    else render();
  });
  window.LifesavingWorktime = Object.freeze({ start, stop });
})();
