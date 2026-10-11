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
  }

  function syncDate() {
    const date = $("entry-date").value;
    const label = date === core.today() ? "Heute" : date ? date.split("-").reverse().join(".") : "Datum";
    $("date-toggle").textContent = `${label} ⌄`;
    $("date-toggle").setAttribute("aria-label", `${label}, Trainingsdatum ändern`);
  }

  function formMessage(text, error = false) {
    $("form-message").textContent = text;
    $("form-message").classList.toggle("error", error);
  }

  function resetForm(clearMessage = true) {
    state.editing = null;
    $("entry-form").reset();
    $("entry-date").value = core.today();
    $("entry-date").max = core.today();
    $("entry-title").textContent = "Neues Training";
    $("save-entry").textContent = "Speichern";
    $("cancel-edit").hidden = true;
    $("date-field").hidden = true;
    $("date-toggle").setAttribute("aria-expanded", "false");
    syncForm();
    syncDate();
    if (clearMessage) formMessage("");
  }

  function stats(target, items) {
    target.replaceChildren(...items.map(([label, value, note]) => {
      const element = node("article", "stat");
      element.append(node("p", "stat-label", label), node("p", "stat-value", value), node("p", "stat-note", note));
      return element;
    }));
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
    $("save-entry").textContent = "Speichern";
    $("cancel-edit").hidden = false;
    formMessage("");
    syncForm();
    syncDate();
    setView("diary");
    $("entry-meters").focus({ preventScroll: true });
  }

  function renderDiary() {
    const entries = core.inPeriod(ownEntries(), period($("diary-month").value))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    $("history-total").textContent = core.formatMeters(core.summary(entries).meters);
    $("history-count").textContent = String(entries.length);
    $("history-title").textContent = "Deine Trainings";
    if (!entries.length) {
      empty($("entry-list"), state.loading ? "Wird geladen …" : "Noch keine Trainings", "");
      return;
    }
    $("entry-list").replaceChildren(...entries.map((entry) => {
      const article = node("details", "entry");
      const top = node("summary", "entry-top");
      const date = node("time", "entry-date", new Intl.DateTimeFormat("de-DE", {
        day: "2-digit", month: "short", timeZone: "UTC"
      }).format(new Date(`${entry.date}T00:00:00Z`)));
      date.dateTime = entry.date;
      const motivation = node("span", "entry-motivation", `${entry.motivation}/10`);
      motivation.title = "Motivation";
      motivation.setAttribute("aria-label", `Motivation ${entry.motivation} von 10`);
      top.append(date, node("span", "entry-meters", core.formatMeters(entry.meters)), motivation);
      article.append(top);
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
    if (!ranked.length) { empty(target, "Noch keine Trainings", ""); return; }
    const list = node("div", "rank-list");
    list.setAttribute("role", "list");
    ranked.forEach((athlete) => {
      const row = node("div", `rank-row${athlete.uid === state.identity.uid ? " is-me" : ""}`);
      row.setAttribute("role", "listitem");
      const name = node("div", "rank-name", `${athlete.name}${athlete.uid === state.identity.uid ? " · Du" : ""}`);
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
      ["Meter", core.formatMeters(sum.meters), ""],
      ["Trainings", core.formatNumber(sum.count), ""],
      ["Ø Motivation", sum.motivation === null ? "—" : `${core.formatDecimal(sum.motivation)} / 10`, ""]
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
    if (!entries.length) { empty($("athlete-table"), "Noch keine Daten", ""); return; }
    const table = node("table");
    const caption = node("caption", "", "Trainingsauswertung nach Sportler");
    caption.hidden = true;
    table.append(caption);
    const head = node("thead");
    const header = node("tr");
    ["Sportler", "Meter", "Trainings", "Ø Mot."].forEach((label) => {
      const th = node("th", "", label);
      th.scope = "col";
      if (label === "Ø Mot.") th.setAttribute("aria-label", "Durchschnittliche Motivation");
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
      [core.formatNumber(totals.meters), String(totals.count),
        totals.motivation === null ? "—" : `${core.formatDecimal(totals.motivation)} / 10`]
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
    ["diary", "history", "ranking", "analysis"].forEach((name) => { $(`view-${name}`).hidden = name !== view; });
    $("period-bar").hidden = view === "diary";
  }

  function loadYear() {
    state.stop?.();
    state.stop = null;
    state.entries = [];
    state.loading = true;
    $("data-error-shell").hidden = true;
    $("sync-status").hidden = false;
    $("sync-status").textContent = "Wird geladen …";
    render();
    state.stop = store.watchYear($("year-filter").value, (entries) => {
      state.entries = entries;
      state.loading = false;
      $("sync-status").hidden = true;
      $("data-error-shell").hidden = true;
      render();
    }, (error) => {
      state.loading = false;
      $("data-error").textContent = error.message;
      $("data-error-shell").hidden = false;
      $("sync-status").hidden = true;
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
        $("access-title").textContent = "Wird geladen …";
        $("access-message").textContent = "Zugang wird geprüft.";
      } else if (identity.error) {
        $("access-title").textContent = "Verbindung nicht möglich";
        $("access-message").textContent = identity.error;
      } else if (!identity.signedIn || !identity.verified) {
        $("access-title").textContent = "Melde dich an";
        $("access-message").textContent = "Bitte nutze dein bestätigtes Kader-Konto.";
        const target = new URL("../login.html", window.location.href);
        target.searchParams.set("returnTo", window.location.href);
        $("access-action").href = target.href;
        $("access-action").textContent = "Zur Anmeldung";
      } else {
        $("access-title").textContent = "Für den Kader reserviert";
        $("access-message").textContent = "Zugang ab Kader-Sportler.";
        $("access-action").href = "../app.html";
        $("access-action").textContent = "Zu Home";
      }
      return;
    }
    $("account-label").textContent = identity.name;
    $("account-label").hidden = false;
    $("access-panel").hidden = true;
    $("training-app").hidden = false;
    $("analysis-tab").hidden = !identity.isOrganizer;
    setView(state.view);
    if (!previous?.allowed || previous.uid !== identity.uid || previous.isOrganizer !== identity.isOrganizer || !state.stop) loadYear();
  }

  $("entry-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy || !state.identity?.allowed) return;
    const fields = { date: $("entry-date").value, meters: $("entry-meters").value,
      motivation: $("entry-motivation").value, text: $("entry-text").value };
    let validated;
    try { validated = core.validateEntry(fields); }
    catch (error) { formMessage(error.message, true); return; }
    const wasEdit = Boolean(state.editing);
    state.busy = true;
    $("date-toggle").disabled = true;
    $("entry-form").querySelectorAll("input, textarea, button").forEach((control) => { control.disabled = true; });
    $("save-entry").textContent = "Speichert …";
    renderDiary();
    try {
      await store.saveEntry(validated, state.editing);
      if (!state.identity?.allowed) return;
      resetForm(false);
      formMessage(wasEdit ? "Aktualisiert ✓" : "Gespeichert ✓");
      const savedYear = validated.date.slice(0, 4);
      $("diary-month").value = "";
      if (![...$("year-filter").options].some((option) => option.value === savedYear)) {
        const option = node("option", "", savedYear);
        option.value = savedYear;
        $("year-filter").prepend(option);
      }
      if ($("year-filter").value !== savedYear) { $("year-filter").value = savedYear; loadYear(); }
    } catch (error) { formMessage(error.message, true); }
    finally {
      state.busy = false;
      $("date-toggle").disabled = false;
      $("entry-form").querySelectorAll("input, textarea, button").forEach((control) => { control.disabled = false; });
      $("save-entry").textContent = "Speichern";
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
      formMessage("Gelöscht ✓");
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
  $("entry-date").addEventListener("change", syncDate);
  $("entry-date").addEventListener("invalid", () => {
    $("date-field").hidden = false;
    $("date-toggle").setAttribute("aria-expanded", "true");
  });
  $("date-toggle").addEventListener("click", () => {
    $("date-field").hidden = !$("date-field").hidden;
    $("date-toggle").setAttribute("aria-expanded", String(!$("date-field").hidden));
    if (!$("date-field").hidden) $("entry-date").focus();
  });
  document.querySelectorAll("[data-view]").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
  $("year-filter").addEventListener("change", loadYear);
  $("refresh-data").addEventListener("click", loadYear);
  $("retry-data").addEventListener("click", loadYear);
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
