(function (root) {
  "use strict";
  function state(data = {}) {
    const isNew = data?.adminReviewPending === true;
    const hasRequest = data?.personLinkStatus === "requested" || data?.personLinkRequest?.status === "requested";
    const hasIssue = data?.personLinkIssue?.status === "reported";
    const descriptions = [];
    if (isNew || hasRequest) descriptions.push(isNew
      ? (hasRequest ? "1 neues Konto mit Verknüpfungsantrag" : "1 neues Konto") : "1 offener Verknüpfungsantrag");
    if (hasIssue) descriptions.push("1 gemeldeter Verknüpfungsfehler");
    return { isNew, hasRequest, hasIssue, count: Number(isNew || hasRequest) + Number(hasIssue), descriptions };
  }
  function countFilters() {
    const field = (fieldPath, value) => ({ fieldFilter: { field: { fieldPath }, op: "EQUAL",
      value: typeof value === "boolean" ? { booleanValue: value } : { stringValue: value } } });
    return [
      { compositeFilter: { op: "OR", filters: [field("personLinkStatus", "requested"),
        field("personLinkRequest.status", "requested"), field("adminReviewPending", true)] } },
      field("personLinkIssue.status", "reported"),
    ];
  }
  const api = Object.freeze({ state, countFilters });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LifesavingAccountNotifications = api;
})(typeof window === "object" ? window : globalThis);
