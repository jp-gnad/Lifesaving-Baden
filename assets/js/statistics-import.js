(function () {
  "use strict";

  const authCore = window.LifesavingAuth;
  const excel = window.LifesavingStatisticsExcel;
  const store = window.LifesavingStatisticsStore;
  const ui = Object.fromEntries([...document.querySelectorAll('[id^="import-"]')]
    .map(element => [element.id.slice(7), element]));
  const actionLabels = { new: "Neu", update: "Geändert", same: "Unverändert" };
  const collectionLabels = { statsAthletes: "Sportler", statsOrganizations: "Organisationen",
    statsDisciplines: "Disziplinen", statsCompetitions: "Wettkampf", statsResults: "Ergebnisse" };
  const labels = {
    place: "Platz", rankingStatus: "Wertung", timeMs: "Zeit", points: "Punkte", faultCode: "Fehlercode",
    penaltyPoints: "Strafpunkte", status: "Status", overallPoints: "Mehrkampfpunkte", lsc: "LSC",
    startRight: "Startrecht", classification: "Wertungsart", ageGroup: "Altersklasse", gender: "Geschlecht",
    ogId: "Ortsgruppe", bzId: "Bezirk", lvId: "Landesverband", bvId: "Bundesverband",
    name: "Name", fullName: "Langname", date: "Datum", city: "Ort", country: "Land", rule: "Regelwerk",
    poolLength: "Beckenlänge", phaseCount: "Phasenanzahl", distance: "Distanz", sortOrder: "Reihenfolge",
    category: "Kategorie",
  };
  const statusLabels = { AK: "außer Konkurrenz", EXCLUDED: "ausgeschlossen", OK: "regulär", DQ: "disqualifiziert",
    DNS: "nicht angetreten", PASS: "bestanden", FAIL: "nicht bestanden" };
  const localeNumber = new Intl.NumberFormat("de-DE");
  const pageSize = 25;
  let generation = 0, user = null, workbook = null, sheet = null, plan = null;
  let busy = false, writable = false, page = 0, lvNamesPromise;

  const el = (tag, value) => {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    return node;
  };

  function status(text, state = "") {
    ui.status.textContent = text;
    ui.status.dataset.state = state;
    ui.status.hidden = !text;
  }

  function errors(messages) {
    ui["error-list"].replaceChildren(...messages.map(message => el("li", message)));
    ui.errors.hidden = !messages.length;
  }

  function controls() {
    for (const node of [ui.pick, ui.file, ui.sheet, ui.event]) node.disabled = busy;
    ui.review.disabled = busy || !sheet?.events.has(ui.event.value);
    ui.confirm.disabled = busy || !writable;
  }

  function resetPreview() {
    plan = null;
    writable = false;
    ui.preview.hidden = true;
    for (const key of ["summary", "collections", "metadata-changes", "results"]) ui[key].replaceChildren();
    errors([]);
    status("");
    controls();
  }

  function setOptions(select, values) {
    select.replaceChildren(...values.map(([key, text]) => {
      const option = el("option", text);
      option.value = key;
      return option;
    }));
  }

  function selectSheet() {
    resetPreview();
    sheet = null;
    setOptions(ui.event, []);
    try {
      sheet = excel.inspectSheet(excel.readSheet(workbook.Sheets[ui.sheet.value], window.XLSX));
      const events = [...sheet.events].sort(([a], [b]) => a.localeCompare(b, "de"));
      setOptions(ui.event, events.map(([name, rows]) => [name, `${name} (${rows.length} ${rows.length === 1 ? "Zeile" : "Zeilen"})`]));
      if (!events.length) status("Dieses Tabellenblatt enthält keine Wettkampfdaten.", "error");
    } catch (error) {
      errors([error.message]);
      status("Wähle das Tabellenblatt mit den Wettkampfdaten oder prüfe die Excel-Datei.", "error");
    }
    controls();
  }

  function requireSession(version) {
    if (version !== generation || !user || !authCore.isCurrentUser(user)) {
      throw new Error("Die Anmeldung hat sich geändert. Bitte die Seite neu öffnen.");
    }
  }

  async function openFile(file) {
    if (!file || busy || !user) return;
    if (!excel || !store || !window.XLSX || !window.crypto?.subtle) {
      status("Der Excel-Import ist hier nicht verfügbar. Öffne die Seite über die Website in einem aktuellen Browser.", "error");
      return;
    }
    workbook = null;
    sheet = null;
    ui.selectors.hidden = true;
    ui.filename.hidden = true;
    ui.filename.textContent = "";
    resetPreview();
    if (!/\.xls[xm]$/i.test(file.name) || !file.size || file.size > 30 * 1024 * 1024) {
      status("Bitte eine .xlsx- oder .xlsm-Datei bis 30 MB auswählen.", "error");
      return;
    }
    const version = generation;
    busy = true;
    controls();
    status("Excel-Datei wird gelesen …");
    try {
      const buffer = await file.arrayBuffer();
      requireSession(version);
      const signature = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
      if (signature.join(",") !== "80,75,3,4") throw new Error("Ungültiges Excel-Format.");
      workbook = window.XLSX.read(buffer, { type: "array", cellNF: true, sheetStubs: true, cellHTML: false });
      if (!workbook.SheetNames.length) throw new Error("Kein Tabellenblatt.");
      ui.filename.textContent = file.name;
      ui.filename.hidden = false;
      const tabs = workbook.Workbook?.Sheets ?? [];
      setOptions(ui.sheet, workbook.SheetNames.map((name, index) => [name, tabs[index]?.Hidden ? `${name} (ausgeblendet)` : name]));
      ui.selectors.hidden = false;
      selectSheet();
    } catch {
      if (version === generation) status("Die Excel-Datei konnte nicht geöffnet werden. Prüfe das Format und einen möglichen Kennwortschutz.", "error");
    } finally {
      if (version === generation) {
        busy = false;
        controls();
      }
    }
  }

  let organizations = new Map(), athletes = new Map(), disciplines = new Map();
  function valueText(value, key) {
    if (value == null || value === "") return "—";
    if (key === "status" || key === "rankingStatus") return statusLabels[value] ?? value;
    if (key === "timeMs") {
      const minutes = Math.floor(value / 60000);
      const seconds = String(Math.floor(value / 1000) % 60).padStart(2, "0");
      const fraction = value % 1000;
      return `${minutes}:${seconds},${fraction % 10 ? String(fraction).padStart(3, "0") : String(fraction / 10).padStart(2, "0")}`;
    }
    if (typeof value === "number") return localeNumber.format(value);
    return organizations.get(value) ?? value;
  }

  function changeText(key, before, after) {
    return `${labels[key] ?? key}: ${valueText(before, key)} → ${valueText(after, key)}`;
  }

  function resultDetails(item) {
    const athlete = athletes.get(item.data.athleteId);
    const suffix = athlete.discriminator ? ` (${athlete.discriminator})` : "";
    const details = el("details");
    details.append(el("summary", `${athlete.lastName}, ${athlete.firstName}${suffix}`));
    const list = el("ul");
    const before = item.before?.disciplines ?? {};
    const after = item.data.disciplines;
    for (const [id, data] of Object.entries(after)) {
      const values = ["place", "timeMs", "points", "rankingStatus", "status", "faultCode", "penaltyPoints"]
        .filter(key => data[key] != null && !(key === "status" && data.status === "OK"))
        .map(key => `${labels[key]} ${valueText(data[key], key)}`);
      list.append(el("li", [disciplines.get(id), ...values].join(" · ")));
      if (item.action === "update") {
        for (const key of new Set([...Object.keys(before[id] ?? {}), ...Object.keys(data)])) {
          if ((before[id]?.[key] ?? null) === (data[key] ?? null)) continue;
          const change = el("li", `${disciplines.get(id)} · ${changeText(key, before[id]?.[key], data[key])}`);
          change.className = "statistics-result-changes";
          list.append(change);
        }
      }
    }
    if (item.action === "update") {
      for (const id of Object.keys(before)) {
        if (!Object.hasOwn(after, id)) list.append(el("li", `${disciplines.get(id) ?? id} entfällt.`));
      }
      for (const key of item.fields.filter(field => field !== "disciplines")) {
        list.append(el("li", changeText(key, item.before[key], item.data[key])));
      }
    }
    if (!list.childElementCount) list.append(el("li", "Keine Disziplin eingetragen."));
    details.append(list);
    return details;
  }

  function renderResults() {
    const event = plan.find(item => item.collection === "statsCompetitions").data;
    const items = plan.filter(item => item.collection === "statsResults" &&
      (!ui["changes-only"].checked || item.action !== "same"));
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    page = Math.min(page, pages - 1);
    ui.results.replaceChildren();
    for (const item of items.slice(page * pageSize, (page + 1) * pageSize)) {
      const { round, place, rankingStatus, overallPoints } = item.data;
      const phase = round == null ? "Direktes Finale" : event.phaseCount === 1 ? "Einzelner Durchgang"
        : round === 1 ? "Vorlauf" : round === event.phaseCount ? "Finale" : "Zwischenlauf";
      const tr = el("tr");
      const person = el("td");
      person.append(resultDetails(item));
      tr.append(el("td", item.row), person, el("td", phase),
        el("td", valueText(rankingStatus ?? place, rankingStatus ? "rankingStatus" : "place")),
        el("td", valueText(overallPoints)), el("td", actionLabels[item.action]));
      ui.results.append(tr);
    }
    if (!items.length) {
      const row = el("tr"), cell = el("td", "Keine geänderten Ergebnisse.");
      cell.colSpan = 6;
      row.append(cell);
      ui.results.append(row);
    }
    ui.pagination.hidden = pages <= 1;
    ui.page.textContent = `Seite ${page + 1} von ${pages}`;
    ui.prev.disabled = page === 0;
    ui.next.disabled = page + 1 === pages;
  }

  function renderPreview(prepared, versionPlan) {
    plan = versionPlan;
    page = 0;
    const categories = Object.fromEntries(Object.keys(collectionLabels).map(key => [key, { new: 0, update: 0, same: 0 }]));
    const result = categories.statsResults;
    organizations = new Map();
    athletes = new Map();
    disciplines = new Map();
    for (const item of plan) {
      categories[item.collection][item.action]++;
      if (item.collection === "statsOrganizations") organizations.set(item.id, item.data.name);
      if (item.collection === "statsAthletes") athletes.set(item.id, item.data);
      if (item.collection === "statsDisciplines") disciplines.set(item.id, item.data.name);
    }
    const writes = plan.filter(item => item.action !== "same").length;
    writable = writes > 0;
    const date = prepared.competition.data.date.split("-").reverse().join(".");
    ui["preview-event"].textContent = `${prepared.competition.data.name} · ${date}`;
    ui.summary.replaceChildren(...[
      ["Ergebniszeilen", result.new + result.update + result.same], ["Disziplineinträge", prepared.starts],
      ["Neue Ergebnisse", result.new], ["Geänderte Ergebnisse", result.update],
      ["Unveränderte Ergebnisse", result.same], ["Dokumente zu speichern", writes],
    ].map(([name, count]) => {
      const card = el("div");
      card.append(el("dt", name), el("dd", localeNumber.format(count)));
      return card;
    }));
    ui.collections.replaceChildren(...Object.entries(categories).map(([key, count]) => {
      const row = el("tr");
      row.append(...[collectionLabels[key], count.new, count.update, count.same].map(value => el("td", value)));
      return row;
    }));
    ui["metadata-changes"].replaceChildren(...plan.filter(item => item.action !== "same" && item.collection !== "statsResults")
      .map(item => {
        const name = item.data.name ?? `${item.data.lastName}, ${item.data.firstName}`;
        const changes = item.action === "update" ? item.fields.map(key => changeText(key, item.before[key], item.data[key])) : [];
        return el("li", [collectionLabels[item.collection], name, actionLabels[item.action], ...changes].join(" · "));
      }));
    ui["confirm-count"].textContent = `${prepared.competition.data.name}: ${writes} Dokumente werden angelegt oder aktualisiert.`;
    renderResults();
    ui.preview.hidden = false;
    status(writes ? "Vorschau bereit. Prüfe die Änderungen vor dem Speichern." : "Alle Einträge sind bereits auf dem aktuellen Stand.");
    ui["preview-title"].focus();
  }

  function lvNames() {
    lvNamesPromise ??= fetch("tools/lib/dlrg-landesverbaende.json").then(response => {
      if (!response.ok) throw new Error("Die Liste der Landesverbände konnte nicht geladen werden.");
      return response.json();
    }).catch(error => {
      lvNamesPromise = null;
      throw error;
    });
    return lvNamesPromise;
  }

  function describeError(error) {
    if (["permission-denied", "firestore/permission-denied"].includes(error.code)) {
      return "Firestore hat den Zugriff auf das Ergebnisarchiv abgelehnt. Prüfe die Admin-Rechte und die veröffentlichten Datenbankregeln.";
    }
    return error.message || "Ein unerwarteter Fehler ist aufgetreten.";
  }

  async function review(db) {
    if (busy || !sheet?.events.has(ui.event.value)) return;
    const version = generation;
    resetPreview();
    busy = true;
    controls();
    try {
      status("Ergebniszeilen werden geprüft …");
      const names = await lvNames();
      requireSession(version);
      const prepared = await excel.prepare(sheet, ui.event.value, workbook.Workbook?.WBProps?.date1904, names);
      requireSession(version);
      if (prepared.errors.length) {
        errors(prepared.errors);
        status(`${prepared.errors.length} Excel-Zeilen prüfen.`, "error");
        return;
      }
      status("Daten werden mit Firestore verglichen …");
      const compared = await store.compare(db, prepared.records, names, () => requireSession(version));
      requireSession(version);
      renderPreview(prepared, compared);
    } catch (error) {
      if (version === generation) status(describeError(error), "error");
    } finally {
      if (version === generation) {
        busy = false;
        controls();
      }
    }
  }

  async function save(db) {
    if (!writable || busy || !plan) return;
    const version = generation;
    let saved = 0;
    busy = true;
    writable = false;
    controls();
    status("Import wird gespeichert …");
    try {
      await store.apply(db, plan, () => requireSession(version), (done, total) => {
        saved = done;
        status(`${done} von ${total} Dokumenten gespeichert …`);
      });
      status(`Import abgeschlossen. ${saved} Dokumente gespeichert.`, "success");
    } catch (error) {
      if (version === generation) {
        status(`${describeError(error)} ${saved} Schreibvorgänge bestätigt. Mit einer neuen Vorschau kannst du den Import fortsetzen.`, "error");
      }
    } finally {
      if (version === generation) {
        if (saved) {
          overview.reset();
          structure.reset();
          if (!ui.overview.hidden) overview.show();
          if (!ui.structure.hidden) structure.show();
        }
        busy = false;
        controls();
      }
    }
  }

  if (!authCore || !window.isFirebaseConfigured || !window.firebase?.auth) {
    ui.auth.textContent = "Die Datenbank ist hier nicht verfügbar. Öffne die Seite über die Website.";
    return;
  }
  const auth = authCore.initFirebase();
  const db = window.firebase.firestore();
  const sessionActive = () => user && authCore.isCurrentUser(user);
  const overview = window.LifesavingStatisticsOverview.create(db, sessionActive);
  const structure = window.LifesavingStatisticsStructure.create(db, sessionActive, lvNames);

  function showSection() {
    if (!user) return;
    const importing = window.location.hash === "#importieren";
    const inspecting = window.location.hash === "#struktur";
    const browsing = !importing && !inspecting;
    ui.pane.hidden = !importing;
    ui.overview.hidden = !browsing;
    ui.structure.hidden = !inspecting;
    ui["overview-link"].setAttribute("aria-current", browsing ? "page" : "false");
    ui["source-link"].setAttribute("aria-current", importing ? "page" : "false");
    ui["structure-link"].setAttribute("aria-current", inspecting ? "page" : "false");
    if (browsing) overview.show();
    else overview.hide();
    if (inspecting) structure.show();
    else structure.hide();
  }

  window.addEventListener("hashchange", showSection);
  auth.onAuthStateChanged(async current => {
    const version = ++generation;
    user = workbook = sheet = null;
    organizations.clear();
    athletes.clear();
    disciplines.clear();
    busy = false;
    overview.hide();
    overview.reset();
    structure.hide();
    structure.clear();
    resetPreview();
    ui.dialog.close();
    ui.app.hidden = ui.selectors.hidden = ui.filename.hidden = true;
    ui.filename.textContent = ui.file.value = "";
    setOptions(ui.sheet, []);
    setOptions(ui.event, []);
    ui.auth.hidden = false;
    ui.auth.textContent = "Anmeldung wird geprüft …";
    if (!current) return authCore.redirectToLogin();
    try {
      const active = await authCore.reloadUser(current);
      if (version !== generation) return;
      if (!await authCore.hasVerifiedAccess(active)) {
        if (version === generation) authCore.redirectToLogin("needsVerification");
        return;
      }
      const { userData, claims, fromCache } = await authCore.loadUserContext(active);
      if (version !== generation || !authCore.isCurrentUser(active)) return;
      if (fromCache) throw new Error("Die Admin-Rechte konnten nicht online geprüft werden.");
      if (!authCore.getAccountRole(userData, claims).isAdmin || userData.accountDeletionStartedAt != null) {
        ui.auth.textContent = "Der Wettkampfimport ist nur für Admins verfügbar.";
        return;
      }
      user = active;
      ui.auth.textContent = "";
      ui.auth.hidden = true;
      ui.app.hidden = false;
      showSection();
    } catch (error) {
      if (version === generation) ui.auth.textContent = describeError(error);
    }
  });
  ui.pick.addEventListener("click", () => ui.file.click());
  ui.file.addEventListener("change", () => {
    const file = ui.file.files[0];
    ui.file.value = "";
    openFile(file);
  });
  window.addEventListener("dragover", event => {
    if (user && !ui.pane.hidden && event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  window.addEventListener("drop", event => {
    if (user && !ui.pane.hidden && event.dataTransfer?.files.length) event.preventDefault();
  });
  ui.drop.addEventListener("dragover", event => {
    if (!event.dataTransfer?.types.includes("Files") || busy) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    ui.drop.classList.add("is-dragging");
  });
  ui.drop.addEventListener("dragleave", event => {
    if (!ui.drop.contains(event.relatedTarget)) ui.drop.classList.remove("is-dragging");
  });
  ui.drop.addEventListener("drop", event => {
    event.preventDefault();
    ui.drop.classList.remove("is-dragging");
    if (!busy && event.dataTransfer?.files.length > 1) status("Bitte jeweils eine Excel-Datei auswählen.", "error");
    else openFile(event.dataTransfer?.files[0]);
  });
  ui.sheet.addEventListener("change", selectSheet);
  ui.event.addEventListener("change", resetPreview);
  ui.review.addEventListener("click", () => review(db));
  ui["changes-only"].addEventListener("change", () => { page = 0; if (plan) renderResults(); });
  ui.prev.addEventListener("click", () => { if (plan && page > 0) { page--; renderResults(); } });
  ui.next.addEventListener("click", () => { if (plan) { page++; renderResults(); } });
  ui.confirm.addEventListener("click", () => {
    if (!writable || busy) return;
    ui.dialog.returnValue = "";
    ui.dialog.showModal();
  });
  ui.dialog.addEventListener("close", () => {
    if (ui.dialog.returnValue === "confirm") save(db);
  });
})();
