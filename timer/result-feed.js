(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TimerResultFeed = api;
})(typeof window === "undefined" ? null : window, function () {
  "use strict";

  // One event listener and one bounded result page, owned by the open view.
  function create({ listenEvent, listenPage, canView, visibility, onValue, onError }) {
    let disposed = false;
    let stopEvent = null;
    let stopPage = null;
    let eventGeneration = 0;
    let pageGeneration = 0;
    let event = null;
    let page = null;
    let pageIndex = 0;
    let cursors = [null];
    const publish = () => {
      if (!disposed && event && page) onValue({ event, ...page, pageIndex });
    };
    const clearPage = () => {
      pageGeneration += 1;
      stopPage?.();
      stopPage = null;
    };
    const startPage = () => {
      clearPage();
      page = null;
      const generation = pageGeneration;
      stopPage = listenPage(cursors[pageIndex], (value) => {
        if (disposed || generation !== pageGeneration) return;
        page = value;
        publish();
      }, (error) => {
        if (!disposed && generation === pageGeneration) onError(error);
      });
    };
    const pause = () => {
      eventGeneration += 1;
      stopEvent?.();
      stopEvent = null;
      clearPage();
    };
    const resume = () => {
      if (disposed || visibility.visibilityState === "hidden" || stopEvent) return;
      const generation = eventGeneration;
      stopEvent = listenEvent((value) => {
        if (disposed || generation !== eventGeneration) return;
        event = value;
        if (!canView(event)) {
          clearPage();
          cursors = [null];
          pageIndex = 0;
          page = { results: [], hasMore: false, nextCursor: null };
          publish();
        } else if (!stopPage) startPage();
        else publish(); // Metadata updates must not reconnect the result query.
      }, (error) => {
        if (disposed || generation !== eventGeneration) return;
        clearPage();
        page = null;
        onError(error);
      });
    };
    const visibilityChanged = () => visibility.visibilityState === "hidden" ? pause() : resume();
    visibility.addEventListener("visibilitychange", visibilityChanged);
    resume();
    return {
      next() {
        if (disposed || !stopEvent || !page?.hasMore || !page.nextCursor || !canView(event)) return false;
        cursors = cursors.slice(0, pageIndex + 1);
        cursors.push(page.nextCursor);
        pageIndex += 1;
        startPage();
        return true;
      },
      previous() {
        if (disposed || !stopEvent || !pageIndex || !page || !canView(event)) return false;
        pageIndex -= 1;
        startPage();
        return true;
      },
      refresh() {
        if (!disposed && stopEvent && canView(event)) startPage();
      },
      stop() {
        disposed = true;
        pause();
        visibility.removeEventListener("visibilitychange", visibilityChanged);
      },
    };
  }

  // Explicit full export only: normal navigation never calls this helper.
  async function readAll(readPage, check = () => {}) {
    const results = new Map();
    const seen = new Set();
    let cursor = null;
    do {
      check();
      const page = await readPage(cursor);
      check();
      page.results.forEach((result) => results.set(result.id, result));
      if (!page.hasMore) return [...results.values()];
      cursor = page.nextCursor;
      if (!cursor || seen.has(cursor)) throw new Error("Die nächsten Ergebnisse konnten nicht geladen werden.");
      seen.add(cursor);
    } while (true);
  }

  return { create, readAll };
});
