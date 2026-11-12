(function (root) {
  "use strict";

  function create({ isCurrentUser }) {
    let session;

    function stop() {
      const owner = session;
      session = null;
      if (!owner) return;
      owner.unsubscribe?.();
      root.removeEventListener("pageshow", owner.refresh);
      root.removeEventListener("focus", owner.refresh);
      root.document.removeEventListener("visibilitychange", owner.refresh);
      owner.badge.hidden = true;
      owner.badge.textContent = "";
      owner.app.setAttribute("aria-label", "Gliederungen öffnen");
    }

    function start(auth) {
      const user = auth.currentUser;
      if (!user || (session?.uid === user.uid && session.auth === auth)) return;
      stop();
      const badge = root.document.querySelector("[data-club-notification-count]");
      if (!badge) return;
      const owner = { auth, uid: user.uid, badge, app: badge.closest("a") };
      session = owner;
      const current = () => session === owner && isCurrentUser(user);
      owner.refresh = () => {
        if (!current()) { if (session === owner) stop(); return; }
        if (root.document.visibilityState === "hidden") {
          owner.generation = (owner.generation || 0) + 1;
          owner.unsubscribe?.(); owner.unsubscribe = null; return;
        }
        if (owner.unsubscribe) return;
        const generation = owner.generation = (owner.generation || 0) + 1;
        // Listen only to unresolved responsibility alerts, never all clubs or
        // their people. Hidden pages release the listener.
        owner.unsubscribe = root.firebase.firestore().collection("clubs").where("needsResponsible", "==", true)
          .onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
            if (!current() || owner.generation !== generation || snapshot.metadata.fromCache) return;
            const count = snapshot.size;
            badge.textContent = String(count);
            badge.hidden = count === 0;
            owner.app.setAttribute("aria-label", count ? `Gliederungen öffnen, ${count} ohne Verantwortlichen` : "Gliederungen öffnen");
            owner.app.removeAttribute("title");
          }, () => {
            if (!current() || owner.generation !== generation) return;
            owner.unsubscribe = null;
            if (current()) owner.app.title = "Meldungen konnten nicht geladen werden.";
          });
      };
      root.addEventListener("pageshow", owner.refresh);
      root.addEventListener("focus", owner.refresh);
      root.document.addEventListener("visibilitychange", owner.refresh);
      owner.refresh();
    }

    return Object.freeze({ start, stop });
  }

  const api = Object.freeze({ create });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LifesavingClubNotifications = api;
})(typeof window === "object" ? window : globalThis);
