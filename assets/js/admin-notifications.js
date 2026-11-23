(function (root) {
  "use strict";
  function create({ isCurrentUser }) {
    const indicators = root.LifesavingAccountIndicators;
    let session;
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

    function stopAdminAccountBadge() {
      const owner = session;
      session = null;
      if (!owner) return;
      root.removeEventListener?.("pageshow", owner.pageshow);
      document.removeEventListener?.("visibilitychange", owner.refresh);
    }

    function initAdminAccountBadge(auth) {
      const badge = document.querySelector("[data-admin-notification-count]");
      const user = auth.currentUser;
      if (!badge || !user || session?.uid === user.uid) return;
      stopAdminAccountBadge();
      const app = badge.closest("a");
      const owner = { uid: user.uid };
      session = owner;
      const current = () => session === owner && isCurrentUser(user);
      let loading = false;
      let lastRefresh = -Infinity;
      owner.refresh = async () => {
        if (loading || !current() || document.visibilityState === "hidden") return;
        if (Date.now() - lastRefresh < 15_000) return;
        loading = true;
        try {
          const count = await countAdminNotifications(user);
          if (!current()) return;
          lastRefresh = Date.now();
          indicators?.setCount(user.uid, "accounts", count);
          app.removeAttribute("title");
        } catch {
          if (current()) app.title = "Benachrichtigungen konnten nicht geladen werden.";
        } finally {
          loading = false;
        }
      };
      owner.pageshow = (event) => {
        if (event?.persisted) lastRefresh = -Infinity;
        return owner.refresh();
      };
      owner.refresh();
      root.addEventListener("pageshow", owner.pageshow);
      document.addEventListener("visibilitychange", owner.refresh);
    }

    return Object.freeze({ countAdminNotifications, initAdminAccountBadge, stopAdminAccountBadge });
  }
  root.LifesavingAdminNotifications = Object.freeze({ create });
})(window);
