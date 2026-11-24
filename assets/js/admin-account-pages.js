(function (root) {
  "use strict";

  const pageSize = 10;
  const roleRanks = { admin: 0, organizer: 2, trainer: 3, athlete: 4, standard: 5 };
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("de");

  function rank(role, { isNew, hasRequest }) {
    return role === "admin" ? 0 : isNew || hasRequest ? 1 : roleRanks[role] ?? 5;
  }

  function matches(filters, { role, linked, isNew, hasRequest, search }) {
    if (filters.role && filters.role !== role) return false;
    if (filters.status === "linked" && !linked || filters.status === "unlinked" && linked
      || filters.status === "new" && !isNew || filters.status === "requested" && !hasRequest) return false;
    const text = normalize(search);
    return filters.terms.every((term) => text.includes(term));
  }

  function roleVariants(values) {
    return values.flatMap((value) => [value, value.toUpperCase(), value[0].toUpperCase() + value.slice(1)])
      .flatMap((value) => [value, ` ${value} `]);
  }

  function create({ collection, documentId, createPages, check }) {
    const roles = (...values) => collection.where("role", "in", roleVariants(values));
    const flag = (field) => collection.where(field, "==", true);
    const requests = (field) => collection.where(field, "==", "requested");
    // Query indexed priority groups first. The final cursor also covers legacy
    // documents without a role or the fields used by newer accounts.
    const groups = [
      [roles("admin"), flag("admin"), flag("isAdmin")],
      [flag("adminReviewPending"), requests("personLinkStatus"), requests("personLinkRequest.status")],
      [roles("organizer", "organisator")],
      [roles("trainer")],
      [roles("athlete", "kader-sportler", "kadersportler", "kader"), flag("kader"), flag("isKaderAthlete")],
      [roles("standard", "sportler"), collection],
    ].flatMap((queries, rank) => queries.map((query, index) => ({
      rank, fallback: query === collection, status: rank === 1 ? (index === 0 ? "new" : "requested") : "",
      pages: createPages({ collection: query, documentId, check, size: pageSize }),
    })));
    const docs = new Map();

    function source(role, status) {
      if (status === "new" || status === "requested") {
        return groups.find((group) => group.status === status && group.pages.hasMore);
      }
      const roleRank = roleRanks[role];
      return groups.find(({ rank, fallback, pages }) => pages.hasMore && (!role || rank === roleRank || rank === 1 && roleRank > 1 || fallback));
    }

    async function next(role, status) {
      const current = source(role, status);
      if (!current) return 0;
      const page = await current.pages.next();
      for (const doc of page) if (!docs.has(doc.id)) docs.set(doc.id, doc);
      return page.length;
    }

    return Object.freeze({
      next,
      cutoff: (role, status) => source(role, status)?.rank ?? 5,
      hasMore: (role, status) => Boolean(source(role, status)),
      fallback: (role, status) => source(role, status)?.fallback === true,
      replace(doc) { docs.set(doc.id, doc.exists ? doc : null); },
      get docs() { return [...docs.values()].filter(Boolean); },
    });
  }

  const api = Object.freeze({ pageSize, rank, matches, terms: (value) => normalize(value).trim().split(/\s+/).filter(Boolean), create });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LifesavingAdminAccountPages = api;
})(typeof window === "undefined" ? globalThis : window);
