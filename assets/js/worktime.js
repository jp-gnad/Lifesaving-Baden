(function () {
  "use strict";
  const core = window.WorktimeCore;
  const $ = (id) => document.getElementById(id);
  const form = $("wt-form");
  const editor = $("wt-editor");
  const deleteDialog = $("wt-delete-dialog");
  const organizationsDialog = $("wt-organizations-dialog");
  const mobile = window.matchMedia("(max-width: 700px)");
  // iOS can ignore viewport zoom limits. Cancel its gesture events as well as
  // multi-touch movement, leaving single-finger scrolling and field taps intact.
  const preventMobileZoom = (event) => {
    if ((mobile.matches || window.matchMedia("(any-pointer: coarse)").matches) && event.cancelable) event.preventDefault();
  };
  for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, preventMobileZoom, { passive: false });
  for (const type of ["touchstart", "touchmove"]) document.addEventListener(type, (event) => {
    if (event.touches.length > 1) preventMobileZoom(event);
  }, { passive: false });
  const dateFormat = (date, options) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", ...options }).format(core.day(date));
  let user = null;
  let auth = null;
  let unsubscribe = null;
  let entries = [];
  let mode = "month";
  let chartGrouping = "organization";
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
  const hourFormat = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hours = (minutes) => `${hourFormat.format(minutes / 60)} Std.`;
  const organizationColor = (slot) => ({ "-1": "#898994", 0: "#51bd93", 1: "#77a9dc", 2: "#d6b66b" })[slot];
  const organizationLabel = (slot, summary) => Number(slot) === -1 ? "Ohne Gliederung" : organizations[slot] || summary.entries.find((entry) => entry.organization === Number(slot))?.organizationName || `Gliederung ${Number(slot) + 1}`;
  const categoryColors = Object.freeze({ training: "#51bd93", competition: "#77a9dc", organization: "#d6b66b", athleteCare: "#b29bd6", education: "#69bbc2", other: "#92929d" });

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
    document.querySelectorAll("[data-chart-grouping]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.chartGrouping === chartGrouping)));
  }
  function svgNode(tag, attrs = {}, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function chart(summary) {
    const compact = mobile.matches;
    const categories = chartGrouping === "category";
    const groupingLabel = categories ? "Kategorien" : "Gliederungen";
    const groups = categories ? Object.keys(core.categories) : [0, 1, 2, -1];
    const property = categories ? "byCategory" : "byOrganization";
    const groupLabel = (group) => categories ? core.categories[group] : organizationLabel(group, summary);
    const groupColor = (group) => categories ? categoryColors[group] : organizationColor(group);
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
      for (const group of groups) {
        const minutes = bucket[property][group];
        if (!minutes) continue;
        const barHeight = minutes / (maxHours * 60) * height;
        accumulated += barHeight;
        const bar = svgNode("rect", { x: x + slot * .2, y: top + height - accumulated, width: slot * .6, height: barHeight, fill: groupColor(group), class: "wt-bar", "data-grouping": chartGrouping, "data-group": group });
        bar.append(svgNode("title", {}, `${label} · ${groupLabel(group)}: ${core.duration(minutes)}`));
        svg.append(bar);
      }
      const showLabel = compact || currentMode() === "week" || (currentMode() === "day" ? index % 4 === 0 : index === 0 || (index + 1) % 5 === 0);
      if (showLabel) svg.append(svgNode("text", { x: x + slot / 2, y: 181, "text-anchor": "middle" }, compact ? bucket.label : currentMode() === "day" ? String(index).padStart(2, "0") : currentMode() === "week" ? dateFormat(bucket.key, { weekday: "short" }) : String(index + 1)));
    });
    $("wt-chart").replaceChildren(svg);
    $("wt-legend").setAttribute("aria-label", `${groupingLabel} im Diagramm`);
    $("wt-legend").replaceChildren(...groups.filter((group) => summary[property][group] > 0).map((group) => {
      const label = node("span", "wt-legend-item");
      const marker = node("i", "wt-org-stripe");
      marker.style.backgroundColor = groupColor(group);
      marker.setAttribute("aria-hidden", "true");
      label.append(marker, node("span", "", groupLabel(group)), node("strong", "", core.duration(summary[property][group])));
      return label;
    }));
    $("wt-chart-unit").textContent = compact ? "Stunden · Tage im Monat" : "Stunden";
    $("wt-chart").setAttribute("aria-label", `${periodLabel()}, nach ${groupingLabel}: ${core.duration(summary.total)}. ${buckets.map((bucket) => `${compact || currentMode() === "day" ? bucket.label : dateFormat(bucket.key, { day: "numeric", month: "short" })}: ${core.duration(bucket.minutes)}. ${groups.filter((group) => bucket[property][group] > 0).map((group) => `${groupLabel(group)} ${core.duration(bucket[property][group])}`).join(", ")}`).join("; ")}`);
    $("wt-categories").hidden = categories;
  }
  function categoryIcon(category) {
    const paths = {
      training: "M9 2h6M12 2v3M18 6l2-2M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM12 9v4l3 2",
      competition: "M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4M16 5h4v2a4 4 0 0 1-4 4M12 13v6M8 21h8M9 19h6",
      organization: "M8 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3M8 3h8v4H8V3ZM7 12h10M7 16h6",
      athleteCare: "M12 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2",
      education: "m2 9 10-5 10 5-10 5L2 9ZM6 11v6c4 3 8 3 12 0v-6M22 9v7",
      other: "M5 12h.01M12 12h.01M19 12h.01",
    };
    const icon = svgNode("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" });
    icon.append(svgNode("path", { d: paths[category] || paths.other }));
    return icon;
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
    // Keep the task list grouped by start date; statistics use actual time per day.
    const range = core.period(currentMode(), anchor);
    const listEntries = summary.entries.filter((entry) => entry.date >= range.start && entry.date < range.end);
    if (!listEntries.length) {
      const empty = node("p", "wt-empty");
      empty.append(node("strong", "", filter ? "Keine passenden Aufgaben" : "Noch keine Aufgaben in diesem Zeitraum"), node("span", "", "Starte mit „Aufgabe hinzufügen“."));
      list.replaceChildren(empty);
      return;
    }
    const rows = [];
    let lastDate = "";
    let card = null;
    const ordered = [...listEntries].sort((a, b) => b.date.localeCompare(a.date) || b.startMinute - a.startMinute || a.id.localeCompare(b.id));
    const dailyTotals = new Map();
    for (const entry of ordered) dailyTotals.set(entry.date, (dailyTotals.get(entry.date) || 0) + entry.durationMinutes);
    for (const entry of ordered) {
      if (entry.date !== lastDate) {
        const group = node("section", "wt-day-group");
        const header = node("div", "wt-day-header");
        const heading = node("h2", "wt-day-heading", dateFormat(entry.date, { weekday: "long", day: "numeric", month: "long" }));
        heading.id = `wt-day-${entry.date}`;
        group.setAttribute("aria-labelledby", heading.id);
        const total = node("strong", "wt-day-total", hours(dailyTotals.get(entry.date)));
        total.setAttribute("aria-label", `Tagessumme: ${core.duration(dailyTotals.get(entry.date))}`);
        header.append(heading, total);
        card = node("div", "wt-day-card");
        card.setAttribute("role", "list");
        group.append(header, card);
        rows.push(group);
        lastDate = entry.date;
      }
      const row = node("div", "wt-task-row");
      row.setAttribute("role", "listitem");
      const item = node("button", "wt-task");
      item.type = "button";
      const organization = entry.organizationName || "Ohne Gliederung";
      item.setAttribute("aria-label", `Aufgabe bearbeiten: ${entry.title}. ${core.categories[entry.category]}, ${core.duration(entry.durationMinutes)}, ${organization}`);
      const icon = node("span", "wt-task-icon");
      icon.dataset.organization = entry.organization ?? -1;
      icon.title = `${core.categories[entry.category]} · ${organization}`;
      icon.setAttribute("aria-hidden", "true");
      icon.append(categoryIcon(entry.category));
      const info = node("span", "wt-task-info");
      const title = node("span", "wt-task-title", entry.title);
      title.title = entry.title;
      info.append(title);
      if (entry.description) {
        const description = node("span", "wt-task-description", entry.description);
        description.title = entry.description;
        const descriptionId = `wt-task-description-${entry.id}`;
        description.id = descriptionId;
        item.setAttribute("aria-describedby", descriptionId);
        info.append(description);
      }
      const duration = node("strong", "wt-task-duration", hours(entry.durationMinutes));
      duration.title = core.duration(entry.durationMinutes);
      item.append(icon, info, duration);
      item.addEventListener("click", () => openEditor(entry));
      row.append(item);
      card.append(row);
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
    // Include tasks starting before the selected period. summarize clips their
    // elapsed time to the period; this single-field query needs no composite index.
    const query = activeTab === "stats"
      ? collection.where("endedAt", ">", stamp.fromDate(core.instant(range.start, 0))).orderBy("endedAt", "desc")
      : collection.where("day", ">=", stamp.fromDate(core.day(range.start))).where("day", "<", stamp.fromDate(core.day(range.end))).orderBy("day", "desc");
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
    $("wt-save").textContent = value ? "Speichern..." : "Speichern";
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
    subscribe();
  }
  function updateHint() {
    let hint = "Zeiten in Europe/Berlin.";
    try {
      const start = core.instant(form.elements.startDate.value, core.minutes(form.elements.start.value));
      const end = core.instant(form.elements.endDate.value, core.minutes(form.elements.end.value));
      if (end > start) hint = `${core.duration((end - start) / 60000)} · Auswertung je Kalendertag.`;
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
  document.querySelectorAll("[data-chart-grouping]").forEach((button) => button.addEventListener("click", () => {
    chartGrouping = button.dataset.chartGrouping;
    render();
  }));
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
