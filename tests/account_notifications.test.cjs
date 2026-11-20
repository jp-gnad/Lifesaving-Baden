const test = require("node:test");
const assert = require("node:assert/strict");
const notifications = require("../assets/js/account-notifications-core.js");

test("new registrations and link requests share one notification while independent issues remain separate", () => {
  for (const [data, count] of [[null, 0], [{}, 0], [{ adminReviewPending: false }, 0],
    [{ adminReviewPending: true }, 1], [{ adminReviewPending: true, personLinkStatus: "requested" }, 1],
    [{ adminReviewPending: true, personLinkStatus: "requested", personLinkRequest: { status: "requested" } }, 1],
    [{ adminReviewPending: false, personLinkRequest: { status: "requested" } }, 1],
    [{ adminReviewPending: true, personLinkRequest: { status: "requested" }, personLinkIssue: { status: "reported" } }, 2],
    [{ adminReviewPending: false, personLinkStatus: "rejected", personLinkIssue: { status: "resolved" } }, 0]]) {
    assert.equal(notifications.state(data).count, count);
    assert.equal(notifications.state(data).descriptions.length, count);
  }
});

test("the app aggregate filters count the same notifications as the person cards without duplicate registrations", () => {
  const matches = (data, filter) => {
    if (filter.compositeFilter) return filter.compositeFilter.filters.some((part) => matches(data, part));
    const { field, value } = filter.fieldFilter;
    const actual = field.fieldPath.split(".").reduce((item, key) => item?.[key], data);
    return actual === (value.booleanValue ?? value.stringValue);
  };
  const filters = notifications.countFilters();
  for (const isNew of [false, true]) for (const hasRequest of [false, true]) for (const hasIssue of [false, true]) {
    const data = { adminReviewPending: isNew, personLinkStatus: hasRequest ? "requested" : "open",
      personLinkRequest: { status: hasRequest ? "requested" : "withdrawn" }, personLinkIssue: { status: hasIssue ? "reported" : "resolved" } };
    assert.equal(filters.filter((filter) => matches(data, filter)).length, notifications.state(data).count);
  }
  assert.equal(filters.length, 2, "no additional query or full-account download is required");
});
