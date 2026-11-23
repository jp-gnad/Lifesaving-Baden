(function (root) {
  "use strict";

  function create({ byId, node, icon, isCurrent, errorText }) {
    const core = root.ClubsCore;
    const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
    const collator = new Intl.Collator("de", { sensitivity: "base" });
    const list = byId("se-list");
    const dialog = byId("club-finance-dialog");
    const form = byId("club-finance-form");
    const amount = byId("club-finance-amount");
    const error = byId("club-finance-error");
    const format = (cents) => money.format(cents / 100);
    let context = null;
    let draft = null;
    const current = (value) => value && context === value && isCurrent(value.owner, value.view);

    function stop() {
      if (!context) return;
      context.unsubscribe?.();
      context = null;
      draft = null;
      dialog.close();
    }

    function setBusy(busy) {
      for (const control of form.elements) control.disabled = busy;
      form.setAttribute("aria-busy", String(busy));
    }

    function open(value, person, saved) {
      if (!current(value) || person.pending) return;
      draft = { value, person, saved, busy: false };
      byId("club-finance-title").textContent = core.displayName(person);
      byId("club-finance-year").textContent = `Teilnehmerbeitrag ${value.year}`;
      amount.value = saved === null ? "" : (saved / 100).toFixed(2).replace(".", ",");
      error.hidden = true;
      setBusy(false);
      dialog.showModal();
    }

    function draw(value) {
      if (!current(value)) return;
      const focused = list.contains(document.activeElement) ? document.activeElement.id : "";
      list.setAttribute("aria-busy", String(!value.loaded && !value.failed));
      list.replaceChildren();
      if (value.failed || !value.loaded) {
        list.append(node("p", "wt-empty", value.failed ? "Beiträge konnten nicht geladen werden." : "Beiträge werden geladen …"));
        return;
      }
      const activePeople = value.people.filter((person) => person.activeYears.includes(value.year))
        .sort((a, b) => collator.compare(a.name, b.name));
      const entries = new Map();
      let total = 0;
      for (const person of activePeople) {
        const member = value.owner.roster.get(person.id) || person;
        const key = core.contributionKey(member, value.contributions);
        if (entries.has(key)) continue;
        const cents = Object.hasOwn(value.contributions, key) ? value.contributions[key] : null;
        entries.set(key, { person, cents });
        total += cents ?? 0;
      }
      const summary = node("div", "club-finance-summary");
      summary.append(node("h2", "wt-day-heading", `Gesamtsumme ${value.year}`),
        node("strong", "club-finance-value", format(total)));
      list.append(summary);
      if (!entries.size) {
        list.append(node("p", "wt-empty", `Keine aktiven Personen für ${value.year}.`));
        return;
      }
      const rows = node("div", "wt-day-card");
      for (const { person, cents } of entries.values()) {
        const row = node("button", "se-person club-person club-person-roster");
        row.type = "button";
        row.id = `club-finance-person-${person.id}`;
        row.disabled = Boolean(person.pending);
        row.classList.toggle("is-local", core.isLocalPerson(person));
        const details = node("span", "se-person-details");
        details.append(node("strong", "se-person-name", core.displayName(person)));
        if (core.isLocalPerson(person)) details.append(node("span", "wt-sr-only", "Lokal erstellt"));
        row.append(details, cents === null ? node("span", "se-meta", "Betrag eingeben")
          : node("span", "club-finance-value", format(cents)), icon("next"));
        row.addEventListener("click", () => open(value, person, cents));
        rows.append(row);
      }
      list.append(rows);
      if (focused) byId(focused)?.focus({ preventScroll: true });
    }

    function render(owner, year, people) {
      if (context?.owner === owner && context.view === owner.view && context.year === year) {
        context.people = people;
        draw(context);
        return;
      }
      stop();
      const value = context = { owner, view: owner.view, year, people, loaded: false, contributions: {} };
      draw(value);
      value.unsubscribe = owner.db.collection("clubs").doc(owner.clubId).collection("finance").doc(String(year))
        .onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
          if (!current(value) || snapshot.metadata.fromCache) return;
          value.contributions = snapshot.data()?.contributions || {};
          value.loaded = true;
          draw(value);
        }, () => {
          if (!current(value)) return;
          value.failed = true;
          value.contributions = {};
          draft = null;
          dialog.close();
          draw(value);
        });
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const editing = draft;
      if (!editing || editing.busy || !current(editing.value)) return;
      let cents;
      try { cents = core.parseContribution(amount.value); }
      catch (failure) {
        error.textContent = failure.message;
        error.hidden = false;
        amount.focus();
        return;
      }
      const { owner, year } = editing.value;
      editing.busy = true;
      error.hidden = true;
      setBusy(true);
      try {
        await root.ClubsStore.saveContribution(owner.db, owner.clubId, year, editing.person, cents, editing.saved, owner.sdk, () => {
          if (!current(editing.value)) throw new Error("Die Ansicht hat sich geändert.");
        });
        if (draft === editing) dialog.close();
      } catch (failure) {
        if (draft === editing) {
          error.textContent = errorText(failure);
          error.hidden = false;
        }
      } finally {
        if (draft === editing) {
          editing.busy = false;
          setBusy(false);
        }
      }
    });
    byId("club-finance-close").addEventListener("click", () => { if (!draft?.busy) dialog.close(); });
    dialog.addEventListener("cancel", (event) => { if (draft?.busy) event.preventDefault(); });
    dialog.addEventListener("close", () => {
      if (dialog.open) return;
      const id = draft?.person.id;
      draft = null;
      if (id && current(context)) byId(`club-finance-person-${id}`)?.focus({ preventScroll: true });
    });
    return Object.freeze({ render, stop });
  }

  root.ClubFinance = Object.freeze({ create });
})(window);
