(function () {
  "use strict";

  const core = window.LifesavingStatisticsOverviewCore;
  const competitionPageSize = 20;
  const resultPageSize = 50;
  const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 6 });
  const pointsText = value => Number.isFinite(value) ? number.format(value) : "—";
  const dateText = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join(".") : "";
  const collectionNames = ["statsAthletes", "statsOrganizations", "statsDisciplines"];
  const collectionKey = (collection, id) => `${collection}/${id}`;
  const disciplineColumns = [["Zeit", ""], ["Punkte", "archive-points"], ["Strafcode", ""], ["Strafe", ""]];
  const hlwColumns = [["Punkte", "archive-points"], ["Status", ""]];
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  function compareDisciplines(lookups, a, b) {
    return (lookups.disciplines.get(a)?.sortOrder ?? 99) - (lookups.disciplines.get(b)?.sortOrder ?? 99) || a.localeCompare(b);
  }

  function disciplineName(lookups, id) {
    return lookups.disciplines.get(id)?.name ?? id;
  }

  function disciplineValues(entry, hlw) {
    const penalty = core.penalties(entry, pointsText);
    return hlw ? [pointsText(entry.points), penalty]
      : [core.timeText(entry.timeMs), pointsText(entry.points), entry.faultCode || "-", penalty];
  }

  function renderTable(group, data, lookups, label) {
    const table = element("table", null, "statistics-archive-table");
    table.setAttribute("aria-label", label);
    const single = group.disciplineId;
    const hlwOnly = single === "D018";
    const disciplines = single ? [] : [...new Set(group.rows.flatMap(row => Object.keys(row.disciplines ?? {})))]
      .sort((a, b) => compareDisciplines(lookups, a, b));
    table.classList.toggle("statistics-archive-table-hlw", hlwOnly);
    const columns = [["Nachname, Vorname", "archive-person"], ["Gliederung", "archive-org"], ["Jahrgang (JJ)", "archive-year"]];
    if (!hlwOnly) columns.unshift([single ? "Platzierung" : "Gesamtplatzierung", "archive-place"]);
    if (single) columns.push(...(hlwOnly ? hlwColumns : disciplineColumns));
    else columns.push(["Gesamtpunkte", "archive-points"]);
    const columnWidths = element("colgroup");
    const head = table.createTHead(), first = head.insertRow();
    const second = disciplines.length ? head.insertRow() : null;
    for (const [title, className] of columns) {
      columnWidths.append(element("col", null, className));
      const th = element("th", title, className);
      th.scope = "col";
      th.rowSpan = second ? 2 : 1;
      if (className === "archive-place") {
        th.setAttribute("aria-label", title);
        th.replaceChildren(element("span", single ? title : "Gesamt­platzierung", "archive-wide-label"),
          element("span", "Platz", "archive-narrow-label"));
      }
      first.append(th);
    }
    table.prepend(columnWidths);
    for (const id of disciplines) {
      const fields = id === "D018" ? hlwColumns : [["Platzierung", ""], ...disciplineColumns];
      const columnGroup = element("colgroup", null, "archive-discipline");
      for (const [index, [title]] of fields.entries()) {
        columnGroup.append(element("col"));
        const th = element("th", title, index === 0 ? "archive-discipline-start" : "");
        th.scope = "col";
        second.append(th);
      }
      table.insertBefore(columnGroup, head);
      const title = element("th", disciplineName(lookups, id), "archive-discipline-start");
      title.scope = "colgroup";
      title.colSpan = fields.length;
      first.append(title);
    }
    const body = table.createTBody();
    for (const row of core.sortRows(group.rows, data.overall, lookups.athletes, single)) {
      const athlete = lookups.athletes.get(row.athleteId);
      const overall = data.overall.get(row.athleteId);
      const person = element("th", core.name(athlete), "archive-person");
      person.scope = "row";
      if (single && overall) person.append(element("small", `${core.placing(null, overall)} gesamt`, "archive-person-status"));
      const tr = body.insertRow();
      const singleEntry = single ? row.disciplines[single] : null;
      if (!hlwOnly) {
        const place = single ? core.placing(singleEntry.place, singleEntry.rankingStatus) : core.placing(row.place, overall);
        tr.append(element("td", place, "archive-place"));
      }
      tr.append(person,
        element("td", lookups.organizations.get(core.organizationId(row))?.name ?? "—", "archive-org"),
        element("td", core.birthYearText(athlete?.birthYear), "archive-year"));
      if (single) {
        const fields = hlwOnly ? hlwColumns : disciplineColumns;
        tr.append(...disciplineValues(singleEntry, hlwOnly).map((value, index) => element("td", value, fields[index][1])));
      } else {
        tr.append(element("td", pointsText(row.overallPoints), "archive-points"));
      }
      for (const id of disciplines) {
        const entry = row.disciplines?.[id] ?? {};
        const values = disciplineValues(entry, id === "D018");
        if (id !== "D018") values.unshift(core.placing(entry.place, entry.rankingStatus));
        tr.append(...values.map((value, index) => element("td", value, index === 0 ? "archive-discipline-start" : "")));
      }
    }
    const region = element("div", null, "statistics-archive-scroll");
    region.tabIndex = 0;
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", `Ergebnistabelle ${label}`);
    region.append(table);
    return region;
  }

  function renderSection(content, section, data, lookups, phaseCount, inline) {
    const { disciplineId, tables } = section;
    const discipline = disciplineId ? disciplineName(lookups, disciplineId) : null;
    const title = discipline
      ? [discipline, tables.length === 1 && phaseCount > 1 ? tables[0].label : null].filter(Boolean).join(" – ")
      : section.label;
    const panels = element("div", null, "statistics-archive-panels");

    function showTables() {
      if (discipline && tables.length > 1) {
        const controls = element("div", null, "statistics-archive-phases");
        controls.setAttribute("role", "group");
        controls.setAttribute("aria-label", `Wettkampfphase für ${discipline}`);
        const result = element("div");
        const buttons = tables.map(table => {
          const button = element("button", table.label);
          button.type = "button";
          button.addEventListener("click", () => select(table));
          return button;
        });
        function select(table) {
          buttons.forEach((button, index) => button.setAttribute("aria-pressed", String(tables[index] === table)));
          result.replaceChildren(renderTable(table, data, lookups, `${discipline} – ${table.label}`));
        }
        controls.append(...buttons);
        panels.append(controls, result);
        select(tables[0]);
        return;
      }
      for (const table of tables) {
        if (tables.length > 1) panels.append(element("h3", table.classification || "Wertung ohne Angabe"));
        const label = discipline ? title : [table.label, table.classification].filter(Boolean).join(" · ");
        panels.append(renderTable(table, data, lookups, label));
      }
    }

    if (inline) {
      if (discipline) panels.append(element("h3", title));
      content.append(panels);
      showTables();
      return;
    }
    const block = element("details", null, "statistics-archive-section");
    block.append(element("summary", title), panels);
    block.addEventListener("toggle", () => {
      if (block.open && !panels.hasChildNodes()) showTables();
    });
    content.append(block);
  }

  function create(db, sessionActive) {
    const ui = Object.fromEntries([...document.querySelectorAll('[id^="archive-"]')]
      .map(node => [node.id.slice(8), node]));
    let active = false, version = 0, cursor = null, loading = false, finished = false, selected = null;
    let counts = 0;
    let cache = new Map();

    function inView(next) {
      return next === version && active && sessionActive();
    }

    function message(node, text, state = "") {
      node.textContent = text;
      node.hidden = !text;
      node.dataset.state = state;
    }

    function requireDetail(event) {
      if (event !== selected || !inView(event.version)) throw new Error("Der Wettkampf ist nicht mehr geöffnet.");
    }

    function loadDoc(event, collection, id) {
      if (!id) return Promise.resolve(null);
      const key = collectionKey(collection, id);
      const lookup = cache.get(key);
      if (lookup) return lookup;
      const pending = db.collection(collection).doc(id).get({ source: "server" }).then(doc => {
        requireDetail(event);
        return doc.exists ? doc.data() : null;
      }).catch(error => {
        if (cache.get(key) === pending) cache.delete(key);
        throw error;
      });
      cache.set(key, pending);
      return pending;
    }

    async function loadGroup(event, rows) {
      const ids = [
        new Set(rows.map(row => row.athleteId).filter(Boolean)),
        new Set(rows.map(core.organizationId).filter(Boolean)),
        new Set(rows.flatMap(row => Object.keys(row.disciplines ?? {}))),
      ];
      const docs = ids.flatMap((list, index) => [...list].map(id => [collectionNames[index], id, index]));
      const lookups = [new Map(), new Map(), new Map()];
      for (let offset = 0; offset < docs.length; offset += 25) {
        requireDetail(event);
        const group = docs.slice(offset, offset + 25);
        const found = await Promise.all(group.map(([collection, id]) => loadDoc(event, collection, id)));
        requireDetail(event);
        group.forEach(([, id, index], position) => lookups[index].set(id, found[position]));
      }
      return { athletes: lookups[0], organizations: lookups[1], disciplines: lookups[2] };
    }

    function renderGroups(event, rows) {
      const data = core.groups(rows);
      const phaseCount = Math.max(event.competition.phaseCount ?? 0, data.phaseCount);
      for (const age of data.ages) {
        const block = element("details", null, "statistics-archive-age");
        const summary = element("summary", age.label);
        block.append(summary);
        for (const gender of age.genders) {
          const group = element("details", null, "statistics-archive-gender");
          const athleteCount = new Set(gender.rows.map(row => row.athleteId)).size;
          const genderSummary = element("summary", `${gender.label} · ${athleteCount}`);
          const content = element("div", null, "statistics-archive-results");
          group.append(genderSummary, content);
          block.append(group);
          let loaded = false, busy = false;
          async function showResults() {
            if (!group.open || busy || loaded || selected !== event) return;
            busy = true;
            const progress = element("p", "Sportler und Disziplinen werden geladen …", "statistics-import-message");
            progress.setAttribute("role", "status");
            content.replaceChildren(progress);
            try {
              const lookups = await loadGroup(event, gender.rows);
              requireDetail(event);
              const sections = core.resultSections(gender.rows, phaseCount, (a, b) => compareDisciplines(lookups, a, b));
              content.replaceChildren();
              for (const section of sections) {
                renderSection(content, section, data, lookups, phaseCount, sections.length === 1 && phaseCount < 2);
              }
              loaded = true;
            } catch {
              if (selected === event && inView(event.version)) {
                const retry = element("button", "Erneut laden", "button button-secondary");
                retry.type = "button";
                retry.addEventListener("click", showResults);
                content.replaceChildren(element("p", "Die Ergebnisdetails konnten nicht geladen werden."), retry);
              }
            } finally { busy = false; }
          }
          group.addEventListener("toggle", showResults);
        }
        ui.groups.append(block);
      }
    }

    function closeCompetition(restoreFocus = false) {
      const previous = selected;
      selected = null;
      cache = new Map();
      ui.detail.hidden = true;
      ui.list.hidden = false;
      ui.groups.replaceChildren();
      message(ui["detail-status"], "");
      ui["detail-retry"].hidden = true;
      if (restoreFocus) previous?.opener.focus();
    }

    async function openCompetition(id, competition, opener) {
      if (!inView(version)) return;
      const event = { version, competition, opener };
      selected = event;
      cache = new Map();
      ui.list.hidden = true;
      ui.detail.hidden = false;
      const header = competition.fullName || competition.name;
      ui["event-name"].textContent = header;
      ui["event-meta"].textContent = [
        header !== competition.name ? competition.name : "", dateText(competition.date), competition.city,
        competition.poolLength ? `${competition.poolLength} m` : "", competition.rule,
      ].filter(Boolean).join(" · ");
      ui.groups.replaceChildren();
      ui["detail-retry"].hidden = true;
      ui["detail-retry"].onclick = () => openCompetition(id, competition, opener);
      ui["event-name"].focus();
      message(ui["detail-status"], "Ergebnisse werden geladen …");
      const rows = [];
      try {
        let last = null;
        const query = db.collection("statsResults").where("competitionId", "==", id).limit(resultPageSize);
        for (;;) {
          requireDetail(event);
          const page = await (last ? query.startAfter(last) : query).get({ source: "server" });
          requireDetail(event);
          rows.push(...page.docs.map(doc => doc.data()));
          if (page.docs.length < resultPageSize) break;
          last = page.docs.at(-1);
        }
        message(ui["detail-status"], rows.length ? "" : "Für diesen Wettkampf liegen noch keine Ergebnisse vor.");
        renderGroups(event, rows);
      } catch {
        if (selected === event && inView(event.version)) {
          message(ui["detail-status"], "Die Ergebnisse konnten nicht geladen werden.", "error");
          ui["detail-retry"].hidden = false;
        }
      }
    }

    async function loadCompetitions() {
      if (!inView(version) || finished || loading) return;
      const next = version;
      loading = true;
      ui.more.disabled = true;
      message(ui.status, "Wettkämpfe werden geladen …");
      try {
        const query = db.collection("statsCompetitions").orderBy("date", "desc").limit(competitionPageSize);
        const page = await (cursor ? query.startAfter(cursor) : query).get({ source: "server" });
        if (!inView(next)) return;
        for (const doc of page.docs) {
          const competition = doc.data();
          const card = element("button", null, "statistics-archive-event");
          card.type = "button";
          card.append(element("strong", competition.fullName || competition.name));
          const meta = [competition.fullName ? competition.name : "", dateText(competition.date), competition.city]
            .filter(Boolean).join(" · ");
          if (meta) card.append(element("span", meta));
          card.addEventListener("click", () => openCompetition(doc.id, competition, card));
          ui.events.append(card);
        }
        cursor = page.docs.at(-1) ?? cursor;
        counts += page.docs.length;
        finished = page.docs.length < competitionPageSize;
        ui.more.textContent = "Weitere Wettkämpfe laden";
        ui.more.hidden = finished;
        message(ui.status, counts ? "" : "Es wurden noch keine Wettkämpfe importiert.");
      } catch (error) {
        if (!inView(next)) return;
        const denied = ["permission-denied", "firestore/permission-denied"].includes(error.code);
        message(ui.status, denied ? "Das Archiv ist nicht freigegeben. Prüfe die Admin-Rechte und Firestore-Regeln."
          : "Die Wettkämpfe konnten nicht geladen werden.", "error");
        ui.more.textContent = "Erneut laden";
        ui.more.hidden = false;
      } finally {
        if (next === version) {
          loading = false;
          ui.more.disabled = false;
        }
      }
    }

    function reset() {
      version++;
      cursor = null;
      loading = finished = false;
      counts = 0;
      ui.events.replaceChildren();
      ui.more.disabled = false;
      ui.more.hidden = true;
      message(ui.status, "");
      closeCompetition();
    }

    ui.more.addEventListener("click", loadCompetitions);
    ui.back.addEventListener("click", () => closeCompetition(true));
    return Object.freeze({
      show() { active = true; if (!counts) loadCompetitions(); },
      hide() { active = false; version++; loading = false; ui.more.disabled = false; closeCompetition(); },
      reset,
    });
  }

  window.LifesavingStatisticsOverview = Object.freeze({ create });
})();
