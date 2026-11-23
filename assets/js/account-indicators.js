(function (root) {
  "use strict";
  const key = "lifesaving-baden:account-indicators:v1";
  const categories = { personal: "Persönliche Daten", links: "Verknüpfungen" };
  const counts = {
    accounts: { selector: "[data-admin-notification-count]", name: "Kontenübersicht öffnen", message: (count) => `${count} offene Meldungen` },
    clubs: { selector: "[data-club-notification-count]", name: "Gliederungen öffnen", message: (count) => `${count} ohne Verantwortlichen` },
  };
  const isCount = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;

  function profileCounts(data, linked) {
    return {
      personal: [data?.dlrgBranch, data?.birthDate, data?.gender].filter((value) => !(typeof value === "string" ? value.trim() : value)).length,
      links: linked ? 0 : 1,
    };
  }

  function create({ document, getStorage = () => null }) {
    let snapshot = null;
    function setAttribute(element, name, value) {
      if (element && element.getAttribute?.(name) !== value) element.setAttribute(name, value);
    }
    function setHidden(element, hidden, useClass = false) {
      if (element.hidden !== hidden) element.hidden = hidden;
      if (useClass) element.classList.toggle("is-hidden", hidden);
    }
    function setText(element, value) {
      if (element.textContent !== value) element.textContent = value;
    }
    function renderProfile(profile) {
      const missing = profile ? profile.personal + profile.links : 0;
      const linked = profile?.links === 0;
      const label = `${missing} offene ${missing === 1 ? "Angabe" : "Angaben"}`;
      document.querySelectorAll("[data-link-indicator]").forEach((element) => setHidden(element, !linked, true));
      document.querySelectorAll("[data-account-attention], [data-account-manage-attention]").forEach((element) => {
        setHidden(element, !missing, true);
        setText(element, missing ? String(missing) : "");
        setAttribute(element, "aria-hidden", "true");
      });
      document.querySelectorAll("[data-settings-attention]").forEach((element) => {
        const category = element.dataset.settingsAttention;
        const count = profile?.[category] || 0;
        setHidden(element, !count);
        setText(element, count ? String(count) : "");
        setAttribute(element.closest("a"), "aria-label", count ? `${categories[category]} – ${count} offene ${count === 1 ? "Angabe" : "Angaben"}` : categories[category]);
      });
      document.querySelectorAll("[data-account-open]").forEach((element) => setAttribute(element, "aria-label", profile
        ? `Kontoprofil öffnen – Konto ${linked ? "verknüpft" : "nicht verknüpft"}${missing ? `, ${label}` : ""}` : "Kontoprofil öffnen"));
      document.querySelectorAll(".account-manage").forEach((element) => setAttribute(element, "aria-label", missing
        ? `Kontoeinstellungen – ${label}` : "Kontoeinstellungen"));
      document.querySelectorAll("[data-timer-account-header-attention], [data-timer-account-manage-attention]").forEach((element) => {
        setHidden(element, !missing || snapshot?.isAdmin !== false);
      });
    }
    function renderCount(kind) {
      const { selector, name, message } = counts[kind];
      const count = snapshot?.[kind];
      document.querySelectorAll(selector).forEach((element) => {
        setHidden(element, !count);
        setText(element, count === undefined ? "" : String(count));
        setAttribute(element.closest("a"), "aria-label", count ? `${name}, ${message(count)}` : name);
      });
    }
    function render() {
      renderProfile(snapshot?.profile);
      Object.keys(counts).forEach(renderCount);
    }
    function save(next) {
      if (JSON.stringify(snapshot) === JSON.stringify(next)) return;
      snapshot = next;
      try {
        if (next) getStorage()?.setItem(key, JSON.stringify(next));
        else getStorage()?.removeItem(key);
      } catch { /* A blocked store still allows the current page to update. */ }
      render();
    }
    function restore() {
      try {
        const raw = JSON.parse(getStorage()?.getItem(key) || "null");
        snapshot = raw && typeof raw.uid === "string" && raw.uid && raw.uid.length < 256 ? { uid: raw.uid } : null;
        if (snapshot) {
          if (isCount(raw.profile?.personal, 3) && isCount(raw.profile?.links, 1)) {
            snapshot.profile = { personal: raw.profile.personal, links: raw.profile.links };
          }
          if (typeof raw.isAdmin === "boolean") snapshot.isAdmin = raw.isAdmin;
          if (raw.isAdmin === true) for (const kind of Object.keys(counts)) {
            if (isCount(raw[kind])) snapshot[kind] = raw[kind];
          }
        }
      } catch { /* Keep a working in-memory snapshot if storage is blocked. */ }
      render();
    }
    function setAccount(uid) {
      if (!uid) save(null);
      else if (snapshot?.uid !== uid) save({ uid });
    }
    function setProfile(uid, profile) {
      if (uid === snapshot?.uid && snapshot) save({ ...snapshot, profile });
    }
    function setRole(uid, isAdmin) {
      if (!snapshot || snapshot.uid !== uid) return;
      const next = { ...snapshot, isAdmin };
      if (!isAdmin) Object.keys(counts).forEach((kind) => { delete next[kind]; });
      save(next);
    }
    function setCount(uid, kind, count) {
      if (snapshot?.uid === uid && snapshot?.isAdmin && Object.hasOwn(counts, kind) && isCount(count)) save({ ...snapshot, [kind]: count });
    }
    return Object.freeze({ restore, render, renderProfile, setAccount, setProfile, setRole, setCount, profileCounts,
      hasProfile: () => Boolean(snapshot?.profile) });
  }

  if (typeof module === "object" && module.exports) module.exports = { create, profileCounts };
  else {
    const indicators = root.LifesavingAccountIndicators = create({ document: root.document || document, getStorage: () => root.sessionStorage });
    indicators.restore();
    root.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      indicators.restore();
      if (root.firebase?.apps?.length) indicators.setAccount(root.firebase.auth().currentUser?.uid);
    });
  }
})(typeof window === "object" ? window : globalThis);
