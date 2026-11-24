(function (root) {
  "use strict";
  const storageKey = "lifesaving-baden:account-avatar:v1";
  const maxImageLength = 350_000;
  const safeSource = (value) => typeof value === "string" && /^https?:\/\//i.test(value) && value.length < 4096 ? value : "";
  const safeImage = (value, source) => typeof value === "string" && value.length <= maxImageLength
    && (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(value) || value === safeSource(source)) ? value : "";
  const safeName = (value) => typeof value === "string" && value.length <= 512 ? value : undefined;

  // Presentation only. This snapshot never establishes authentication or roles.
  function create({ getStorage = () => null, loadImage = async () => "", now = Date.now, onChange = () => {}, refreshMs = 24 * 60 * 60_000 } = {}) {
    let entry = null;
    let generation = 0;
    let pending = null;
    const read = () => entry ? { ...entry } : null;
    function persist() {
      try {
        if (entry) getStorage()?.setItem(storageKey, JSON.stringify(entry));
        else getStorage()?.removeItem(storageKey);
      } catch { /* A blocked/full storage must not block the account or its avatar. */ }
      onChange(read());
    }
    function clear() {
      generation += 1;
      pending = null;
      entry = null;
      persist();
    }
    function restore() {
      generation += 1;
      pending = null;
      try {
        const saved = JSON.parse(getStorage()?.getItem(storageKey) || "null");
        if (saved?.version === 1 && typeof saved.uid === "string" && saved.uid && saved.uid.length < 256
          && typeof saved.initials === "string" && saved.initials.length <= 4
          && Number.isFinite(saved.updatedAt) && saved.updatedAt <= now()) {
          entry = { version: 1, uid: saved.uid, initials: saved.initials, name: safeName(saved.name), source: safeSource(saved.source),
            imageSource: safeSource(saved.imageSource), image: safeImage(saved.image, saved.imageSource), updatedAt: saved.updatedAt };
        } else entry = null;
      } catch { entry = null; }
      onChange(read());
      return read();
    }
    function sync(user, initials = "?") {
      if (!user?.uid) { clear(); return Promise.resolve(null); }
      const source = safeSource(user.photoURL);
      if (entry?.uid !== user.uid || entry.source !== source) {
        generation += 1;
        pending = null;
      }
      const sameAccount = entry?.uid === user.uid;
      entry = { version: 1, uid: user.uid, initials: String(initials).slice(0, 4), name: sameAccount ? entry.name : undefined, source,
        imageSource: sameAccount ? entry.imageSource : "", image: sameAccount ? entry.image : "",
        updatedAt: sameAccount ? entry.updatedAt : 0 };
      if (!source) { entry.image = ""; entry.imageSource = ""; }
      persist();
      if (!source || (entry.image && entry.imageSource === source && now() - entry.updatedAt < refreshMs)) return Promise.resolve(read());
      if (pending) return pending;
      const expectedGeneration = generation;
      const request = Promise.resolve().then(() => loadImage(source)).then((image) => {
        if (expectedGeneration !== generation || entry?.uid !== user.uid || entry.source !== source) return read();
        const safe = safeImage(image, source);
        if (safe) { entry = { ...entry, image: safe, imageSource: source, updatedAt: now() }; persist(); }
        return read();
      }).catch(() => read()).finally(() => { if (pending === request) pending = null; });
      pending = request;
      return request;
    }
    function setName(uid, value) {
      const name = safeName(value);
      if (!entry || entry.uid !== uid || entry.name === name) return;
      entry = { ...entry, name };
      persist();
    }
    return Object.freeze({ restore, read, sync, clear, setName });
  }
  const api = Object.freeze({ create });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LifesavingAccountAvatarCache = api;
})(typeof window === "object" ? window : globalThis);
