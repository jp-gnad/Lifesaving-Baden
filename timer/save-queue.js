(function (root) {
  "use strict";

  function create({ store, request, getAccountId, online, newId, changed = () => {}, failed = () => {}, completed = () => {} }) {
    let running = null;
    let requested = false;
    let retryBlocked = false;
    let lastCreatedAt = 0;
    const completions = new Map();
    const operationFor = (record) => record.operation || { path: `/events/${encodeURIComponent(record.eventId)}/results`, method: "POST" };
    function dependsOn(blocker, record) {
      if (blocker.eventId !== record.eventId) return false;
      const before = operationFor(blocker), next = operationFor(record);
      if (before.method === "POST") {
        if (before.path === "/events") return true;
        const resource = `${before.path.replace(/\/import$/, "")}/${encodeURIComponent(blocker.clientSubmissionId)}`;
        return next.path === resource || record.payload.participantId === blocker.clientSubmissionId
          || record.payload.participantIds?.includes(blocker.clientSubmissionId);
      }
      return before.path === next.path && next.method !== "DELETE";
    }
    const owns = (record, account) => record.accountId === undefined || record.accountId === account;
    const notify = () => { Promise.resolve().then(changed).catch(() => {}); };

    async function list() {
      const account = await getAccountId();
      const records = await store.getPendingResults();
      if (account !== await getAccountId()) return [];
      return records.filter((record) => owns(record, account))
        .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
    }

    function sync({ includeBlocked = false } = {}) {
      requested = true;
      retryBlocked ||= includeBlocked;
      if (running) return running;
      running = Promise.resolve().then(async () => {
        let count = 0;
        let networkFailed = false;
        while (requested && !networkFailed && online()) {
          requested = false;
          const include = retryBlocked;
          retryBlocked = false;
          const account = await getAccountId();
          const pending = (await store.getPendingResults())
            .filter((record) => owns(record, account))
            .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
          const isUpdate = (record) => record.operation?.method === "PATCH";
          const latestUpdates = new Map(pending.filter(isUpdate).map((record) => [record.operation.path, record]));
          const blocked = [];
          for (const record of pending) {
            if (!online() || account !== await getAccountId()) break;
            const snapshotUpdate = isUpdate(record);
            if (snapshotUpdate && latestUpdates.get(record.operation.path) !== record) continue;
            if (blocked.some((earlier) => dependsOn(earlier, record))) continue;
            if (record.blocked && !include) { blocked.push(record); continue; }
            try {
              const operation = operationFor(record);
              let response;
              try {
                response = await request(operation.path, {
                  method: operation.method,
                  background: true,
                  ...(operation.method === "DELETE" ? {} : { body: JSON.stringify(record.payload) }),
                });
              } catch (error) {
                if (operation.method !== "DELETE" || error?.status !== 404) throw error;
                response = { ok: true };
              }
              // A completion from the old account must not update the new UI.
              if (account !== await getAccountId()) break;
              await store.deletePendingResult(record.clientSubmissionId);
              // Editors submit complete snapshots. A newer saved form supersedes
              // older drafts for this resource, including a rejected draft.
              if (snapshotUpdate) {
                for (const older of pending) {
                  if (older !== record && isUpdate(older) && older.operation.path === record.operation.path) {
                    await store.deletePendingResult(older.clientSubmissionId);
                    completions.get(older.clientSubmissionId)?.resolve(response);
                    completions.delete(older.clientSubmissionId);
                  }
                }
              }
              completions.get(record.clientSubmissionId)?.resolve(response);
              completions.delete(record.clientSubmissionId);
              Promise.resolve().then(() => completed(record, response)).catch(() => {});
              count += 1;
            } catch (error) {
              if (account !== await getAccountId()) break;
              const retryable = error?.isNetworkError || [408, 423, 429].includes(error?.status) || Number(error?.status) >= 500;
              await store.putPendingResult({ ...record, attempts: (record.attempts || 0) + 1,
                lastAttemptAt: new Date().toISOString(), lastError: error.message, blocked: !retryable });
              blocked.push(record);
              if (!retryable) failed(record, error);
              if (retryable) { requested = false; networkFailed = true; break; }
            }
            notify();
          }
        }
        return count;
      }).then((count) => {
        running = null;
        notify();
        return requested && online() ? sync().then((next) => count + next) : count;
      }, (error) => {
        running = null;
        notify();
        throw error;
      });
      notify();
      return running;
    }

    async function enqueue(eventId, payload, operation = null) {
      const accountId = await getAccountId();
      const clientSubmissionId = newId();
      lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
      const record = {
        clientSubmissionId, eventId: eventId || clientSubmissionId, accountId,
        payload: { ...payload, ...(operation ? { clientMutationId: clientSubmissionId } : { clientSubmissionId }) },
        ...(operation ? { operation } : {}),
        createdAt: new Date(lastCreatedAt).toISOString(), attempts: 0, blocked: false,
      };
      // Only the local transaction commit is on the interaction path.
      await store.putPendingResult(record);
      let resolve;
      const completion = new Promise((done) => { resolve = done; });
      completions.set(clientSubmissionId, { resolve });
      notify();
      sync().catch(() => {});
      return { clientSubmissionId, completion, record };
    }

    return Object.freeze({ enqueue, sync, list, isSyncing: () => Boolean(running) });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { create };
  else root.TimerSaveQueue = Object.freeze({ create });
})(typeof window === "undefined" ? globalThis : window);
