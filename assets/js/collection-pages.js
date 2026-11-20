(function (root) {
  "use strict";

  // Cursor and in-flight reads belong to one account/view. A failed page never
  // advances the cursor; a reset makes late responses harmless.
  function create({ collection, documentId = "__name__", check = () => {}, size = 50 }) {
    let rows = new Map(), cursor = null, more = true, pending = null, generation = 0;
    function next() {
      check();
      if (pending) return pending;
      if (!more) return Promise.resolve([]);
      const version = generation;
      let query = collection.orderBy(documentId).limit(size);
      if (cursor) query = query.startAfter(cursor);
      const promise = query.get({ source: "server" }).then((snapshot) => {
        check();
        if (generation !== version) return [];
        for (const doc of snapshot.docs) rows.set(doc.id, doc);
        cursor = snapshot.docs.at(-1) || cursor;
        more = snapshot.docs.length === size;
        return snapshot.docs;
      }).finally(() => { if (pending === promise) pending = null; });
      pending = promise;
      return promise;
    }
    return Object.freeze({
      next,
      async all() { while (more) { const version = generation; await next(); check(); if (generation !== version) return; } },
      reset() { generation += 1; rows = new Map(); cursor = null; more = true; pending = null; },
      replace(doc) { if (doc.exists) rows.set(doc.id, doc); else rows.delete(doc.id); },
      get docs() { return [...rows.values()]; },
      get hasMore() { return more; },
      get loading() { return Boolean(pending); },
    });
  }

  function searchCache({ check = () => {}, now = Date.now, ttl = 30_000 } = {}) {
    const entries = new Map();
    return { clear: () => entries.clear(), read(key, load) {
      check();
      const entry = entries.get(key);
      if (entry && now() - entry.at < ttl) return entry.promise;
      const next = { at: now() };
      next.promise = Promise.resolve().then(load).then((value) => { check(); return value; })
        .catch((error) => { if (entries.get(key) === next) entries.delete(key); throw error; });
      entries.delete(key); entries.set(key, next);
      if (entries.size > 40) entries.delete(entries.keys().next().value);
      return next.promise;
    } };
  }
  const api = Object.freeze({ create, searchCache });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CollectionPages = api;
})(typeof window === "undefined" ? globalThis : window);
