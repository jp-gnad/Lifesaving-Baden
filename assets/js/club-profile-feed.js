(function (root) {
  "use strict";
  function create({ db, isAdmin, documentId = "__name__", isCurrent, onChange, onError }) {
    const values = new Map(), subscriptions = new Map();
    let generation = 0, scheduled = false;
    const notify = () => {
      if (scheduled) return;
      scheduled = true;
      const version = generation;
      Promise.resolve().then(() => {
        if (generation !== version) return;
        scheduled = false;
        if (isCurrent()) onChange();
      });
    };
    const signature = (value) => JSON.stringify(value);
    function sync(accountIds) {
      const ids = [...new Set(accountIds)].sort(), needed = new Set(ids), groups = new Map();
      for (const id of values.keys()) if (!needed.has(id)) values.delete(id);
      // Only administrators already have list access. Trainer document reads
      // keep the existing stricter rules; no collection permission is widened.
      const remaining = new Set(ids);
      for (const key of subscriptions.keys()) {
        const members = JSON.parse(key);
        if (members.every((id) => needed.has(id))) {
          groups.set(key, members); members.forEach((id) => remaining.delete(id));
        }
      }
      const additions = [...remaining];
      for (let offset = 0; offset < additions.length; offset += isAdmin ? 10 : 1) {
        const members = additions.slice(offset, offset + (isAdmin ? 10 : 1));
        groups.set(JSON.stringify(members), members);
      }
      for (const [key, entry] of subscriptions) if (!groups.has(key)) { entry.stop(); subscriptions.delete(key); }
      for (const [key, members] of groups) {
        if (subscriptions.has(key)) continue;
        const entry = {};
        subscriptions.set(key, entry);
        const current = () => isCurrent() && subscriptions.get(key) === entry;
        const query = isAdmin ? db.collection("clubProfiles").where(documentId, "in", members).limit(10)
          : db.collection("clubProfiles").doc(members[0]);
        entry.stop = query.onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
          if (!current() || snapshot.metadata.fromCache) return;
          const documents = isAdmin ? snapshot.docs : snapshot.exists ? [snapshot] : [];
          const profiles = new Map(documents.map((doc) => [doc.id || members[0], doc.data()]));
          let changed = false;
          for (const id of members) {
            const value = profiles.get(id) || null;
            if (!values.has(id) || signature(values.get(id)) !== signature(value)) { values.set(id, value); changed = true; }
          }
          if (changed) notify();
        }, (error) => { if (current()) onError(error); });
      }
    }
    return Object.freeze({ values, sync, clear() {
      generation += 1; scheduled = false;
      for (const entry of subscriptions.values()) entry.stop();
      subscriptions.clear(); values.clear();
    } });
  }
  if (typeof module === "object" && module.exports) module.exports = { create };
  else root.ClubProfileFeed = Object.freeze({ create });
})(typeof window === "undefined" ? globalThis : window);
