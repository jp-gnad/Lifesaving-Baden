(function () {
  "use strict";

  const sets = {
    statsDisciplines: {
      label: "Disziplinen", order: "sortOrder", direction: "asc",
      title: data => data.name,
      fields: [
        ["name", "Name", "Bezeichnung der Disziplin."],
        ["category", "Kategorie", "Pool für Schwimmdisziplinen, HLW für die historische Disziplin."],
        ["distance", "Strecke", "Distanz in Metern."],
        ["sortOrder", "Reihenfolge", "Position im Disziplinkatalog."],
      ],
    },
    statsCompetitions: {
      label: "Wettkämpfe", order: "date", direction: "desc",
      title: data => data.fullName || data.name,
      fields: [
        ["name", "Kurzname", "Eindeutige Bezeichnung aus der Excel-Spalte Wettkampf."],
        ["fullName", "Vollständiger Name", "Titel aus der Excel-Spalte WK-Name."],
        ["date", "Datum", "Wettkampftag im Format Jahr-Monat-Tag."],
        ["city", "Ort", "Austragungsort."],
        ["country", "Land", "Austragungsland."],
        ["poolLength", "Beckenlänge", "Beckenlänge in Metern."],
        ["rule", "Regelwerk", "Regelwerk des Wettkampfs."],
        ["phaseCount", "Phasenanzahl", "Anzahl der erkannten Wettkampfphasen."],
      ],
    },
    statsAthletes: {
      label: "Athleten", order: "lastName", direction: "asc",
      title: data => [data.lastName, data.firstName].filter(Boolean).join(", "),
      fields: [
        ["lastName", "Nachname", "Nachname aus dem Excel-Namensfeld."],
        ["firstName", "Vorname", "Vorname aus dem Excel-Namensfeld."],
        ["birthYear", "Geburtsjahr", "Vollständiger vierstelliger Jahrgang."],
        ["gender", "Geschlecht", "w oder m aus der Excel-Spalte Gender."],
        ["discriminator", "Namenszusatz", "Nummer zur Unterscheidung gleichnamiger Athleten."],
      ],
    },
    statsOrganizations: {
      label: "Gliederungen", order: "name", direction: "asc",
      title: data => data.name,
      fields: [
        ["name", "Name", "Bezeichnung der Gliederung im Wettkampfarchiv."],
        ["type", "Ebene", "OG, BZ, LV oder BV."],
        ["parentId", "Übergeordnete Gliederung", "ID der direkt übergeordneten Gliederung."],
        ["active", "Aktiv", "Kennzeichen für eine aktive Gliederung."],
        ["successorId", "Nachfolgegliederung", "ID der Nachfolgegliederung, etwa nach einer Fusion."],
      ],
    },
  };
  const organizationLinks = ["parentId", "successorId"];
  const documentIdField = ["", "Dokument-ID", "Kennung des Firestore-Dokuments."];
  const pageSize = 30;
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  function storedValue(value) {
    if (value === undefined) return "Feld fehlt";
    if (value === null) return "null (nicht gesetzt)";
    if (value === "") return "Leerer Text";
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  function subtitle(collection, data) {
    const preferred = {
      statsDisciplines: [data.category, Number.isFinite(data.distance) ? `${data.distance} m` : ""],
      statsCompetitions: [data.name !== data.fullName && data.fullName ? data.name : "", data.date, data.city],
      statsAthletes: [data.birthYear, data.gender, data.discriminator ? `Zusatz ${data.discriminator}` : ""],
      statsOrganizations: [data.type, data.active === false ? "Inaktiv" : ""],
    };
    return preferred[collection].filter(Boolean).join(" · ");
  }

  function create(db, sessionActive) {
    const ui = Object.fromEntries([...document.querySelectorAll('[id^="structure-"]')]
      .map(node => [node.id.slice(10), node]));
    let visible = false, revision = 0, cursor = null, loading = false, finished = false, count = 0;
    let auditing = false;
    const organizations = new Map();
    const links = new Map();

    function current(token) {
      return token === revision && visible && sessionActive();
    }

    function message(text, state = "") {
      ui.status.textContent = text;
      ui.status.dataset.state = state;
      ui.status.hidden = !text;
    }

    function reset() {
      revision++;
      cursor = null;
      loading = finished = false;
      count = 0;
      links.clear();
      organizations.clear();
      auditing = false;
      ui.records.replaceChildren();
      ui.more.disabled = false;
      ui.more.hidden = true;
      ui["audit-button"].disabled = false;
      ui["audit-results"].replaceChildren();
      auditMessage("");
      message("");
    }

    function renderSchema() {
      const choice = ui.choice.value;
      const set = sets[choice];
      ui.schema.hidden = !set;
      ui.audit.hidden = choice !== "statsOrganizations";
      ui.title.textContent = set?.label ?? "";
      ui.fields.replaceChildren();
      if (!set) return;
      ui.collection.textContent = choice;
      for (const [key, label, description] of [documentIdField, ...set.fields]) {
        const entry = element("div", undefined, "statistics-structure-field");
        const term = element("dt", label);
        if (key) term.append(" ", element("code", key));
        entry.append(term, element("dd", description));
        ui.fields.append(entry);
      }
    }

    function getLinkedName(id) {
      if (!links.has(id)) {
        const request = db.collection("statsOrganizations").doc(id).get({ source: "server" })
          .then(snapshot => snapshot.exists ? snapshot.data().name : null)
          .catch(() => {
            if (links.get(id) === request) links.delete(id);
            return null;
          });
        links.set(id, request);
      }
      return links.get(id);
    }

    function renderDocument(doc, collection, set, token) {
      const data = doc.data();
      const detail = element("details", undefined, "statistics-structure-record");
      const summary = element("summary");
      const heading = element("span", undefined, "statistics-structure-record-title");
      heading.append(element("strong", set.title(data) || doc.id));
      const info = subtitle(collection, data);
      if (info) heading.append(element("span", info));
      summary.append(heading);
      detail.append(summary);
      detail.addEventListener("toggle", () => {
        if (!current(token) || !detail.open || detail.childElementCount > 1) return;
        const known = new Set(set.fields.map(([key]) => key));
        const fields = [documentIdField, ...set.fields, ...Object.keys(data)
          .filter(key => !known.has(key)).map(key => [key, key])];
        const values = element("dl", undefined, "statistics-structure-values");
        for (const [key, label] of fields) {
          const row = element("div", undefined, "statistics-structure-field");
          const term = element("dt", label);
          if (key && label !== key) term.append(" ", element("code", key));
          const value = key ? data[key] : doc.id;
          const display = element("dd", storedValue(value));
          row.append(term, display);
          values.append(row);
          if (collection === "statsOrganizations" && organizationLinks.includes(key) && /^C[a-f0-9]{32}$/.test(value)) {
            getLinkedName(value).then(name => {
              if (name && current(token)) display.prepend(`${name} · `);
            });
          }
        }
        detail.append(values);
      });
      return detail;
    }

    async function loadPage() {
      const collection = ui.choice.value;
      const set = sets[collection];
      const token = revision;
      if (!set || !current(token) || loading || finished) return;
      loading = true;
      ui.more.disabled = true;
      message(`${set.label} werden geladen …`);
      try {
        const query = db.collection(collection).orderBy(set.order, set.direction).limit(pageSize);
        const page = await (cursor ? query.startAfter(cursor) : query).get({ source: "server" });
        if (!current(token)) return;
        if (collection === "statsOrganizations") {
          for (const doc of page.docs) organizations.set(doc.id, { ...doc.data(), id: doc.id });
        }
        ui.records.append(...page.docs.map(doc => renderDocument(doc, collection, set, token)));
        cursor = page.docs.at(-1) ?? cursor;
        count += page.docs.length;
        finished = page.docs.length < pageSize;
        ui.more.textContent = "Weitere Einträge laden";
        ui.more.hidden = finished;
        message(count ? "" : "In dieser Sammlung sind noch keine Einträge gespeichert.");
      } catch (error) {
        if (!current(token)) return;
        const denied = ["permission-denied", "firestore/permission-denied"].includes(error.code);
        message(denied ? "Die Sammlung ist nicht freigegeben. Prüfe die Admin-Rechte und Firestore-Regeln."
          : "Die Einträge konnten nicht geladen werden.", "error");
        ui.more.textContent = "Erneut laden";
        ui.more.hidden = false;
      } finally {
        if (token === revision) {
          loading = false;
          ui.more.disabled = false;
        }
      }
    }

    function auditMessage(text, state = "") {
      const status = ui["audit-status"];
      status.textContent = text;
      status.dataset.state = state;
      status.hidden = !text;
    }

    function renderCandidates(groups) {
      ui["audit-results"].replaceChildren(...groups.map(group => {
        const card = element("details", undefined, "statistics-structure-record");
        card.append(element("summary", `${group.type} · ${group.name} (${group.entries.length})`));
        const content = element("div", undefined, "statistics-structure-audit-results");
        content.append(element("p", group.reason));
        const list = element("ul");
        for (const entry of group.entries) {
          const row = element("li");
          row.append(element("strong", entry.name),
            element("p", entry.path.length ? entry.path.join(" → ") : "Oberste Gliederung"),
            element("code", entry.id));
          list.append(row);
        }
        content.append(list);
        card.append(content);
        return card;
      }));
    }

    async function auditOrganizations() {
      const token = revision;
      if (!current(token) || ui.choice.value !== "statsOrganizations" || auditing) return;
      auditing = true;
      ui["audit-button"].disabled = true;
      ui["audit-results"].replaceChildren();
      auditMessage("Gliederungen werden auf ähnliche Einträge geprüft …");
      const records = new Map(organizations);
      let last = cursor, complete = finished;
      try {
        const query = db.collection("statsOrganizations").orderBy("name", "asc").limit(50);
        while (!complete) {
          const page = await (last ? query.startAfter(last) : query).get({ source: "server" });
          if (!current(token)) return;
          for (const doc of page.docs) records.set(doc.id, { ...doc.data(), id: doc.id });
          complete = page.docs.length < 50;
          last = page.docs.at(-1);
        }
        const groups = window.LifesavingStatisticsOrganizationAudit.findCandidates([...records.values()]);
        renderCandidates(groups);
        const countLabel = groups.length === 1 ? "1 Gruppe" : `${groups.length} Gruppen`;
        auditMessage(groups.length ? `${countLabel} mit möglichen Dubletten` : "Keine möglichen Dubletten gefunden.");
      } catch {
        if (current(token)) auditMessage("Die Gliederungen konnten nicht vollständig geprüft werden.", "error");
      } finally {
        if (token === revision) {
          auditing = false;
          ui["audit-button"].disabled = false;
        }
      }
    }

    ui.choice.addEventListener("change", () => {
      reset();
      renderSchema();
      loadPage();
    });
    ui.more.addEventListener("click", loadPage);
    ui["audit-button"].addEventListener("click", auditOrganizations);

    return Object.freeze({
      show() { visible = true; if (!count) loadPage(); },
      hide() { if (visible) { visible = false; reset(); } },
      reset,
      clear() {
        ui.choice.value = "";
        reset();
        renderSchema();
      },
    });
  }

  window.LifesavingStatisticsStructure = Object.freeze({ create });
})();
