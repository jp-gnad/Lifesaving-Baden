(function (root) {
  "use strict";
  const core = typeof module === "object" && module.exports ? require("./club-events-core.js") : root.ClubEventsCore;
  const prefix = "lifesaving-club-event-queue-v1/";
  function create({ storage, isCurrent, send, onChange = () => {}, locks, makeId = () => root.crypto.randomUUID() }) {
    let owner = null;
    let records = [];
    let running = null;
    let sending = "";
    let storageError = "";
    let issued = 0;
    const confirmed = new Map();
    const identity = (clubId, eventId) => `${clubId}/${eventId}`;
    const accountPrefix = () => `${prefix}${encodeURIComponent(owner.uid)}/`;
    const key = (record) => `${prefix}${encodeURIComponent(record.accountId)}/${record.id}`;
    const changed = () => onChange(owner);
    function read() {
      const result = [];
      for (let index = 0; index < storage.length; index += 1) {
        const name = storage.key(index);
        if (!name?.startsWith(accountPrefix())) continue;
        const record = JSON.parse(storage.getItem(name));
        if (!record?.id || record.accountId !== owner.uid || !record.action || !record.clubId || !record.eventId) throw new Error("Ungültige lokale Änderung.");
        result.push(record);
      }
      return result.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    }
    function refresh() {
      try { records = read(); storageError = ""; }
      catch { storageError = "Lokale Änderungen konnten nicht gelesen werden."; }
    }
    function guard(account) {
      if (owner !== account || !isCurrent(account)) throw Object.assign(new Error("Das Konto hat sich geändert."), { code: "clubs/queue-session" });
    }
    function start(account) {
      if (owner !== account) { owner = account; confirmed.clear(); records = []; }
      refresh();
      Promise.resolve().then(flush);
    }
    function enqueue(clubId, eventId, action, base) {
      guard(owner);
      if (storageError) throw Object.assign(new Error(storageError), { code: "clubs/queue-storage" });
      const view = core.replay(base, action);
      if (view === base) return view;
      const record = JSON.parse(JSON.stringify({ id: makeId(), accountId: owner.uid, clubId, eventId, action, base,
        view, createdAt: issued = Math.max(Date.now(), issued + 1) }));
      try { storage.setItem(key(record), JSON.stringify(record)); }
      catch { throw Object.assign(new Error("Die Änderung konnte nicht lokal gespeichert werden."), { code: "clubs/queue-storage" }); }
      records.push(record);
      changed();
      Promise.resolve().then(flush);
      return view;
    }
    async function drain(account) {
      while (owner === account && isCurrent(account)) {
        refresh();
        if (storageError) return;
        const blocked = new Set();
        const record = records.find((entry) => {
          const id = identity(entry.clubId, entry.eventId);
          if (entry.error) blocked.add(id);
          return !blocked.has(id);
        });
        if (!record) return;
        sending = record.id;
        try {
          const result = await send(account, record, () => guard(account));
          guard(account);
          const id = identity(record.clubId, record.eventId);
          const previous = confirmed.get(id);
          if (!previous || !result || result.revision >= previous.revision) confirmed.set(id, result ? { ...result, id: record.eventId } : { deleted: true });
          storage.removeItem(key(record));
        } catch (error) {
          if (owner !== account || !isCurrent(account) || error.code === "clubs/queue-session") return;
          const updated = { ...record, error: {
            code: error.code || "", message: error.code?.startsWith("clubs/") ? error.message : "Änderungen konnten nicht übertragen werden.",
          } };
          try { storage.setItem(key(record), JSON.stringify(updated)); }
          catch { storageError = "Die lokale Speicherung ist nicht verfügbar."; return; }
        } finally {
          sending = "";
          if (owner === account) { refresh(); changed(); }
        }
      }
    }
    function flush() {
      if (!owner || !isCurrent(owner) || running) return running || Promise.resolve();
      const account = owner;
      let acquired = true;
      running = (async () => {
        if (locks) await locks.request(`${prefix}${account.uid}`, { ifAvailable: true }, async (lock) => {
          acquired = Boolean(lock);
          if (lock) await drain(account);
        });
        else await drain(account);
      })().catch(() => { storageError = "Die Hintergrundübertragung ist nicht verfügbar."; changed(); }).finally(() => {
        running = null;
        if (owner !== account) Promise.resolve().then(flush);
        // A tab holding the lock publishes storage events when it finishes.
        if (!acquired) { changed(); if (owner === account && isCurrent(account)) root.setTimeout(flush, 500); }
      });
      return running;
    }
    function project(clubId, eventId, server) {
      const id = identity(clubId, eventId);
      const saved = confirmed.get(id);
      let result = server;
      if (saved?.deleted) result = null;
      else if (saved && (!server || saved.revision > server.revision)) result = saved;
      else if (saved) confirmed.delete(id);
      for (const record of records.filter((entry) => entry.clubId === clubId && entry.eventId === eventId)) {
        if (!result && record.action.type !== "create") result = record.base;
        else if (result && record.base?.revision > result.revision) result = record.base;
        try { result = core.replay(result, record.action); }
        catch { result = record.view; }
      }
      return result ? { ...result, id: eventId } : null;
    }
    function ids(clubId) {
      return [...new Set([...records.filter((entry) => entry.clubId === clubId).map((entry) => entry.eventId),
        ...[...confirmed.keys()].filter((id) => id.startsWith(`${clubId}/`)).map((id) => id.slice(clubId.length + 1))])];
    }
    function status(clubId, eventId = "") {
      const pending = records.filter((entry) => entry.clubId === clubId && (!eventId || entry.eventId === eventId));
      return { count: pending.length, error: storageError || pending.find((entry) => entry.error)?.error.message || "", sending: pending.some((entry) => entry.id === sending) };
    }
    function retry(clubId = "") {
      if (!owner || !isCurrent(owner)) return Promise.resolve();
      try {
        for (const record of records.filter((entry) => (!clubId || entry.clubId === clubId) && entry.error)) {
          const updated = { ...record }; delete updated.error;
          storage.setItem(key(updated), JSON.stringify(updated));
        }
      } catch { storageError = "Die lokale Speicherung ist nicht verfügbar."; changed(); return Promise.resolve(); }
      refresh(); changed(); return flush();
    }
    function discard(clubId, eventId) {
      if (!owner || !isCurrent(owner)) return;
      if (status(clubId, eventId).sending) return;
      try { for (const record of records.filter((entry) => entry.clubId === clubId && entry.eventId === eventId)) storage.removeItem(key(record)); }
      catch { storageError = "Lokale Änderungen konnten nicht verworfen werden."; changed(); return; }
      confirmed.delete(identity(clubId, eventId));
      refresh(); changed();
    }
    function resume() {
      if (!owner || !isCurrent(owner)) return Promise.resolve();
      const before = JSON.stringify(records);
      refresh();
      if (before !== JSON.stringify(records)) changed();
      return flush();
    }
    return Object.freeze({ start, enqueue, project, ids, status, retry, discard, resume, flush });
  }
  const api = Object.freeze({ create });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClubEventsQueue = api;
})(typeof window === "object" ? window : globalThis);
