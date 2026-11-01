(function () {
  "use strict";
  const key = "lifesaving-baden:google-handoff-v1";
  const ttl = 2 * 60 * 1000;
  const limit = 3;
  let expiryTimer = null;

  function clear() {
    if (expiryTimer !== null) window.clearTimeout(expiryTimer);
    expiryTimer = null;
    try { window.sessionStorage.removeItem(key); } catch { /* Storage may be blocked. */ }
  }

  function armExpiry(createdAt) {
    if (expiryTimer !== null) window.clearTimeout(expiryTimer);
    expiryTimer = window.setTimeout(() => read(), Math.max(1, ttl - (Date.now() - createdAt)));
  }

  function read() {
    try {
      const data = JSON.parse(window.sessionStorage.getItem(key) || "null");
      if (!data) return null;
      if (typeof data.token !== "string" || !data.token || data.token.length > 16384
        || typeof data.clientId !== "string" || !data.clientId || data.clientId !== window.googleSignInClientId
        || typeof data.projectId !== "string" || !data.projectId || data.projectId !== window.firebaseConfig?.projectId
        || !Number.isFinite(data.createdAt) || Date.now() - data.createdAt < 0 || Date.now() - data.createdAt >= ttl
        || !Number.isInteger(data.attempts) || data.attempts < 0 || data.attempts > limit) {
        clear();
        return null;
      }
      armExpiry(data.createdAt);
      const { token, clientId, projectId, createdAt, attempts } = data;
      return { token, clientId, projectId, createdAt, attempts };
    } catch {
      clear();
      return null;
    }
  }

  function write(data) {
    try {
      const serialized = JSON.stringify(data);
      window.sessionStorage.setItem(key, serialized);
      if (window.sessionStorage.getItem(key) !== serialized) throw new Error("Storage unavailable");
      armExpiry(data.createdAt);
      return true;
    } catch {
      clear();
      return false;
    }
  }

  function save(token) {
    if (typeof token !== "string" || !token || token.length > 16384
      || !window.googleSignInClientId || !window.firebaseConfig?.projectId) return false;
    return write({ token, clientId: window.googleSignInClientId, projectId: window.firebaseConfig.projectId,
      createdAt: Date.now(), attempts: 0 });
  }

  function takeAttempt() {
    const data = read();
    if (!data || data.attempts >= limit) {
      clear();
      return false;
    }
    return write({ ...data, attempts: data.attempts + 1 });
  }

  window.LifesavingGoogleHandoff = Object.freeze({ save, read, takeAttempt, clear });
})();
