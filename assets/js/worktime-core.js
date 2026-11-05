(function (root) {
  "use strict";
  const categories = Object.freeze({ training: "Training", competition: "Wettkampf", organization: "Organisation", athleteCare: "Athletenbetreuung", education: "Fortbildungen", other: "Sonstiges" });
  const berlin = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const pad = (value) => String(value).padStart(2, "0");
  const key = (date) => date.toISOString().slice(0, 10);
  function day(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Bitte wähle ein gültiges Datum.");
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || key(date) !== value || date.getUTCFullYear() < 2000) throw new Error("Bitte wähle ein gültiges Datum ab 2000.");
    return date;
  }
  function shift(value, days) {
    const date = day(value);
    date.setUTCDate(date.getUTCDate() + days);
    return key(date);
  }
  function parts(date) {
    return Object.fromEntries(berlin.formatToParts(date).map((part) => [part.type, part.value]));
  }
  function today(now = new Date()) {
    const p = parts(now);
    return `${p.year}-${p.month}-${p.day}`;
  }
  function minutes(time) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Bitte gib Von und Bis vollständig an.");
    return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  }
  function clock(value) { return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`; }
  // Resolve Berlin wall-clock time independently of the device's timezone.
  // At the autumn clock change the first occurrence is used; missing spring times are rejected.
  function instant(date, minute) {
    const wall = day(date).getTime() + minute * 60000;
    for (const offset of [120, 60]) {
      const candidate = new Date(wall - offset * 60000);
      const p = parts(candidate);
      if (`${p.year}-${p.month}-${p.day}` === date && Number(p.hour) * 60 + Number(p.minute) === minute) return candidate;
    }
    throw new Error("Diese Uhrzeit existiert wegen der Zeitumstellung nicht. Bitte prüfe Von und Bis.");
  }
  function prepare(input) {
    const startDate = input.startDate ?? input.date;
    const date = day(startDate);
    const startMinute = minutes(input.start);
    const endMinute = minutes(input.end);
    const endDate = input.endDate ?? (endMinute < startMinute ? shift(startDate, 1) : startDate);
    const endDay = day(endDate);
    const startedAt = instant(startDate, startMinute);
    const endedAt = instant(endDate, endMinute);
    const title = String(input.title || "").trim();
    const description = String(input.description || "").trim();
    if (!title || title.length > 120) throw new Error("Bitte gib einen Titel mit höchstens 120 Zeichen ein.");
    if (description.length > 2000) throw new Error("Die Beschreibung darf höchstens 2.000 Zeichen haben.");
    if (!Object.hasOwn(categories, input.category)) throw new Error("Bitte wähle eine Kategorie.");
    const durationMinutes = (endedAt - startedAt) / 60000;
    if (durationMinutes <= 0) throw new Error("Bis muss nach Von liegen.");
    const organization = input.organization === undefined || input.organization === "" ? -1 : Number(input.organization);
    const organizationName = organization === -1 ? "" : String(input.organizationName || "").trim();
    if (![-1, 0, 1, 2].includes(organization) || (organization !== -1 && (!organizationName || organizationName.length > 80))) throw new Error("Bitte wähle eine deiner Gliederungen.");
    return { day: date, endDay, startMinute, endMinute, startedAt, endedAt, durationMinutes, title, description, category: input.category, organization, organizationName };
  }
  function period(mode, anchor) {
    const date = day(anchor);
    let start = anchor;
    let end = shift(anchor, 1);
    if (mode === "week") {
      start = shift(anchor, -((date.getUTCDay() + 6) % 7));
      end = shift(start, 7);
    } else if (mode === "month") {
      start = `${anchor.slice(0, 7)}-01`;
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + 1);
      end = key(date);
    }
    return { start, end };
  }
  function move(mode, anchor, direction) {
    if (mode !== "month") return shift(anchor, direction * (mode === "week" ? 7 : 1));
    const date = day(anchor);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + direction);
    return key(date);
  }
  function summarize(entries, mode, anchor) {
    const range = period(mode, anchor);
    const selected = entries.filter((entry) => entry.date >= range.start && entry.date < range.end);
    const buckets = [];
    if (mode === "day") {
      for (let hour = 0; hour < 24; hour += 1) buckets.push({ key: hour, label: `${pad(hour)} Uhr`, minutes: 0, byOrganization: organizationTotals() });
      // The full entry belongs to its start date, including hours after midnight.
      for (const entry of selected) {
        const start = entry.startMinute;
        const endDate = recordEndDate(entry);
        const finish = entry.endMinute + (day(endDate) - day(entry.date)) / 60000;
        const wallDuration = finish - start;
        const fullDays = Math.floor(wallDuration / 1440);
        const remainder = wallDuration % 1440;
        const portions = new Array(24).fill(fullDays * 60);
        for (let minute = start; minute < start + remainder; minute += 1) portions[Math.floor((minute % 1440) / 60)] += 1;
        portions.forEach((portion, hour) => addMinutes(buckets[hour], entry, portion * entry.durationMinutes / wallDuration));
      }
    } else {
      for (let date = range.start; date < range.end; date = shift(date, 1)) buckets.push({ key: date, label: date, minutes: 0, byOrganization: organizationTotals() });
      for (const entry of selected) addMinutes(buckets.find((bucket) => bucket.key === entry.date), entry, entry.durationMinutes);
    }
    const byCategory = Object.fromEntries(Object.keys(categories).map((category) => [category, 0]));
    for (const entry of selected) byCategory[entry.category] += entry.durationMinutes;
    const byOrganization = organizationTotals();
    for (const entry of selected) byOrganization[entry.organization ?? -1] += entry.durationMinutes;
    return { entries: selected, buckets, byCategory, byOrganization, total: selected.reduce((sum, entry) => sum + entry.durationMinutes, 0), days: new Set(selected.map((entry) => entry.date)).size };
  }
  function duration(value) {
    const rounded = Math.round(value);
    return `${Math.floor(rounded / 60)} Std.${rounded % 60 ? ` ${rounded % 60} Min.` : ""}`;
  }
  function compactBuckets(summary) {
    const buckets = [];
    for (let index = 0; index < summary.buckets.length; index += 7) {
      const group = summary.buckets.slice(index, index + 7);
      const byOrganization = organizationTotals();
      for (const bucket of group) for (const organization of [-1, 0, 1, 2]) byOrganization[organization] += bucket.byOrganization[organization];
      buckets.push({ key: group[0].key, label: `${index + 1}–${index + group.length}`, minutes: group.reduce((sum, bucket) => sum + bucket.minutes, 0), byOrganization });
    }
    return buckets;
  }
  function organizationTotals() { return { "-1": 0, 0: 0, 1: 0, 2: 0 }; }
  function addMinutes(bucket, entry, minutes) {
    bucket.minutes += minutes;
    bucket.byOrganization[entry.organization ?? -1] += minutes;
  }
  function recordEndDate(record) {
    if (record.endDay) return key(new Date(timestampMillis(record.endDay)));
    const date = record.date || key(new Date(timestampMillis(record.day)));
    return record.endMinute < record.startMinute ? shift(date, 1) : date;
  }
  function timestampMillis(value) { return value instanceof Date ? value.getTime() : value.toMillis(); }
  function overlaps(a, b) {
    return timestampMillis(a.startedAt) < timestampMillis(b.endedAt) && timestampMillis(b.startedAt) < timestampMillis(a.endedAt);
  }
  const api = Object.freeze({ categories, day, key, shift, today, minutes, clock, instant, prepare, period, move, summarize, duration, compactBuckets, recordEndDate, overlaps, timestampMillis });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WorktimeCore = api;
})(typeof window === "undefined" ? globalThis : window);
