(function (root) {
  "use strict";

  function create({ getAccountId }) {
    const events = new Map();
    let account = getAccountId();
    function clear() { events.clear(); account = getAccountId(); }
    function checkAccount() { if (account !== getAccountId()) clear(); }
    function remember(record, response = null) {
      checkAccount();
      if (record.accountId !== undefined && record.accountId !== account) return;
      const { eventId, operation, payload } = record;
      const prefix = `/events/${encodeURIComponent(eventId)}/participants`;
      if (!operation || !["POST", "PATCH", "DELETE"].includes(operation.method)) return;
      const imported = operation.path === `${prefix}/import` && operation.method === "POST";
      let id;
      if ((operation.path === prefix && operation.method === "POST") || imported) id = record.clientSubmissionId;
      else if (operation.path.startsWith(`${prefix}/`) && !operation.path.slice(prefix.length + 1).includes("/")) {
        try { id = decodeURIComponent(operation.path.slice(prefix.length + 1)); } catch { return; }
      } else return;
      const values = imported ? payload?.previewParticipant : payload;
      const removed = operation.method === "DELETE";
      if (!removed && !response?.participant && (!values?.name || !values.gender)) return;
      if (!events.has(eventId)) events.set(eventId, new Map());
      const people = events.get(eventId), previous = people.get(id);
      const version = String(record.createdAt || "");
      if (previous && (previous.version > version || (previous.version === version && previous.confirmed && !response))) return;
      const person = response?.participant || (!removed ? { id, name: values.name.trim(), birth_year: Number(values.birthYear) % 100,
        age_group: values.ageGroup?.trim() || "", gender: values.gender, organization: values.organization?.trim() || "" } : null);
      people.set(id, { version, confirmed: Boolean(response), person: person ? { ...person, id } : null });
    }
    function apply(eventId, rows, pending = []) {
      checkAccount();
      pending.forEach((record) => remember(record));
      const people = new Map(rows.map((person) => [person.id, person]));
      for (const [id, change] of events.get(eventId) || []) {
        if (change.person) people.set(id, { ...people.get(id), ...change.person });
        else people.delete(id);
      }
      return [...people.values()];
    }
    return Object.freeze({ remember, apply, clear });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { create };
  else root.TimerParticipantUpdates = Object.freeze({ create });
})(typeof window === "undefined" ? globalThis : window);
