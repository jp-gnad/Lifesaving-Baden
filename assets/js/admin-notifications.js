(function (root) {
  "use strict";
  function create({ isCurrentUser }) {
    async function countAdminNotifications(user) {
      const token = await user.getIdToken();
      const filters = window.LifesavingAccountNotifications.countFilters();
      // Aggregations return counts without downloading the account documents.
      const counts = await Promise.all(filters.map(async (where) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetch(`https://firestore.googleapis.com/v1/projects/${window.firebaseConfig.projectId}/databases/(default)/documents:runAggregationQuery`, {
            method: "POST", signal: controller.signal,
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ structuredAggregationQuery: {
              structuredQuery: { from: [{ collectionId: "users" }], where },
              aggregations: [{ alias: "total", count: {} }]
            } })
          });
          if (!response.ok) throw new Error("Benachrichtigungen konnten nicht geladen werden.");
          const results = await response.json();
          return Number(results.find((row) => row.result)?.result.aggregateFields.total.integerValue || 0);
        } finally { clearTimeout(timer); }
      }));
      return counts.reduce((sum, count) => sum + count, 0);
    }

    function initAdminAccountBadge(auth) {
      const badge = document.querySelector("[data-admin-notification-count]");
      if (!badge || badge.dataset.listenerAttached) return;
      badge.dataset.listenerAttached = "true";
      const app = badge.closest("a");
      let loading = false;
      let lastUid = "", lastRefresh = 0;
      const refresh = async () => {
        const user = auth.currentUser;
        if (loading || !user || document.visibilityState === "hidden") return;
        if (lastUid === user.uid && Date.now() - lastRefresh < 15_000) return;
        loading = true;
        try {
          const count = await countAdminNotifications(user);
          if (!isCurrentUser(user)) return;
          lastUid = user.uid; lastRefresh = Date.now();
          badge.textContent = String(count);
          badge.hidden = count === 0;
          app.setAttribute("aria-label", count ? `Kontenübersicht öffnen, ${count} offene Meldungen` : "Kontenübersicht öffnen");
          app.removeAttribute("title");
        } catch {
          if (isCurrentUser(user)) app.title = "Benachrichtigungen konnten nicht geladen werden.";
        } finally {
          loading = false;
        }
      };
      refresh();
      window.addEventListener("pageshow", (event) => {
        if (event?.persisted) lastUid = "";
        return refresh();
      });
      document.addEventListener("visibilitychange", refresh);
    }

    return Object.freeze({ countAdminNotifications, initAdminAccountBadge });
  }
  root.LifesavingAdminNotifications = Object.freeze({ create });
})(window);
