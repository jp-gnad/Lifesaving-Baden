(function (root) {
  "use strict";

  // UI and administration only. Authorization remains enforced by firestore.rules.
  function create(dependencies) {
    const {
      clearUserDocCache, formatBirthDate, formatFullName, formatProfileFieldValue, formatSortableName, getAccountRole, getNameDetailsFromData, getLinkRequestIdentityHint, hasOpenLinkIssue, hasPendingLinkRequest, isCurrentUser, isPersonLinked, normalizeDlrgBranchName, requireCurrentUser, setAdminAccountMessage, setLoading, translateFirestoreError, writeUserDocCache
    } = dependencies;

    function getTimestampMillis(value) {
      if (!value) {
        return 0;
      }

      if (typeof value.toMillis === "function") {
        return value.toMillis();
      }

      if (typeof value.toDate === "function") {
        return value.toDate().getTime();
      }

      if (value instanceof Date) {
        return value.getTime();
      }

      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }

    function getAdminRequestTimestamp(data) {
      return getTimestampMillis(data?.personLinkRequest?.requestedAt);
    }


    function getShortBirthYear(value) {
      if (!value) {
        return "--";
      }

      if (typeof value.toDate === "function") {
        return String(value.toDate().getFullYear()).slice(-2);
      }

      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return String(value.getFullYear()).slice(-2);
      }

      const text = String(value).trim();
      const yearMatch = text.match(/^(\d{4})/);

      if (yearMatch) {
        return yearMatch[1].slice(-2);
      }

      const parsed = new Date(text);

      if (!Number.isNaN(parsed.getTime())) {
        return String(parsed.getFullYear()).slice(-2);
      }

      return "--";
    }

    function getAdminAccountBirthYear(data) {
      return getShortBirthYear(data?.birthDate);
    }

    function appendAdminRequestDetail(list, label, value) {
      if (!value) {
        return;
      }

      const term = document.createElement("dt");
      const description = document.createElement("dd");

      term.textContent = label;
      description.textContent = value;
      list.append(term, description);
    }

    function getAdminAccountControls() {
      return {
        panel: document.querySelector("[data-admin-accounts]"),
        list: document.querySelector("[data-admin-account-list]"),
        summary: document.querySelector("[data-admin-account-summary]"),
        refreshButton: document.querySelector("[data-admin-accounts-refresh]")
      };
    }

    function setAdminAccountSummary(text) {
      const { summary } = getAdminAccountControls();

      if (summary) {
        summary.textContent = text;
      }
    }

    function getAdminAccountName(data) {
      return formatSortableName(data) || data?.personLinkRequest?.accountName || data?.email || "Unbenanntes Konto";
    }

    function getAdminAccountBranch(data) {
      return normalizeDlrgBranchName(data?.dlrgBranch);
    }

    function getAdminAccountLinkedId(data) {
      return window.LifesavingPersonLinks.linkedPerson(data)?.id || "";
    }

    function getAdminAccountRoleValue(data) {
      return getAccountRole(data, {}).value;
    }

    function getAdminAccountRoleLabel(value) {
      return getAccountRole({ role: value }, {}).label;
    }

    function hasAdminLinkAttention(data) {
      return hasPendingLinkRequest(data) || hasOpenLinkIssue(data);
    }

    async function countAdminNotifications(user) {
      const token = await user.getIdToken();
      const field = (fieldPath, value) => ({ fieldFilter: { field: { fieldPath }, op: "EQUAL", value: { stringValue: value } } });
      const filters = [
        { compositeFilter: { op: "OR", filters: [field("personLinkStatus", "requested"), field("personLinkRequest.status", "requested")] } },
        field("personLinkIssue.status", "reported")
      ];
      // Aggregations return counts without downloading the account documents.
      const counts = await Promise.all(filters.map(async (where) => {
        const response = await fetch(`https://firestore.googleapis.com/v1/projects/${window.firebaseConfig.projectId}/databases/(default)/documents:runAggregationQuery`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ structuredAggregationQuery: {
            structuredQuery: { from: [{ collectionId: "users" }], where },
            aggregations: [{ alias: "total", count: {} }]
          } })
        });
        if (!response.ok) throw new Error("Benachrichtigungen konnten nicht geladen werden.");
        const results = await response.json();
        return Number(results.find((row) => row.result)?.result.aggregateFields.total.integerValue || 0);
      }));
      return counts.reduce((sum, count) => sum + count, 0);
    }

    function initAdminAccountBadge(auth) {
      const badge = document.querySelector("[data-admin-notification-count]");
      if (!badge || badge.dataset.listenerAttached) return;
      badge.dataset.listenerAttached = "true";
      const app = badge.closest("a");
      let loading = false;
      const refresh = async () => {
        const user = auth.currentUser;
        if (loading || !user || document.visibilityState === "hidden") return;
        loading = true;
        try {
          const count = await countAdminNotifications(user);
          if (!isCurrentUser(user)) return;
          badge.textContent = String(count);
          badge.hidden = count === 0;
          app.setAttribute("aria-label", count ? `Kontenübersicht öffnen, ${count} offene Anträge und Meldungen` : "Kontenübersicht öffnen");
          app.removeAttribute("title");
        } catch {
          if (isCurrentUser(user)) app.title = "Benachrichtigungen konnten nicht geladen werden.";
        } finally {
          loading = false;
        }
      };
      refresh();
      window.addEventListener("pageshow", refresh);
      document.addEventListener("visibilitychange", refresh);
    }

    function filterAdminAccounts() {
      const { list } = getAdminAccountControls();
      const input = document.querySelector("[data-admin-account-search]");
      const summary = document.querySelector("[data-admin-account-search-summary]");
      if (!list || !input || !summary) return;
      const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("de");
      const terms = normalize(input.value).trim().split(/\s+/).filter(Boolean);
      const cards = Array.from(list.querySelectorAll("[data-admin-account-card]"));
      let visible = 0;
      cards.forEach((card) => {
        const text = normalize([card.dataset.accountSearch, card.dataset.linkedPersonId, getAdminAccountRoleLabel(card.dataset.accountRoleValue)].join(" "));
        card.hidden = !terms.every((term) => text.includes(term));
        if (!card.hidden) visible++;
      });
      summary.textContent = terms.length ? `${visible} von ${cards.length} Konten gefunden.` : "";
    }

    function getAdminAttentionTimestamp(data) {
      if (hasOpenLinkIssue(data)) {
        return getTimestampMillis(data?.personLinkIssue?.reportedAt);
      }

      return getAdminRequestTimestamp(data);
    }

    function getAdminAccountSortRank(item) {
      return getAdminAccountRoleSortRank(getAdminAccountRoleValue(item?.data), hasAdminLinkAttention(item?.data));
    }

    function getAdminAccountRoleSortRank(roleValue, hasAttention) {
      if (roleValue === "admin") return 0;
      if (hasAttention) return 1;
      return { organizer: 2, trainer: 3, athlete: 4, standard: 5 }[roleValue] ?? 5;
    }

    function updateAdminAccountCardRole(card, roleValue) {
      if (!card) {
        return;
      }

      card.dataset.accountRoleValue = roleValue;
      card.classList.toggle("is-admin-account", roleValue === "admin");
      card.classList.toggle("is-organizer-account", roleValue === "organizer");
      card.classList.toggle("is-athlete-account", roleValue === "athlete");
      card.classList.toggle("is-trainer-account", roleValue === "trainer");
    }

    function getAdminAccountCardSortData(card) {
      return {
        rank: getAdminAccountRoleSortRank(
          card?.dataset.accountRoleValue || "standard",
          card?.dataset.hasAdminAttention === "true"
        ),
        name: card?.dataset.accountName || ""
      };
    }

    function reorderAdminAccountCard(card) {
      const list = card?.parentElement;

      if (!card || !list) {
        return;
      }

      const current = getAdminAccountCardSortData(card);
      const target = Array.from(list.querySelectorAll("[data-admin-account-card]"))
        .find((otherCard) => {
          if (otherCard === card) {
            return false;
          }

          const other = getAdminAccountCardSortData(otherCard);

          if (current.rank !== other.rank) {
            return current.rank < other.rank;
          }

          return current.name.localeCompare(other.name, "de", { sensitivity: "base" }) < 0;
        });

      list.insertBefore(card, target || null);
    }

    function setAdminAccountRoleAppearance(element, value) {
      if (!element) {
        return;
      }

      element.classList.toggle("is-role-admin", value === "admin");
      element.classList.toggle("is-role-organizer", value === "organizer");
      element.classList.toggle("is-role-athlete", value === "athlete");
      element.classList.toggle("is-role-standard", value === "standard");
      element.classList.toggle("is-role-trainer", value === "trainer");
    }

    function createAdminAccountRoleSelect(item) {
      const data = item.data || {};
      const roleValue = getAdminAccountRoleValue(data);
      if (roleValue === "admin") return null;
      const control = document.createElement("select");

      control.className = "admin-role-control";
      setAdminAccountRoleAppearance(control, roleValue);

      control.dataset.adminAccountRole = "";
      control.dataset.previousValue = roleValue;

      [
        { value: "organizer", label: "Organisator" },
        { value: "trainer", label: "Trainer" },
        { value: "athlete", label: "Sportler" },
        { value: "standard", label: "Standard" }
      ].forEach((role) => {
        const option = document.createElement("option");

        option.value = role.value;
        option.textContent = role.label;
        control.append(option);
      });

      control.value = roleValue;
      return control;
    }

    function createAdminAccountRoleDisplay(roleValue) {
      const display = document.createElement("span");

      display.className = "admin-role-display";
      display.dataset.adminAccountRoleDisplay = "";
      display.textContent = getAdminAccountRoleLabel(roleValue);
      setAdminAccountRoleAppearance(display, roleValue);

      return display;
    }

    function formatLinkedPerson(person) {
      return person ? `${person.name} (${String(person.birthYear).slice(-2).padStart(2, "0")}) · ${person.organization || "Keine Gliederung"}` : "Nicht verknüpft";
    }

    function setAdminAccountRoleDisplay(card, roleValue) {
      const display = card?.querySelector("[data-admin-account-role-display]");
      const select = card?.querySelector("[data-admin-account-role]");

      if (display) {
        display.textContent = getAdminAccountRoleLabel(roleValue);
        setAdminAccountRoleAppearance(display, roleValue);
      }

      if (select) {
        select.value = roleValue;
        select.dataset.previousValue = roleValue;
        setAdminAccountRoleAppearance(select, roleValue);
      }
    }

    function setAdminAccountEditMode(card, shouldOpen, { restoreFocus = true } = {}) {
      if (!card) return;
      card.classList.toggle("is-editing", shouldOpen);
      const summary = card.querySelector("[data-admin-account-edit]");
      const editor = card.querySelector("[data-admin-account-editor]");
      summary?.setAttribute("aria-expanded", String(shouldOpen));
      if (editor) editor.hidden = !shouldOpen;
      if (!shouldOpen && restoreFocus) summary?.focus();
    }

    function resetAdminAccountEditValues(card) {
      const select = card?.querySelector("[data-admin-account-role]");
      if (select) select.value = card.dataset.accountRoleValue || "standard";
    }

    let adminAccountLinkOwners = new Map();
    let adminPersonSearch = null;
    let adminPersonSearchSequence = 0;
    let adminPersonSearchTimer;

    function openAdminPersonSearch(auth, card) {
      const dialog = document.querySelector("[data-admin-person-dialog]");
      if (!dialog || !card || !auth.currentUser) return;
      window.clearTimeout(adminPersonSearchTimer);
      adminPersonSearchSequence += 1;
      adminPersonSearch = { user: auth.currentUser, uid: card.dataset.targetUid, selected: null, busy: false };
      dialog.querySelector("[data-admin-person-email]").textContent = card.dataset.accountEmail;
      dialog.querySelector("[data-admin-person-search]").value = "";
      dialog.querySelector("[data-admin-person-note]").textContent = "Mindestens 3 Buchstaben eingeben.";
      dialog.querySelector("[data-admin-person-results]").replaceChildren();
      dialog.querySelector("[data-admin-person-selection]").hidden = true;
      dialog.querySelector("[data-admin-person-confirm]").disabled = true;
      if (!dialog.open) dialog.showModal();
      dialog.querySelector("[data-admin-person-search]").focus();
    }

    function initAdminPersonSearch(auth) {
      const dialog = document.querySelector("[data-admin-person-dialog]");
      if (!dialog || dialog.dataset.listenerAttached) return;
      dialog.dataset.listenerAttached = "true";
      const search = dialog.querySelector("[data-admin-person-search]");
      const note = dialog.querySelector("[data-admin-person-note]");
      const results = dialog.querySelector("[data-admin-person-results]");
      const selection = dialog.querySelector("[data-admin-person-selection]");
      const confirm = dialog.querySelector("[data-admin-person-confirm]");
      const active = (state, sequence) => dialog.open && adminPersonSearch === state
        && isCurrentUser(state?.user) && sequence === adminPersonSearchSequence;
      const close = () => { if (!adminPersonSearch?.busy) dialog.close(); };
      dialog.querySelectorAll("[data-admin-person-close]").forEach((button) => button.addEventListener("click", close));
      dialog.addEventListener("cancel", (event) => { if (adminPersonSearch?.busy) event.preventDefault(); });
      dialog.addEventListener("close", () => {
        window.clearTimeout(adminPersonSearchTimer);
        adminPersonSearchSequence += 1;
        adminPersonSearch = null;
      });
      search.addEventListener("input", () => {
        window.clearTimeout(adminPersonSearchTimer);
        const state = adminPersonSearch;
        if (!state || state.busy) return;
        const sequence = ++adminPersonSearchSequence;
        state.selected = null;
        selection.hidden = true;
        confirm.disabled = true;
        results.replaceChildren();
        const prefix = search.value.normalize("NFKD").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "");
        note.textContent = prefix.length < 3 ? "Mindestens 3 Buchstaben eingeben." : "Suche …";
        if (prefix.length < 3) return;
        adminPersonSearchTimer = window.setTimeout(async () => {
          try {
            const matches = await window.firebase.firestore().collection("timerParticipantDirectory").orderBy("searchName")
              .startAt(prefix).endAt(`${prefix}\uf8ff`).limit(10).get({ source: "server" });
            if (!active(state, sequence)) return;
            const people = matches.docs.map((doc) => window.LifesavingPersonLinks.linkedPerson({ personLink: { ...doc.data(), id: doc.id } })).filter(Boolean);
            note.textContent = people.length ? (matches.size === 10 ? "Bis zu 10 Treffer. Grenze den Namen bei Bedarf weiter ein." : "Person auswählen.") : "Keine Person gefunden.";
            results.replaceChildren(...people.map((person) => {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "admin-person-candidate";
              const owner = adminAccountLinkOwners.get(person.id);
              button.disabled = Boolean(owner && owner.uid !== state.uid);
              button.dataset.occupied = String(button.disabled);
              button.textContent = formatLinkedPerson(person) + (button.disabled ? ` · Bereits verknüpft: ${owner.email}` : "");
              button.addEventListener("click", () => {
                if (!active(state, sequence) || state.busy) return;
                state.selected = person;
                results.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
                selection.textContent = `Ausgewählt: ${formatLinkedPerson(person)}`;
                selection.hidden = false;
                confirm.disabled = false;
              });
              button.setAttribute("aria-pressed", "false");
              return button;
            }));
          } catch (error) {
            if (active(state, sequence)) note.textContent = `Suche fehlgeschlagen. ${translateFirestoreError(error)}`;
          }
        }, 220);
      });
      confirm.addEventListener("click", async () => {
        const state = adminPersonSearch;
        if (!state?.selected || state.busy || !isCurrentUser(state.user)) return;
        state.busy = true;
        dialog.querySelectorAll("button, input").forEach((item) => { item.disabled = true; });
        note.textContent = "Verknüpfung wird gespeichert …";
        let saved = false;
        try {
          await window.LifesavingPersonLinks.commit(window.firebase.firestore(), state.uid, state.selected.id, state.user,
            window.firebase.firestore.FieldValue, () => requireCurrentUser(state.user));
          requireCurrentUser(state.user);
          if (state.uid === state.user.uid) clearUserDocCache(state.uid);
          saved = true;
        } catch (error) { note.textContent = translateFirestoreError(error); }
        finally {
          state.busy = false;
          dialog.querySelectorAll("button, input").forEach((item) => { item.disabled = false; });
          results.querySelectorAll("button").forEach((item) => {
            item.disabled = item.dataset.occupied === "true";
          });
        }
        if (saved) {
          dialog.close();
          await loadAdminAccounts(auth);
          setAdminAccountMessage("Konto mit der ausgewählten Datenbankperson verknüpft.", true);
        }
      });
    }

    async function unlinkAdminPerson(auth, button) {
      const user = auth.currentUser;
      const card = button.closest("[data-admin-account-card]");
      if (!user || !card || !window.confirm(`Verknüpfung für ${card.dataset.accountEmail} aufheben?`)) return;
      try {
        button.disabled = true;
        await window.LifesavingPersonLinks.commit(window.firebase.firestore(), card.dataset.targetUid, null, user,
          window.firebase.firestore.FieldValue, () => requireCurrentUser(user));
        requireCurrentUser(user);
        if (card.dataset.targetUid === user.uid) clearUserDocCache(user.uid);
        await loadAdminAccounts(auth);
        setAdminAccountMessage("Verknüpfung aufgehoben.", true);
      } catch (error) { setAdminAccountMessage(translateFirestoreError(error), false); }
      finally { button.disabled = false; }
    }

    function createAdminAccountCard(item) {
      const data = item.data || {};
      const request = data.personLinkRequest || {};
      const issue = data.personLinkIssue || {};
      const linkedPerson = window.LifesavingPersonLinks.linkedPerson(data);
      const roleValue = getAdminAccountRoleValue(data);
      const hasOpenRequest = hasPendingLinkRequest(data);
      const hasOpenIssue = hasOpenLinkIssue(data);
      const hasAttention = hasOpenRequest || hasOpenIssue;
      const profile = getNameDetailsFromData(data);
      const profileName = profile.displayName || formatFullName(profile.firstName, profile.lastName) || "Kein Name hinterlegt";
      const accountEmail = data.googleEmail || data.email || "Keine E-Mail gespeichert";
      const accountBranch = getAdminAccountBranch(data) || "Keine Gliederung hinterlegt";
      const editorId = `admin-account-editor-${item.uid.replace(/[^a-z0-9_-]/gi, "")}`;
      const element = (tag, className, text) => {
        const result = document.createElement(tag);
        result.className = className;
        if (text !== undefined) result.textContent = text;
        return result;
      };
      const action = (label, name) => {
        const button = element("button", "admin-account-small-button", label);
        button.type = "button";
        button.dataset[name] = "";
        return button;
      };
      const iconAction = (label, name, path) => {
        const button = action(label, name);
        button.className = "admin-account-icon-button";
        button.setAttribute("aria-label", label);
        button.title = label;
        button.textContent = "";
        button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
        return button;
      };
      const card = element("article", "admin-account-card");
      card.dataset.adminAccountCard = "";
      card.dataset.targetUid = item.uid;
      card.dataset.hasPendingRequest = String(hasOpenRequest);
      card.dataset.hasLinkIssue = String(hasOpenIssue);
      card.dataset.hasAdminAttention = String(hasAttention);
      card.dataset.accountName = getAdminAccountName(data);
      card.dataset.accountEmail = accountEmail;
      card.dataset.accountSearch = [profileName, accountEmail, accountBranch, request.firstName, request.lastName,
        request.accountEmail, issue.accountEmail, linkedPerson?.name, linkedPerson?.birthYear,
        linkedPerson ? String(linkedPerson.birthYear).slice(-2) : "", linkedPerson?.organization].filter(Boolean).join(" ");
      card.dataset.linkedPersonId = getAdminAccountLinkedId(data);
      card.classList.toggle("has-open-request", hasAttention);
      card.classList.toggle("has-link-issue", hasOpenIssue);
      updateAdminAccountCardRole(card, roleValue);

      // One native button makes the complete summary a keyboard-accessible edit target.
      const summary = element("button", "admin-account-summary");
      summary.type = "button";
      summary.dataset.adminAccountEdit = "";
      summary.setAttribute("aria-expanded", "false");
      summary.setAttribute("aria-controls", editorId);
      const account = element("span", "admin-account-source admin-account-profile");
      const profileTitle = element("strong", "admin-account-person-name", `${profileName} (${getAdminAccountBirthYear(data)})`);
      if (hasOpenRequest && !hasOpenIssue) {
        const attention = element("span", "admin-account-alert", "!");
        attention.title = "Antrag offen";
        attention.setAttribute("aria-label", attention.title);
        profileTitle.append(attention);
      }
      account.append(profileTitle,
        element("span", "admin-account-club", accountBranch),
        element("span", "admin-account-email", accountEmail));
      const database = element("span", "admin-account-source admin-account-database");
      if (linkedPerson) {
        database.append(element("strong", "admin-account-person-name", `${linkedPerson.name} (${String(linkedPerson.birthYear).slice(-2)})`),
          element("span", "admin-account-club", linkedPerson.organization || "Keine Gliederung hinterlegt"));
      }
      summary.setAttribute("aria-label", `Konto: ${profileName} (${getAdminAccountBirthYear(data)}), ${accountBranch}, ${accountEmail}. Ergebnisdatenbank: ${formatLinkedPerson(linkedPerson)}. Bearbeiten`);
      summary.append(account, database);

      const editor = element("div", "admin-account-editor");
      editor.dataset.adminAccountEditor = "";
      editor.id = editorId;
      editor.hidden = true;
      const toolbar = element("div", "admin-account-editor-toolbar");
      const roleLabel = element("label", "admin-account-field admin-account-role-field");
      roleLabel.append(element("span", "", "Rolle"));
      const roleSelect = createAdminAccountRoleSelect(item);
      if (roleSelect) {
        roleLabel.append(roleSelect);
        toolbar.append(roleLabel, iconAction("Speichern", "adminAccountSave", "m5 12 4 4L19 6"));
      } else {
        roleLabel.append(createAdminAccountRoleDisplay(roleValue));
        toolbar.append(roleLabel);
      }
      toolbar.append(iconAction(linkedPerson ? "Person ändern" : "Person verknüpfen", "adminAccountLink",
        "M8 5H5v14h14v-3M14 4l6 6M10 14l2-6 5-5 4 4-5 5-6 2Z"));
      if (linkedPerson) {
        const unlink = iconAction("Verknüpfung aufheben", "adminAccountUnlink",
          "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71M3 3l18 18");
        unlink.className += " is-danger";
        toolbar.append(unlink);
      }
      editor.append(toolbar);
      if (hasAttention) {
        const details = element("dl", "admin-request-details");
        if (hasOpenIssue) {
          appendAdminRequestDetail(details, "Fehlermeldung", issue.message || "Die Zuordnung stimmt nicht.");
        } else {
          appendAdminRequestDetail(details, "Beantragte Person", `${request.firstName || ""} ${request.lastName || ""}`.trim());
          appendAdminRequestDetail(details, "Gliederung", request.dlrgBranch || "Nicht angegeben");
          appendAdminRequestDetail(details, "Geburtsdatum", formatBirthDate(request.birthDate));
          appendAdminRequestDetail(details, "Geschlecht", formatProfileFieldValue("gender", request.gender));
          appendAdminRequestDetail(details, "Identitätsinfo", getLinkRequestIdentityHint(request, data) || "Nicht angegeben");
        }
        editor.append(details);
        const decisions = element("div", "admin-account-link-actions");
        if (hasOpenIssue) {
          const resolve = iconAction("Erledigt", "adminAccountIssueAction", "m5 12 4 4L19 6");
          resolve.dataset.adminAccountIssueAction = "resolve";
          decisions.append(resolve);
        } else {
          const reject = action("Antrag ablehnen", "adminAccountRequestAction");
          reject.dataset.adminAccountRequestAction = "reject";
          reject.className += " is-danger";
          decisions.append(reject);
        }
        editor.append(decisions);
      }
      card.append(summary, editor);
      if (hasOpenIssue) {
        const notification = element("span", "admin-account-notification", "1");
        notification.title = "Fehler gemeldet";
        notification.setAttribute("role", "status");
        notification.setAttribute("aria-label", "1 gemeldeter Verknüpfungsfehler");
        card.append(notification);
      }
      return card;
    }

    function renderAdminAccounts(accounts) {
      const { list } = getAdminAccountControls();

      if (!list) {
        return;
      }

      list.replaceChildren();

      if (!accounts.length) {
        const emptyState = document.createElement("p");

        emptyState.className = "admin-request-empty";
        emptyState.textContent = "Keine Konten gefunden.";
        list.append(emptyState);
        setAdminAccountSummary("Keine Konten gefunden.");
        filterAdminAccounts();
        return;
      }

      accounts.forEach((account) => {
        list.append(createAdminAccountCard(account));
      });
      filterAdminAccounts();

      const pendingCount = accounts.filter((account) => hasPendingLinkRequest(account.data)).length;
      const issueCount = accounts.filter((account) => hasOpenLinkIssue(account.data)).length;
      const attentionParts = [];

      if (pendingCount) {
        attentionParts.push(pendingCount === 1 ? "1 offener Antrag" : `${pendingCount} offene Anträge`);
      }

      if (issueCount) {
        attentionParts.push(issueCount === 1 ? "1 gemeldeter Fehler" : `${issueCount} gemeldete Fehler`);
      }

      setAdminAccountSummary(
        attentionParts.length
          ? `${accounts.length} Konten gefunden, ${attentionParts.join(", ")}.`
          : `${accounts.length} Konten gefunden.`
      );
    }

    async function loadAdminAccounts(auth) {
      const { list, refreshButton } = getAdminAccountControls();
      const user = auth.currentUser;

      if (!list || !user || !window.firebase.firestore) {
        return;
      }

      try {
        setLoading(refreshButton, true, "Lade...");
        setAdminAccountSummary("Firebase-Konten werden geladen.");
        setAdminAccountMessage("", true);

        const snapshot = await window.firebase.firestore()
          .collection("users")
          .get({ source: "server" });
        const accounts = snapshot.docs
          .map((doc) => ({ uid: doc.id, data: doc.data() || {} }))
          .sort((first, second) => {
            const rankDifference = getAdminAccountSortRank(first) - getAdminAccountSortRank(second);

            if (rankDifference !== 0) {
              return rankDifference;
            }

            if (hasAdminLinkAttention(first.data) && hasAdminLinkAttention(second.data)) {
              const timeDifference = getAdminAttentionTimestamp(second.data) - getAdminAttentionTimestamp(first.data);

              if (timeDifference !== 0) {
                return timeDifference;
              }
            }

            return getAdminAccountName(first.data).localeCompare(
              getAdminAccountName(second.data),
              "de",
              { sensitivity: "base" }
            );
          });

        requireCurrentUser(user);
        adminAccountLinkOwners = new Map(accounts.filter((item) => isPersonLinked(item.data)).map((item) => [getAdminAccountLinkedId(item.data), { uid: item.uid, email: item.data.googleEmail || item.data.email || "Anderes Konto" }]));
        renderAdminAccounts(accounts);
      } catch (error) {
        setAdminAccountSummary("Konten konnten nicht geladen werden.");
        setAdminAccountMessage(translateFirestoreError(error), false);
      } finally {
        setLoading(refreshButton, false);
      }
    }

    async function saveAdminAccountChanges(auth, button) {
      const card = button.closest("[data-admin-account-card]");
      const user = auth.currentUser;
      const select = card?.querySelector("[data-admin-account-role]");
      const previousRole = card?.dataset.accountRoleValue;
      if (!user || !select || previousRole === "admin") return;
      if (!["standard", "athlete", "trainer", "organizer"].includes(select.value)) return;
      if (select.value === previousRole) { setAdminAccountEditMode(card, false); return; }
      try {
        button.disabled = true;
        requireCurrentUser(user);
        const nextRole = select.value;
        const fieldValue = window.firebase.firestore.FieldValue;
        const db = window.firebase.firestore();
        const uid = card.dataset.targetUid;
        if (!["trainer", "organizer", "admin"].includes(nextRole)) {
          await window.ClubsStore.prepareAccountChange(db, uid, window.firebase.firestore, () => requireCurrentUser(user));
        }
        await db.runTransaction(async (transaction) => {
          const ref = db.collection("users").doc(uid);
          const account = await transaction.get(ref);
          requireCurrentUser(user);
          if (!account.exists) throw Object.assign(new Error("Konto fehlt."), { code: "person-link/account-missing" });
          transaction.update(ref, {
            role: nextRole, kader: fieldValue.delete(), isKaderAthlete: fieldValue.delete(), updatedAt: fieldValue.serverTimestamp(),
          });
          const data = { ...account.data(), role: nextRole, kader: false, isKaderAthlete: false };
          window.LifesavingPersonLinks.syncClubProfile(transaction, db, uid, data);
        });
        requireCurrentUser(user);
        setAdminAccountRoleDisplay(card, nextRole);
        updateAdminAccountCardRole(card, nextRole);
        reorderAdminAccountCard(card);
        setAdminAccountEditMode(card, false);
        filterAdminAccounts();
        if (card.dataset.targetUid === user.uid) clearUserDocCache(user.uid);
        setAdminAccountMessage("Rolle gespeichert.", true);
      } catch (error) {
        resetAdminAccountEditValues(card);
        setAdminAccountMessage(translateFirestoreError(error), false);
      } finally { button.disabled = false; }
    }

    async function decideAdminAccountRequest(auth, button) {
      const card = button.closest("[data-admin-account-card]");
      if (button.dataset.adminAccountRequestAction === "approve") {
        openAdminPersonSearch(auth, card);
        return;
      }
      const user = auth.currentUser;
      if (!user || !card) return;
      try {
        button.disabled = true;
        const fieldValue = window.firebase.firestore.FieldValue;
        const ref = window.firebase.firestore().collection("users").doc(card.dataset.targetUid);
        await window.firebase.firestore().runTransaction(async (transaction) => {
          const snapshot = await transaction.get(ref);
          requireCurrentUser(user);
          if (!snapshot.exists || isPersonLinked(snapshot.data()) || !hasPendingLinkRequest(snapshot.data())) {
            throw Object.assign(new Error("Request changed"), { code: "person-link/already-decided" });
          }
          transaction.update(ref, {
            personLinkStatus: "rejected", personLinkRequest: fieldValue.delete(), personLinkIdentityHint: fieldValue.delete(),
            personLinkDecision: { status: "rejected", decidedByUid: user.uid, decidedByEmail: user.email || "", decidedAt: fieldValue.serverTimestamp() },
            updatedAt: fieldValue.serverTimestamp(),
          });
        });
        requireCurrentUser(user);
        await loadAdminAccounts(auth);
        setAdminAccountMessage("Antrag abgelehnt.", true);
      } catch (error) { setAdminAccountMessage(translateFirestoreError(error), false); }
      finally { button.disabled = false; }
    }

    async function decideAdminAccountIssue(auth, button) {
      const user = auth.currentUser;
      const card = button.closest("[data-admin-account-card]");
      const targetUid = card?.dataset.targetUid;
      if (button.dataset.adminAccountIssueAction !== "resolve") return;
      const status = "resolved";

      if (!user || !targetUid || !window.firebase.firestore) {
        setAdminAccountMessage("Aktion nicht möglich. Bitte lade die Seite neu.", false);
        return;
      }

      const fieldValue = window.firebase.firestore.FieldValue;

      try {
        card.querySelectorAll("button, input, select").forEach((control) => {
          control.disabled = true;
        });
        setAdminAccountMessage(
          "Fehlermeldung wird erledigt...",
          true
        );

        await window.firebase.firestore().collection("users").doc(targetUid).update({
          "personLinkIssue.status": status,
          "personLinkIssue.decidedByUid": user.uid,
          "personLinkIssue.decidedByEmail": user.email || "",
          "personLinkIssue.decidedAt": fieldValue.serverTimestamp(),
          "personLinkIssue.updatedAt": fieldValue.serverTimestamp(),
          updatedAt: fieldValue.serverTimestamp()
        });

        if (targetUid === user.uid) {
          clearUserDocCache(user.uid);
        }

        await loadAdminAccounts(auth);
        setAdminAccountMessage(
          "Fehlermeldung erledigt.",
          true
        );
      } catch (error) {
        card.querySelectorAll("button, input, select").forEach((control) => {
          control.disabled = false;
        });
        setAdminAccountMessage(translateFirestoreError(error), false);
      }
    }

    async function initAdminAccounts(auth, role) {
      const { panel, list, refreshButton } = getAdminAccountControls();

      if (!panel || !list || !role?.isAdmin) {
        return;
      }

      initAdminPersonSearch(auth);
      if (!list.dataset.listenerAttached) {
        list.dataset.listenerAttached = "true";
        document.querySelector("[data-admin-account-search]")?.addEventListener("input", filterAdminAccounts);
        list.addEventListener("click", (event) => {
          const linkButton = event.target.closest("[data-admin-account-link]");
          const unlinkButton = event.target.closest("[data-admin-account-unlink]");
          if (linkButton) { openAdminPersonSearch(auth, linkButton.closest("[data-admin-account-card]")); return; }
          if (unlinkButton) { unlinkAdminPerson(auth, unlinkButton); return; }
          const actionButton = event.target.closest("[data-admin-account-request-action]");
          const issueActionButton = event.target.closest("[data-admin-account-issue-action]");
          const editAccountButton = event.target.closest("[data-admin-account-edit]");
          const saveAccountButton = event.target.closest("[data-admin-account-save]");

          if (editAccountButton) {
            const card = editAccountButton.closest("[data-admin-account-card]");

            list.querySelectorAll("[data-admin-account-card].is-editing").forEach((openCard) => {
              if (openCard !== card) {
                resetAdminAccountEditValues(openCard);
                setAdminAccountEditMode(openCard, false, { restoreFocus: false });
              }
            });
            const shouldOpen = editAccountButton.getAttribute("aria-expanded") !== "true";
            resetAdminAccountEditValues(card);
            setAdminAccountEditMode(card, shouldOpen);
            return;
          }

          if (saveAccountButton) {
            saveAdminAccountChanges(auth, saveAccountButton);
            return;
          }

          if (actionButton) {
            decideAdminAccountRequest(auth, actionButton);
            return;
          }

          if (issueActionButton) {
            decideAdminAccountIssue(auth, issueActionButton);
          }
        });

      }

      if (refreshButton && !refreshButton.dataset.listenerAttached) {
        refreshButton.dataset.listenerAttached = "true";
        refreshButton.addEventListener("click", () => loadAdminAccounts(auth));
      }

      await loadAdminAccounts(auth);
    }

    return Object.freeze({
      initAdminAccounts, initAdminAccountBadge, updateAdminAccountCardRole, setAdminAccountRoleAppearance, formatLinkedPerson, createAdminAccountCard, createAdminAccountRoleSelect, setAdminAccountEditMode, saveAdminAccountChanges, decideAdminAccountRequest, countAdminNotifications, filterAdminAccounts
    });
  }

  root.LifesavingAdminAccounts = Object.freeze({ create });
})(window);
