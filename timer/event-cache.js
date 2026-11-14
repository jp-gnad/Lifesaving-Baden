(function (root) {
  "use strict";

  // Only event metadata is retained across routes. Participant/search caches
  // keep their existing view-scoped lifecycle in the Firestore adapter.
  function create({ load, now = Date.now, maxAge = 30_000, limit = 50, invalidated = () => {} }) {
    const entries = new Map();
    let generation = 0;
    function remember(event) {
      if (!event?.id) return;
      const count = entries.get(event.id)?.event?.participant_count;
      if (event.participant_count === undefined && count !== undefined) event = { ...event, participant_count: count };
      entries.delete(event.id);
      entries.set(event.id, { event, at: now() });
      while (entries.size > limit) entries.delete(entries.keys().next().value);
    }
    function fetch(id) {
      const entry = entries.get(id);
      if (entry?.pending) return entry.pending;
      const version = generation;
      const state = entry || {};
      const pending = Promise.resolve().then(() => load(id)).then((event) => {
        if (generation === version && entries.get(id) === state) remember(event);
        return event;
      }).catch((error) => {
        if (generation === version && entries.get(id) === state && [403, 404].includes(error?.status)) {
          entries.delete(id);
          invalidated(id, error);
        }
        throw error;
      }).finally(() => {
        if (entries.get(id) === state) delete state.pending;
      });
      state.pending = pending;
      entries.set(id, state);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
      return pending;
    }
    function read(id) {
      const entry = entries.get(id);
      if (!entry?.event) return fetch(id);
      if (now() - entry.at >= maxAge) fetch(id).catch(() => {});
      return Promise.resolve(entry.event);
    }
    return Object.freeze({ read, refresh: fetch, remember, forget: (id) => entries.delete(id),
      clear() { generation += 1; entries.clear(); } });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { create };
  else root.TimerEventCache = Object.freeze({ create });
})(typeof window === "undefined" ? globalThis : window);
