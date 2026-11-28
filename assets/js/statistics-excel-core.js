(function (root) {
  "use strict";

  const disciplines = [
    "100m Lifesaver", "50m Retten", "200m Super Lifesaver", "100m Kombi",
    "100m Retten/Flossen", "200m Hindernis", "100m Hindernis", "100m MLS",
    "50m Retten/Flossen", "50m Flosse", "50m Hindernis", "50m k. Schwimmen",
    "50m Freistil", "25m Freistil", "25m Brust", "25m Rücken ohne Arme", "25m Puppe",
  ];
  const ignored = ["4-Kampf (ohne HLW)", "LSC Change"];
  const maxAge = 100;
  const germanFederationValues = new Set(["GER", "DE", "DEU", "DEUTSCHLAND"]);
  const fields = ["Name", "Gender", "AK", "Age", "OG", "BZ", "LV", "BV", "PLACE", "3-Kampf",
    "LSC", "HLW", "Datum", "Wettkampf", "Bahn", "Rule", "Land", "Stadt", "St. Recht", "Lauf", "Wertung", "WK-Name"];
  const block = ["pl", "time", "points", "c", "st"];
  const idFor = index => "D" + String(index + 1).padStart(3, "0");
  const clean = value => String(value ?? "").normalize("NFC").trim().replace(/\s+/gu, " ");
  const heading = value => clean(value).toLowerCase().replace(/[\s.()/-]/gu, "");
  const countryName = value => clean(value).toUpperCase() === "GER" ? "Deutschland" : clean(value);

  function organizationIdentity(kind, name, federation, regions) {
    const upper = name.toUpperCase();
    if (kind === "BV" && germanFederationValues.has(upper)) return ["ger", "Deutschland"];
    if (kind === "LV" && (germanFederationValues.has(federation) || federation === "DLRG")) {
      const region = regions.get(upper);
      if (region) return region;
      if (name.length <= 3) throw new Error(`Unbekanntes LV-Kürzel „${name}“.`);
    }
    if (kind === "OG" && /^Bermatingen\s*[-/]\s*Markdorf$/i.test(name)) {
      return ["bermatingen-markdorf", "Bermatingen-Markdorf"];
    }
    return [name.toLowerCase(), name];
  }

  function columns(top, bottom) {
    const labels = new Map([...fields, ...ignored].map(name => [heading(name), name]));
    const names = new Map(disciplines.map((name, index) => [heading(name), idFor(index)]));
    names.set(heading("25m Rü. ohne Arme"), "D016");
    const headers = Array.from(bottom, heading);
    const singles = new Map(), groups = new Map(), used = new Set(), checked = new Set();
    for (let i = 0; i < headers.length;) {
      if (block.every((key, offset) => key === headers[i + offset])) {
        const ids = new Set(top.slice(i, i + 5).filter(value => clean(value)).map(value => names.get(heading(value))));
        const [id] = ids;
        if (ids.size !== 1 || !id || groups.has(id)) {
          throw new Error(`Disziplinüberschrift über Spalten ${i + 1}–${i + 5} prüfen.`);
        }
        groups.set(id, i);
        for (let offset = 0; offset < 5; offset++) {
          used.add(i + offset);
          checked.add(i + offset);
        }
        i += 5;
        continue;
      }
      if (headers[i]) {
        const label = labels.get(headers[i]);
        if (!label || singles.has(label)) throw new Error(`Unbekannte oder doppelte Überschrift in Spalte ${i + 1}.`);
        singles.set(label, i);
        used.add(i);
        if (!ignored.includes(label)) checked.add(i);
      }
      i++;
    }
    const missing = fields.filter(name => !singles.has(name));
    if (missing.length || groups.size !== disciplines.length) {
      throw new Error(`Kopfzeilen prüfen. Fehlende Felder: ${missing.join(", ") || "keine"}. Disziplinblöcke: ${groups.size}/17.`);
    }
    return { singles, groups, used, checked };
  }

  function readSheet(sheet, xlsx) {
    const rows = new Map();
    for (const address of Object.keys(sheet)) {
      if (address.startsWith("!")) continue;
      const cell = sheet[address];
      if ((cell.v == null || cell.t === "z") && !cell.f) continue;
      const { r, c } = xlsx.utils.decode_cell(address);
      if (!rows.has(r + 1)) rows.set(r + 1, []);
      const calendarFormat = cell.t === "n" && cell.z && xlsx.SSF.is_date(cell.z);
      const timeFormat = calendarFormat && /[hs]|\[m+\]/i.test(cell.z) && !/[dy]/i.test(cell.z);
      rows.get(r + 1)[c] = cell.t === "e" || cell.t === "z" || cell.v == null ? "#EXCEL-FEHLER"
        : timeFormat ? { excelTimeMs: Math.round(cell.v * 86400000) }
          : calendarFormat ? { excelDateSerial: cell.v } : cell.v;
    }
    return [...rows].sort(([a], [b]) => a - b);
  }

  function inspectSheet(rows) {
    const index = rows.findIndex(([, cells]) => {
      const headers = cells.map(heading);
      return headers.includes("name") && headers.includes("gender");
    });
    if (index < 1 || rows[index - 1][0] !== rows[index][0] - 1) {
      throw new Error("Die zwei Kopfzeilen mit Disziplinnamen und Spaltennamen fehlen.");
    }
    const schema = columns(rows[index - 1][1], rows[index][1]);
    const events = new Map(), spelling = new Map();
    for (const [row, cells] of rows.slice(index + 1)) {
      if (!cells.some(value => clean(value))) continue;
      const name = clean(cells[schema.singles.get("Wettkampf")]);
      if (!name || name.startsWith("#")) throw new Error(`Zeile ${row}: Wettkampf fehlt oder enthält einen Excel-Fehler.`);
      const key = name.toLowerCase();
      if (spelling.has(key) && spelling.get(key) !== name) {
        throw new Error(`Zeile ${row}: Schreibweise des Wettkampfnamens prüfen (${name}).`);
      }
      spelling.set(key, name);
      if (!events.has(name)) events.set(name, []);
      events.get(name).push([row, cells]);
    }
    return { schema, events };
  }

  function number(value) {
    let text = clean(value);
    if (!text) return null;
    if (/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(text)) text = text.replaceAll(".", "").replace(",", ".");
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) {
      throw new Error(`Ungültige Zahl „${text}“.`);
    }
    return Number(text);
  }

  function integer(value) {
    const result = number(value);
    if (!Number.isSafeInteger(result)) throw new Error(`Ganze Zahl erwartet: ${clean(value)}.`);
    return result;
  }

  function eventDate(value, date1904) {
    const text = clean(value);
    if (Number.isFinite(value?.excelDateSerial) || /^\d+(?:[.,]0+)?$/.test(text)) {
      const serial = value?.excelDateSerial === undefined ? integer(text) : Math.floor(value.excelDateSerial);
      const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, serial < 60 ? 31 : 30);
      const date = new Date(epoch + serial * 86400000);
      if (Number.isFinite(date.getTime()) && (serial || date1904) && /^\d{4}-/.test(date.toISOString())) {
        return date.toISOString().slice(0, 10);
      }
    }
    const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
    const iso = german ? [german[3], german[2].padStart(2, "0"), german[1].padStart(2, "0")].join("-") : text;
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const date = new Date(iso);
      if (Number.isFinite(date.getTime()) && date.toISOString().startsWith(iso)) return iso;
    }
    throw new Error(`Ungültiges Wettkampfdatum „${text}“.`);
  }

  function birthYear(value, year) {
    const number = integer(value);
    if (number >= 0 && number <= 99) {
      const latest = year - ((year - number) % 100);
      if (latest - 100 < year - maxAge) return latest;
      throw new Error(`Jahrgang ${number} mehrdeutig (${latest - 100} oder ${latest}). Age vierstellig angeben.`);
    }
    if (number >= 1000 && number <= year) return number;
    throw new Error(`Ungültiger Jahrgang ${number}.`);
  }

  function elapsedMs(value) {
    if (Number.isSafeInteger(value?.excelTimeMs) && value.excelTimeMs >= 0) return value.excelTimeMs;
    const match = /^(?:(\d+):)?(\d{1,2})(?:[,.](\d{1,3}))?$/.exec(clean(value));
    if (!match || (match[1] && Number(match[2]) >= 60)) throw new Error(`Ungültige Zeit „${clean(value)}“.`);
    return (Number(match[1] ?? 0) * 60 + Number(match[2])) * 1000 + Number((match[3] ?? "").padEnd(3, "0"));
  }

  function placement(value) {
    const rankingStatus = new Map([["ak", "AK"], ["ausg", "EXCLUDED"]]).get(heading(value));
    return { place: rankingStatus || !clean(value) ? null : integer(value), rankingStatus: rankingStatus ?? null };
  }

  function discipline(cells) {
    const markers = new Map([["na", "DNS"], ["disq", "DQ"]]);
    const present = new Set(cells.map(value => markers.get(heading(value))).filter(Boolean));
    if (present.size > 1) throw new Error("Widersprüchliche Statusmarker disq und n.a.");
    const status = [...present][0] ?? "OK";
    const [pl, time, points, , penalty] = Array.from(cells, value => markers.has(heading(value)) ? null : value);
    const { place, rankingStatus } = placement(pl);
    const data = { place, timeMs: clean(time) ? elapsedMs(time) : null, points: number(points),
      faultCode: clean(cells[3]) || null, penaltyPoints: number(penalty), status };
    if (rankingStatus) data.rankingStatus = rankingStatus;
    if (status === "DNS" && data.points !== null && data.points !== 0) {
      throw new Error("Nichtantritt mit Punkten ungleich 0.");
    }
    return data;
  }

  function hlw(value) {
    if (heading(value) === "na") return { points: null, status: "DNS" };
    const points = number(value);
    if (![0, 200, 500].includes(points)) throw new Error("HLW erwartet 0, 200 oder 500 Punkte oder n.a.");
    return { points, status: points === 0 ? "DQ" : "PASS" };
  }

  function makeIdCache() {
    const encoded = new TextEncoder(), cache = new Map();
    return async (prefix, ...parts) => {
      const key = JSON.stringify(parts);
      if (!cache.has(key)) {
        const hash = new Uint8Array(await root.crypto.subtle.digest("SHA-256", encoded.encode(key)));
        cache.set(key, Array.from(hash.slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join(""));
      }
      return prefix + cache.get(key);
    };
  }

  async function parseRow(cells, schema, date1904, regions, stableId) {
    if (cells.some((value, index) => clean(value) && !schema.used.has(index))) {
      throw new Error("Daten in Spalte ohne Überschrift.");
    }
    if ([...schema.checked].some(index => clean(cells[index]).startsWith("#"))) {
      throw new Error("Excel-Fehler oder Formel ohne gespeichertes Ergebnis. In Excel neu berechnen.");
    }
    const value = key => cells[schema.singles.get(key)];
    const date = eventDate(value("Datum"), date1904);
    const year = birthYear(value("Age"), Number(date.slice(0, 4)));
    const parts = clean(value("Name")).split(",").map(clean);
    const gender = clean(value("Gender")).toLowerCase();
    if (parts.length !== 2 || parts.some(part => !part)) throw new Error("Name im Format Nachname, Vorname angeben.");
    if (!["m", "w"].includes(gender)) throw new Error("In der Spalte Gender bitte m oder w angeben.");
    const [lastName, given] = parts;
    const suffix = /^(.*?) \(([1-9]\d*)\)$/.exec(given);
    const firstName = suffix?.[1] ?? given;
    const discriminator = suffix ? integer(suffix[2]) : null;
    const athleteId = await stableId("A", lastName.toLowerCase(), firstName.toLowerCase(), year, gender, discriminator);
    const name = clean(value("Wettkampf"));
    const competitionId = await stableId("W", name.toLowerCase());
    const pool = clean(value("Bahn"));
    const length = /^(\d+)\s*m?$/i.exec(pool);
    if (pool && (!length || Number(length[1]) < 1)) throw new Error("Bahnlänge prüfen.");
    const docs = [
      ["statsCompetitions", competitionId, { name, fullName: clean(value("WK-Name")), date,
        poolLength: length ? integer(length[1]) : null, rule: clean(value("Rule")),
        country: countryName(value("Land")), city: clean(value("Stadt")) }],
      ["statsAthletes", athleteId, { lastName, firstName, birthYear: year, gender, discriminator }],
    ];
    const affiliations = {};
    let parentId = null, previousKind = null;
    const federation = clean(value("BV")).toUpperCase();
    for (const kind of ["BV", "LV", "BZ", "OG"]) {
      const org = clean(value(kind)), field = kind.toLowerCase() + "Id";
      affiliations[field] = null;
      if (org) {
        // An OG can use the last available level, including the BV itself.
        const requiredParent = kind === "OG" ? "BV" : previousKind;
        if (requiredParent && !affiliations[requiredParent.toLowerCase() + "Id"]) {
          throw new Error(`${kind} „${org}“: Zugehörigen ${requiredParent} ergänzen.`);
        }
        const [key, orgName] = organizationIdentity(kind, org, federation, regions);
        const id = await stableId("C", kind, parentId, key);
        docs.push(["statsOrganizations", id, { type: kind, name: orgName, parentId }]);
        affiliations[field] = id;
        parentId = id;
      }
      previousKind = kind;
    }
    const phase = clean(value("Lauf"));
    if (phase && !["1", "2", "3"].includes(phase)) throw new Error("In der Spalte Lauf bitte 1, 2 oder 3 angeben.");
    const round = phase ? Number(phase) : null;
    const entries = {};
    for (const [id, index] of schema.groups) {
      const cellsForDiscipline = Array.from({ length: 5 }, (_, offset) => cells[index + offset]);
      if (!cellsForDiscipline.some(item => clean(item))) continue;
      try { entries[id] = discipline(cellsForDiscipline); }
      catch (error) { throw new Error(`${disciplines[Number(id.slice(1)) - 1]}: ${error.message}`); }
    }
    if (clean(value("HLW"))) entries.D018 = hlw(value("HLW"));
    const resultId = await stableId("R", competitionId, athleteId, round);
    docs.push(["statsResults", resultId, { athleteId, competitionId, ...affiliations, gender,
      ageGroup: clean(value("AK")), startRight: clean(value("St. Recht")), round,
      classification: clean(value("Wertung")), ...placement(value("PLACE")),
      overallPoints: number(value("3-Kampf")), lsc: number(value("LSC")), disciplines: entries }]);
    return docs;
  }

  function regionLookup(lvNames) {
    const regions = new Map();
    for (const [code, name] of Object.entries(lvNames)) {
      const region = [code.toLowerCase(), name];
      regions.set(code, region);
      regions.set(name.toUpperCase(), region);
    }
    return regions;
  }

  function organizationKeys(lvNames) {
    const regions = regionLookup(lvNames);
    const stableId = makeIdCache();
    return async (type, name, parentId, federation) => {
      const [key, displayName] = organizationIdentity(type, clean(name), clean(federation).toUpperCase(), regions);
      return { id: await stableId("C", type, parentId, key), name: displayName };
    };
  }

  async function prepare(sheet, eventName, date1904, lvNames) {
    const rows = sheet.events.get(eventName);
    if (!rows?.length) throw new Error("Der ausgewählte Wettkampf enthält keine Zeilen.");
    const stableId = makeIdCache();
    const regions = regionLookup(lvNames);
    const records = new Map(), affiliations = new Map(), errors = [];
    let phaseCount = null, starts = 0;
    for (const [row, cells] of rows) {
      try {
        const docs = await parseRow(cells, sheet.schema, date1904, regions, stableId);
        for (const [collection, id, data] of docs) {
          const previous = records.get(id);
          if (previous && collection === "statsResults") {
            throw new Error(`Mögliches Duplikat zu Zeile ${previous.row} (Person und Wettkampfphase).`);
          }
          if (previous && JSON.stringify(previous.data) !== JSON.stringify(data)) {
            throw new Error(`Widersprüchliche Stammdaten zu Zeile ${previous.row}.`);
          }
          if (!previous) records.set(id, { collection, id, data, row });
          if (collection === "statsResults") {
            const clubs = [data.ogId, data.bzId, data.lvId, data.bvId].join("|");
            const before = affiliations.get(data.athleteId);
            if (before && before.clubs !== clubs) throw new Error(`Abweichender Verband zu Zeile ${before.row}.`);
            affiliations.set(data.athleteId, { clubs, row });
            starts += Object.keys(data.disciplines).length;
            if (data.round !== null) phaseCount = Math.max(phaseCount ?? 0, data.round);
          }
        }
      } catch (error) { errors.push(`Zeile ${row}: ${error.message}`); }
    }
    if (errors.length) return { errors };
    const competition = [...records.values()].find(item => item.collection === "statsCompetitions");
    competition.data.phaseCount = phaseCount;
    disciplines.forEach((name, index) => {
      const id = idFor(index);
      records.set(id, { collection: "statsDisciplines", id,
        data: { name, category: "Pool", distance: Number(name.split("m")[0]), sortOrder: index + 1 } });
    });
    records.set("D018", { collection: "statsDisciplines", id: "D018",
      data: { name: "HLW", category: "HLW", distance: null, sortOrder: 18 } });
    return { records: [...records.values()], competition, starts, errors };
  }

  const api = Object.freeze({ readSheet, inspectSheet, prepare, organizationKeys });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LifesavingStatisticsExcel = api;
})(globalThis);
