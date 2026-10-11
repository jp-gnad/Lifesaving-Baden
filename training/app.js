(function () {
  "use strict";
  const core = window.TrainingCore;
  const store = window.TrainingStore;
  const $ = (id) => document.getElementById(id);
  const monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const shortMonths = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const currentDate = core.today();
  const state = { identity: null, entries: [], editing: null, deleting: null, view: "diary", stop: null, loading: true, busy: false };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function empty(target, title, text) {
    const element = node("p", "empty-state");
    element.append(node("strong", "", title), document.createTextNode(text));
    target.replaceChildren(element);
  }

  function addMonths(select, includeAll) {
    if (!includeAll) select.replaceChildren();
    monthNames.forEach((name, index) => {
      const option = node("option", "", name);
      option.value = String(index + 1).padStart(2, "0");
      select.append(option);
    });
  }

  for (let year = Number(currentDate.slice(0, 4)); year >= 2000; year -= 1) {
    const option = node("option", "", String(year));
    option.value = String(year);
    $("year-filter").append(option);
  }
  addMonths($("diary-month"), true);
  addMonths($("ranking-month"), false);
  addMonths($("analysis-month"), true);
  $("ranking-month").value = currentDate.slice(5, 7);
  $("entry-date").max = currentDate;

  function syncForm() {
    $("motivation-value").value = `${$("entry-motivation").value} / 10`;
    $("entry-motivation").setAttribute("aria-valuetext", `${$("entry-motivation").value} von 10`);
    $("text-count").textContent = `${core.formatNumber($("entry-text").value.length)} / 5.000`;
  }

  function formMessage(text, error = false) {
    $("form-message").textContent = text;
    $("form-message").classList.toggle("error", error);
  }

  function resetForm(clearMessage = true) {
    state.editing = null;
    $("entry-form").reset();
    $("entry-date").value = core.today();
    $("entry-title").textContent = "Training eintragen";
    $("save-entry").textContent = "Training speichern ↗";
    $("cancel-edit").hidden = true;
    syncForm();
    if (clearMessage) formMessage("");
  }

  function stats(target, items) {
    target.replaceChildren(...items.map(([label, value, note]) => {
      const element = node("article", "stat");
      element.append(node("p", "stat-label", label), node("p", "stat-value", value), node("p", "stat-note", note));
      return element;
    }));
  }

  function displayStats(target, entries, scope) {
    const sum = core.summary(entries);
    stats(target, [
      ["Geschwommene Meter", core.formatMeters(sum.meters), scope],
      ["Trainings", core.formatNumber(sum.count), `${sum.days} aktive Trainingstage`],
      ["Ø Motivation", sum.motivation === null ? "—" : `${core.formatDecimal(sum.motivation)} / 10`, "Durchschnitt deiner Einträge"],
      ["Ø Trainingsumfang", core.formatMeters(Math.round(sum.averageMeters)), "Pro Trainingseinheit"]
    ]);
  }

  function ownEntries() { return state.entries.filter((entry) => entry.uid === state.identity?.uid); }
  function period(month) { return `${$("year-filter").value}${month ? `-${month}` : ""}`; }

  function beginEdit(entry) {
    if (state.busy) return;
    state.editing = entry;
    $("entry-date").value = entry.date;
    $("entry-meters").value = entry.meters;
    $("entry-motivation").value = entry.motivation;
    $("entry-text").value = entry.text;
    $("entry-title").textContent = "Training bearbeiten";
    $("save-entry").textContent = "Änderungen speichern";
    $("cancel-edit").hidden = false;
    formMessage("");
    syncForm();
    $("entry-title").scrollIntoView({ behavior: "smooth", block: "center" });
    $("entry-date").focus({ preventScroll: true });
  }

  function renderDiary() {
    const entries = core.inPeriod(ownEntries(), period($("diary-month").value))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    displayStats($("diary-stats"), entries, $("diary-month").value ? `${monthNames[Number($("diary-month").value) - 1]} ${$("year-filter").value}` : `Im Jahr ${$("year-filter").value}`);
    $("history-count").textContent = String(entries.length);
    $("history-title").textContent = `Deine Trainings · ${$("year-filter").value}`;
    if (!entries.length) {
      empty($("entry-list"), state.loading ? "Trainings werden geladen" : "Dein nächster Schritt beginnt hier", state.loading ? "Einen Moment bitte." : "Trage dein erstes Training ein oder wähle einen anderen Zeitraum.");
      return;
    }
    $("entry-list").replaceChildren(...entries.map((entry) => {
      const article = node("article", "entry");
      const top = node("div", "entry-top");
      const date = node("time", "entry-date", new Intl.DateTimeFormat("de-DE", {
        weekday: "short", day: "2-digit", month: "long", timeZone: "UTC"
      }).format(new Date(`${entry.date}T00:00:00Z`)));
      date.dateTime = entry.date;
      top.append(date, node("span", "entry-meters", core.formatMeters(entry.meters)));
      article.append(top, node("p", "entry-motivation", `Motivation ${entry.motivation} / 10`));
      if (entry.text) article.append(node("p", "entry-text", entry.text));
      const actions = node("div", "entry-actions");
      const edit = node("button", "text-button", "Bearbeiten");
      edit.type = "button";
      edit.disabled = state.busy;
      edit.setAttribute("aria-label", `Training vom ${entry.date} bearbeiten`);
      edit.addEventListener("click", () => beginEdit(entry));
      const remove = node("button", "text-button", "Löschen");
      remove.type = "button";
      remove.disabled = state.busy;
      remove.setAttribute("aria-label", `Training vom ${entry.date} löschen`);
      remove.addEventListener("click", () => {
        state.deleting = entry;
        $("delete-error").textContent = "";
        $("delete-dialog").showModal();
      });
      actions.append(edit, remove);
      article.append(actions);
      return article;
    }));
  }

  function renderRankingList(target, entries) {
    const ranked = core.ranking(entries);
    if (!ranked.length) { empty(target, "Die Bahn ist noch frei", "Für diesen Zeitraum wurde noch kein Training eingetragen."); return; }
    const list = node("div", "rank-list");
    list.setAttribute("role", "list");
    ranked.forEach((athlete) => {
      const row = node("div", `rank-row${athlete.uid === state.identity.uid ? " is-me" : ""}`);
      row.setAttribute("role", "listitem");
      const name = node("div", "rank-name", `${athlete.name}${athlete.uid === state.identity.uid ? " · Du" : ""}`);
      name.append(node("small", "", `${athlete.count} ${athlete.count === 1 ? "Training" : "Trainings"}`));
      row.append(node("span", "rank-number", String(athlete.rank)), name, node("span", "rank-distance", core.formatMeters(athlete.meters)));
      list.append(row);
    });
    target.replaceChildren(list);
  }

  function renderRankings() {
    $("ranking-year").textContent = $("year-filter").value;
    renderRankingList($("monthly-ranking"), core.inPeriod(state.entries, period($("ranking-month").value)));
    renderRankingList($("yearly-ranking"), state.entries);
  }

  function analysisEntries() {
    const uid = $("analysis-athlete").value;
    return core.inPeriod(state.entries.filter((entry) => !uid || entry.uid === uid), period($("analysis-month").value));
  }

  function renderAnalysis() {
    if (!state.identity?.isOrganizer) return;
    const selected = $("analysis-athlete").value;
    $("analysis-athlete").replaceChildren(node("option", "", "Alle Sportler"));
    $("analysis-athlete").firstChild.value = "";
    core.ranking(state.entries).sort((a, b) => a.name.localeCompare(b.name, "de")).forEach((athlete) => {
      const option = node("option", "", athlete.name);
      option.value = athlete.uid;
      $("analysis-athlete").append(option);
    });
    $("analysis-athlete").value = [...$("analysis-athlete").options].some((option) => option.value === selected) ? selected : "";
    const entries = analysisEntries();
    const sum = core.summary(entries);
    stats($("analysis-stats"), [
      ["Trainingsumfang", core.formatMeters(sum.meters), "Im gewählten Zeitraum"],
      ["Trainings", core.formatNumber(sum.count), `${new Set(entries.map((entry) => entry.uid)).size} aktive Sportler`],
      ["Ø Motivation", sum.motivation === null ? "—" : `${core.formatDecimal(sum.motivation)} / 10`, "Durchschnitt aller Einträge"],
      ["Ø Trainingsumfang", core.formatMeters(Math.round(sum.averageMeters)), "Pro Trainingseinheit"]
    ]);
    const yearEntries = state.entries.filter((entry) => !$("analysis-athlete").value || entry.uid === $("analysis-athlete").value);
    const months = core.monthly(yearEntries, $("year-filter").value);
    const max = Math.max(1, ...months.map((month) => month.meters));
    const chart = node("div", "chart");
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", `Geschwommene Meter pro Monat: ${months.map((month, index) => `${monthNames[index]} ${core.formatMeters(month.meters)}`).join(", ")}`);
    months.forEach((month, index) => {
      const column = node("div", "chart-column");
      column.title = `${monthNames[index]}: ${core.formatMeters(month.meters)} · ${month.count} Trainings`;
      const bar = node("div", `bar${month.meters ? " has-value" : ""}`);
      bar.style.height = `${Math.max(month.meters ? 4 : 1, month.meters / max * 75)}%`;
      column.append(node("span", "chart-value", core.formatNumber(month.meters)), bar, node("span", "", shortMonths[index]));
      chart.append(column);
    });
    $("volume-chart").replaceChildren(chart);
    $("export-analysis").disabled = state.loading || !entries.length;
    if (!entries.length) { empty($("athlete-table"), "Noch keine Daten", "Wähle einen anderen Zeitraum oder Sportler."); return; }
    const table = node("table");
    const caption = node("caption", "", "Trainingsauswertung nach Sportler");
    caption.hidden = true;
    table.append(caption);
    const head = node("thead");
    const header = node("tr");
    ["Sportler", "Meter", "Trainings", "Trainingstage", "Ø Motivation", "Letztes Training"].forEach((label) => {
      const th = node("th", "", label);
      th.scope = "col";
      header.append(th);
    });
    head.append(header);
    const body = node("tbody");
    core.ranking(entries).forEach((athlete) => {
      const athleteEntries = entries.filter((entry) => entry.uid === athlete.uid);
      const totals = core.summary(athleteEntries);
      const row = node("tr");
      const name = node("td");
      const button = node("button", "athlete-button", athlete.name);
      button.type = "button";
      button.addEventListener("click", () => { $("analysis-athlete").value = athlete.uid; renderAnalysis(); });
      name.append(button);
      row.append(name);
      [core.formatMeters(totals.meters), String(totals.count), String(totals.days),
        totals.motivation === null ? "—" : `${core.formatDecimal(totals.motivation)} / 10`,
        athleteEntries.map((entry) => entry.date).sort().at(-1).split("-").reverse().join(".")]
        .forEach((value) => row.append(node("td", "", value)));
      body.append(row);
    });
    table.append(head, body);
    $("athlete-table").replaceChildren(table);
  }

  function render() {
    renderDiary();
    renderRankings();
    renderAnalysis();
  }

  function setView(view) {
    if (view === "analysis" && !state.identity?.isOrganizer) view = "diary";
    state.view = view;
    document.querySelectorAll("[data-view]").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.view === view);
      if (tab.dataset.view === view) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    ["diary", "ranking", "analysis"].forEach((name) => { $(`view-${name}`).hidden = name !== view; });
  }

  function loadYear() {
    state.stop?.();
    state.stop = null;
    state.entries = [];
    state.loading = true;
    $("data-error").hidden = true;
    $("sync-status").textContent = "Daten werden geladen …";
    $("entry-form").querySelectorAll("input, textarea, button").forEach((control) => { control.disabled = true; });
    render();
    state.stop = store.watchYear($("year-filter").value, (entries) => {
      state.entries = entries;
      state.loading = false;
      $("sync-status").textContent = "Auf dem aktuellen Stand";
      $("data-error").hidden = true;
      if (!state.busy) $("entry-form").querySelectorAll("input, textarea, button").forEach((control) => { control.disabled = false; });
      render();
    }, (error) => {
      state.loading = false;
      $("data-error").textContent = error.message;
      $("data-error").hidden = false;
      $("sync-status").textContent = "Daten konnten nicht geladen werden";
      $("export-analysis").disabled = true;
    });
  }

  function access(identity) {
    const previous = state.identity;
    state.identity = identity;
    if (!identity.allowed) {
      state.stop?.();
      state.stop = null;
      state.entries = [];
      resetForm();
      $("entry-list").replaceChildren();
      $("monthly-ranking").replaceChildren();
      $("yearly-ranking").replaceChildren();
      $("athlete-table").replaceChildren();
      if ($("delete-dialog").open) $("delete-dialog").close();
      $("training-app").hidden = true;
      $("account-label").hidden = true;
      $("access-panel").hidden = false;
      $("access-action").hidden = Boolean(identity.loading);
      if (identity.loading) {
        $("access-title").textContent = "Dein Tagebuch wird geladen";
        $("access-message").textContent = "Wir prüfen deinen Kader-Zugang.";
      } else if (identity.error) {
        $("access-title").textContent = "Verbindung nicht möglich";
        $("access-message").textContent = identity.error;
      } else if (!identity.signedIn || !identity.verified) {
        $("access-title").textContent = "Melde dich an";
        $("access-message").textContent = "Für dein Trainingstagebuch brauchst du ein bestätigtes Konto mit Kader-Zugang.";
        const target = new URL("../login.html", window.location.href);
        target.searchParams.set("returnTo", window.location.href);
        $("access-action").href = target.href;
        $("access-action").textContent = "Zur Anmeldung";
      } else {
        $("access-title").textContent = "Für den Kader reserviert";
        $("access-message").textContent = "Das Trainingstagebuch ist für Kader-Sportler, Organisatoren und Admins verfügbar.";
        $("access-action").href = "../app.html";
        $("access-action").textContent = "Zu Home";
      }
      return;
    }
    $("account-label").textContent = `${identity.name} · ${identity.label}`;
    $("account-label").hidden = false;
    $("access-panel").hidden = true;
    $("training-app").hidden = false;
    $("analysis-tab").hidden = !identity.isOrganizer;
    setView(state.view);
    if (!previous?.allowed || previous.uid !== identity.uid || previous.isOrganizer !== identity.isOrganizer || !state.stop) loadYear();
  }

  $("entry-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy || state.loading || !state.identity?.allowed) return;
    const fields = { date: $("entry-date").value, meters: $("entry-meters").value,
      motivation: $("entry-motivation").value, text: $("entry-text").value };
    let validated;
    try { validated = core.validateEntry(fields); }
    catch (error) { formMessage(error.message, true); return; }
    const wasEdit = Boolean(state.editing);
    state.busy = true;
    $("entry-form").querySelectorAll("input, textarea, button").forEach((control) => { control.disabled = true; });
    $("save-entry").textContent = "Wird gespeichert …";
    renderDiary();
    try {
      await store.saveEntry(validated, state.editing);
      if (!state.identity?.allowed) return;
      resetForm(false);
      formMessage(wasEdit ? "Dein Training wurde aktualisiert." : "Dein Training ist gespeichert.");
      const savedYear = validated.date.slice(0, 4);
      $("diary-month").value = "";
      if ($("year-filter").value !== savedYear) { $("year-filter").value = savedYear; loadYear(); }
    } catch (error) { formMessage(error.message, true); }
    finally {
      state.busy = false;
      $("entry-form").querySelectorAll("input, textarea, button").forEach((control) => { control.disabled = state.loading; });
      $("save-entry").textContent = state.editing ? "Änderungen speichern" : "Training speichern ↗";
      renderDiary();
    }
  });

  $("confirm-delete").addEventListener("click", async () => {
    if (!state.deleting || state.busy) return;
    const entry = state.deleting;
    state.busy = true;
    $("confirm-delete").disabled = true;
    $("cancel-delete").disabled = true;
    try {
      await store.deleteEntry(entry);
      if (state.editing?.id === entry.id) resetForm();
      $("delete-dialog").close();
      formMessage("Das Training wurde gelöscht.");
      state.deleting = null;
    } catch (error) { $("delete-error").textContent = error.message; }
    finally {
      state.busy = false;
      $("confirm-delete").disabled = false;
      $("cancel-delete").disabled = false;
      renderDiary();
    }
  });
  $("cancel-delete").addEventListener("click", () => { $("delete-dialog").close(); state.deleting = null; });
  $("delete-dialog").addEventListener("cancel", (event) => { if (state.busy) event.preventDefault(); else state.deleting = null; });
  $("cancel-edit").addEventListener("click", () => resetForm());
  $("entry-motivation").addEventListener("input", syncForm);
  $("entry-text").addEventListener("input", syncForm);
  document.querySelectorAll("[data-view]").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
  $("year-filter").addEventListener("change", loadYear);
  $("refresh-data").addEventListener("click", loadYear);
  $("diary-month").addEventListener("change", renderDiary);
  $("ranking-month").addEventListener("change", renderRankings);
  $("analysis-athlete").addEventListener("change", renderAnalysis);
  $("analysis-month").addEventListener("change", renderAnalysis);
  $("export-analysis").addEventListener("click", () => {
    if (!state.identity?.isOrganizer) return;
    const cell = (value) => {
      const text = String(value ?? "");
      const safe = /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = [["Datum", "Sportler", "Meter", "Motivation (1–10)"]];
    analysisEntries().sort((a, b) => a.date.localeCompare(b.date) || a.athleteName.localeCompare(b.athleteName, "de"))
      .forEach((entry) => rows.push([entry.date, entry.athleteName, entry.meters, entry.motivation]));
    const blob = new Blob(["\ufeff", rows.map((row) => row.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = node("a");
    anchor.href = url;
    anchor.download = `training-${period($("analysis-month").value)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener("pagehide", () => { state.stop?.(); state.stop = null; });
  window.addEventListener("pageshow", (event) => { if (event.persisted && state.identity?.allowed) loadYear(); });
  resetForm();
  store.start(access).catch((error) => access({ error: error.message }));
})();
