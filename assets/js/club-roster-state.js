(function (root) {
  "use strict";
  const equal = (left, right) => JSON.stringify(left, (key, value) => value?.toMillis ? value.toMillis() : value)
    === JSON.stringify(right, (key, value) => value?.toMillis ? value.toMillis() : value);
  function create() {
    const changes = new Map();
    return Object.freeze({
      begin(id, patch, insertion = false) {
        if (changes.has(id)) throw new Error("Diese Person wird noch gespeichert.");
        const token = { id, patch, insertion, confirmed: false };
        changes.set(id, token); return token;
      },
      confirm(token, id = token.id) {
        if (changes.get(token.id) !== token) return;
        changes.delete(token.id); token.id = id; token.confirmed = true; changes.set(id, token);
      },
      rollback(token) { if (changes.get(token.id) === token) changes.delete(token.id); },
      receive(roster) {
        for (const [id, token] of changes) {
          if (!token.confirmed) continue;
          const person = roster.get(id);
          const matches = token.patch === null ? !person : person && (token.insertion
            || Object.entries(token.patch).every(([key, value]) => equal(person[key], value)));
          if (matches) changes.delete(id);
        }
      },
      project(roster) {
        const result = new Map(roster);
        for (const [id, token] of changes) {
          if (token.patch === null) result.delete(id);
          else result.set(id, { ...result.get(id), ...token.patch, id, pending: true });
        }
        return result;
      },
      has: (id) => changes.has(id), clear: () => changes.clear(),
    });
  }
  if (typeof module === "object" && module.exports) module.exports = { create };
  else root.ClubRosterState = Object.freeze({ create });
})(typeof window === "undefined" ? globalThis : window);
