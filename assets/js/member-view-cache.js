(function (root) {
  "use strict";
  const prefix = "lifesaving-baden:member-view:";
  const roles = new Set(["standard", "athlete", "trainer", "organizer", "admin"]);
  function profileForDisplay(data = {}) {
    const profile = {};
    for (const key of ["firstName", "lastName", "displayName", "dlrgBranch", "birthDate", "gender", "personLinkStatus"]) {
      if (typeof data[key] === "string") profile[key] = data[key];
    }
    if (data.personLink && typeof data.personLink === "object") {
      profile.personLink = Object.fromEntries(["id", "name", "birthYear", "gender", "organization"]
        .filter((key) => ["string", "number"].includes(typeof data.personLink[key])).map((key) => [key, data.personLink[key]]));
    }
    if (typeof data.personLinkRequest?.status === "string") profile.personLinkRequest = { status: data.personLinkRequest.status };
    return profile;
  }
  // Presentation only: this cache must never authorize reads, writes or factories.
  function create({ getStorage = () => null, now = Date.now, ttlMs = 30 * 60_000 } = {}) {
    const memory = new Map();
    const valid = (entry, uid) => Boolean(entry?.version === 1 && entry.uid === uid && roles.has(entry.role)
      && Number.isFinite(entry.checkedAt) && now() >= entry.checkedAt && now() - entry.checkedAt < ttlMs
      && entry.profile && typeof entry.profile === "object" && !Array.isArray(entry.profile));
    function clear(uid) {
      memory.delete(uid);
      try { getStorage()?.removeItem(`${prefix}${uid}`); } catch { /* Storage can be blocked. */ }
    }
    function read(uid) {
      if (!uid) return null;
      let entry = memory.get(uid);
      if (!valid(entry, uid)) {
        try {
          const raw = getStorage()?.getItem(`${prefix}${uid}`);
          if (raw) entry = JSON.parse(raw);
        } catch { /* Keep the in-memory snapshot if storage is unavailable. */ }
      }
      if (!valid(entry, uid)) { clear(uid); return null; }
      const snapshot = { ...entry, profile: profileForDisplay(entry.profile) };
      memory.set(uid, snapshot);
      return { ...snapshot, profile: profileForDisplay(snapshot.profile) };
    }
    function persist(entry) {
      memory.set(entry.uid, entry);
      try { getStorage()?.setItem(`${prefix}${entry.uid}`, JSON.stringify(entry)); } catch { /* Memory still works. */ }
      return read(entry.uid);
    }
    function write(uid, data, role) {
      if (!uid || !roles.has(role) || !data) return null;
      return persist({ version: 1, uid, checkedAt: now(), role, profile: profileForDisplay(data) });
    }
    function updateProfile(uid, data) {
      const entry = read(uid);
      // Editing a profile does not extend the lifetime of its checked role.
      return entry && data ? persist({ ...entry, profile: profileForDisplay(data) }) : null;
    }
    function clearAll() {
      for (const uid of [...memory.keys()]) clear(uid);
      try {
        const storage = getStorage();
        for (let index = (storage?.length || 0) - 1; index >= 0; index--) {
          const key = storage.key(index);
          if (key?.startsWith(prefix)) storage.removeItem(key);
        }
      } catch { /* Storage can be blocked. */ }
    }
    return Object.freeze({ read, write, updateProfile, clear, clearAll });
  }
  const api = Object.freeze({ create });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LifesavingMemberViewCache = api;
})(typeof window === "object" ? window : globalThis);
