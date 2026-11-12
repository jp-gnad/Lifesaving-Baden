(function () {
  const page = document.body.dataset.page;
  const trainerApp = {
    worktime: "LifesavingWorktime",
    clubs: "LifesavingClubs",
    gliederungen: "LifesavingClubsAdmin",
  }[page];
  const {
    initFirebase, ensureLocalAuthPersistence, reloadUser, isCurrentUser, requireCurrentUser, hasVerifiedAccess, withRetry, loadUserContext, initPasswordVisibilityToggles,
    normalizeNamePart, formatFullName, normalizeNameDetails, getNameDetailsFromData,
    getDefaultAccountRole, getAccountRole, isAdminAccount,
    getLoginRedirectUrl, getVerificationRedirectUrl, redirectToApp, redirectToLogin, requiresAccountSetup, redirectToAccountSetup, setLoading, translateAuthError,
  } = window.LifesavingAuth;
  const clubNotifications = window.LifesavingClubNotifications?.create({ isCurrentUser });
  const {
    initAdminAccounts, initAdminAccountBadge, updateAdminAccountCardRole, setAdminAccountRoleAppearance, formatLinkedPerson, createAdminAccountCard, createAdminAccountRoleSelect, setAdminAccountEditMode, saveAdminAccountChanges, decideAdminAccountRequest, countAdminNotifications, filterAdminAccounts
  } = window.LifesavingAdminAccounts.create({
    clearUserDocCache, formatBirthDate, formatFullName, formatProfileFieldValue, formatSortableName, getAccountRole, getNameDetailsFromData, getLinkRequestIdentityHint, hasOpenLinkIssue, hasPendingLinkRequest, isCurrentUser, isPersonLinked, normalizeDlrgBranchName, requireCurrentUser, setAdminAccountMessage, setLoading, translateFirestoreError, writeUserDocCache
  });
  function translateFirestoreError(error) {
    const messages = {
      "permission-denied": "Firestore-Regeln erlauben diese Aktion noch nicht.",
      "unavailable": "Firestore ist gerade nicht erreichbar.",
      "unauthenticated": "Bitte logge dich erneut ein.",
      "person-link/already-linked": "Diese Person ist bereits mit einem anderen Konto verknüpft.",
      "person-link/person-missing": "Diese Person ist nicht mehr in der Personenliste vorhanden.",
      "person-link/account-missing": "Dieses Konto ist nicht mehr vorhanden.",
      "person-link/already-decided": "Die Zuordnung wurde inzwischen geändert. Bitte aktualisiere die Kontenübersicht.",
      "person-link/invalid-person": "Die Personendaten sind unvollständig.",
      "app/admin-account-protected": "Admin-Konten können nicht über die Web-App gelöscht werden.",
      "clubs/last-manager": "Das Konto ist letzter Verantwortlicher einer Gliederung. Zuerst Ersatz zuordnen oder die Gliederung löschen."
    };

    return messages[error.code] || "Die Einstellung konnte nicht gespeichert werden.";
  }

  function translateProfileSaveError(error) {
    return String(error?.code || "").startsWith("auth/")
      ? translateAuthError(error)
      : translateFirestoreError(error);
  }

  function setSettingsMessage(text, isSuccess) {
    const message = document.querySelector("[data-settings-message]");

    if (!message) {
      return;
    }

    message.textContent = text;
    message.classList.toggle("success", Boolean(isSuccess));
  }

  function setDeleteMessage(text, isSuccess) {
    const message = document.querySelector("[data-delete-message]");

    if (!message) {
      return;
    }

    message.textContent = text;
    message.classList.toggle("success", Boolean(isSuccess));
  }

  function setLinkRequestMessage(text, isSuccess) {
    const message = document.querySelector("[data-link-request-message]");

    if (!message) {
      return;
    }

    message.textContent = isSuccess ? "" : text;
    message.hidden = Boolean(isSuccess || !text);
    message.classList.remove("success");
  }

  function setLinkManagementMessage(text, isSuccess) {
    const message = document.querySelector("[data-link-management-message]");

    if (!message) {
      return;
    }

    message.textContent = text;
    message.classList.toggle("success", Boolean(isSuccess));
  }

  function setAdminAccountMessage(text, isSuccess) {
    const message = document.querySelector("[data-admin-account-message]");

    if (!message) {
      return;
    }

    message.textContent = text;
    message.classList.toggle("success", Boolean(isSuccess));
  }

  function setProfileMessage(text, isSuccess) {
    const message = document.querySelector("[data-profile-message]");

    if (!message) {
      return;
    }

    message.textContent = text;
    message.classList.toggle("success", Boolean(isSuccess));
  }

  function setPasswordMessage(text, isSuccess) {
    const message = document.querySelector("[data-password-message]");

    if (!message) {
      return;
    }

    message.textContent = text;
    message.classList.toggle("success", Boolean(isSuccess));
  }

  function setGoogleAccountMessage(text, isSuccess) {
    const message = document.querySelector("[data-google-account-message]");

    if (!message) {
      return;
    }

    message.textContent = text;
    message.classList.toggle("success", Boolean(isSuccess));
  }

  async function loadFreshUserContext(user) {
    const { userData, claims } = await loadUserContext(user);
    const data = await withRetry(() => synchronizeUserDocument(user, userData));
    return { userData: data, claims };
  }

  async function requireDeletableAccount(user) {
    requireCurrentUser(user);
    const { userData, claims } = await loadUserContext(user);
    if (isAdminAccount(userData, claims)) {
      const error = new Error("Admin-Konten können nicht über die Web-App gelöscht werden.");
      error.code = "app/admin-account-protected";
      throw error;
    }
    requireCurrentUser(user);
  }

  const userDocCachePrefix = "lifesaving-baden:user-doc:";
  const userDocCacheTtlMs = 5 * 60 * 1000;
  const pendingUserDocCacheTtlMs = 30 * 1000;
  let activeUserDocCache = null;

  function getUserDocCacheKey(uid) {
    return `${userDocCachePrefix}${uid}`;
  }

  function isFreshUserDocCache(entry) {
    const ttl = hasPendingLinkRequest(entry?.data) ? pendingUserDocCacheTtlMs : userDocCacheTtlMs;

    return Boolean(
      entry
      && entry.uid
      && entry.data
      && Date.now() - Number(entry.cachedAt || 0) < ttl
    );
  }

  function readUserDocCache(uid) {
    if (!uid) {
      return null;
    }

    if (activeUserDocCache?.uid === uid && isFreshUserDocCache(activeUserDocCache)) {
      return activeUserDocCache.data;
    }

    try {
      const raw = window.sessionStorage?.getItem(getUserDocCacheKey(uid));

      if (!raw) {
        return null;
      }

      const entry = JSON.parse(raw);

      if (!isFreshUserDocCache(entry)) {
        window.sessionStorage?.removeItem(getUserDocCacheKey(uid));
        return null;
      }

      activeUserDocCache = entry;
      return entry.data;
    } catch (error) {
      return null;
    }
  }

  function writeUserDocCache(uid, data) {
    if (!uid || !data) {
      return data || null;
    }

    const entry = {
      uid,
      cachedAt: Date.now(),
      data
    };

    activeUserDocCache = entry;

    try {
      window.sessionStorage?.setItem(getUserDocCacheKey(uid), JSON.stringify(entry));
    } catch (error) {
      // sessionStorage can be blocked; the in-memory cache still helps during this page view.
    }

    return data;
  }

  function mergeUserDocCache(uid, patch) {
    if (!uid || !patch) {
      return null;
    }

    return writeUserDocCache(uid, {
      ...(readUserDocCache(uid) || {}),
      ...patch
    });
  }

  function clearUserDocCache(uid) {
    if (!uid || activeUserDocCache?.uid === uid) {
      activeUserDocCache = null;
    }

    if (!uid) {
      return;
    }

    try {
      window.sessionStorage?.removeItem(getUserDocCacheKey(uid));
    } catch (error) {
      // Nothing to do if storage is unavailable.
    }
  }

  function clearAllUserDocCaches() {
    activeUserDocCache = null;

    try {
      const storage = window.sessionStorage;

      if (!storage) {
        return;
      }

      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);

        if (key?.startsWith(userDocCachePrefix)) {
          storage.removeItem(key);
        }
      }
    } catch (error) {
      // Nothing to do if storage is unavailable.
    }
  }

  function getAuthUser(target) {
    return target?.currentUser || target || null;
  }

  async function loadCurrentUserData(target, options = {}) {
    const user = getAuthUser(target);

    if (!user || !window.firebase.firestore) {
      return null;
    }

    if (!options.forceRefresh) {
      const cachedData = readUserDocCache(user.uid);

      if (cachedData) {
        return cachedData;
      }
    }

    const snapshot = await window.firebase.firestore().collection("users").doc(user.uid).get();
    const data = snapshot.exists ? snapshot.data() || {} : null;

    if (data) {
      writeUserDocCache(user.uid, data);
    } else {
      clearUserDocCache(user.uid);
    }

    return data;
  }

  function arraysContainSameValues(first = [], second = []) {
    if (first.length !== second.length) {
      return false;
    }

    return first.every((value) => second.includes(value));
  }

  function formatSortableName(data = {}, user = null) {
    const nameDetails = getNameDetailsFromData(data, user);

    if (nameDetails.firstName && nameDetails.lastName) {
      return `${nameDetails.lastName}, ${nameDetails.firstName}`;
    }

    return nameDetails.displayName || data?.email || user?.email || "";
  }

  function normalizeDlrgBranchName(value) {
    let text = String(value || "").replace(/\s+/g, " ").trim();

    if (!text) {
      return "";
    }

    text = text.replace(/[.,;]+$/g, "").trim();

    let previousText = "";

    while (text && text !== previousText) {
      previousText = text;
      text = text
        .replace(/^(?:dlrg|deutsche\s+lebens[-\s]*rettungs[-\s]*gesellschaft)\b[\s\-:,.]*/i, "")
        .replace(/^(?:ortsgruppe|og|ortsverband|ov|kreisgruppe|kg|bezirk|bez\.?|bz|landesverband|lv)\b[\s\-:,.]*/i, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    return text
      .replace(/(?:\s*,?\s*(?:e\.?\s*v\.?|eingetragener\s+verein))\.?$/i, "")
      .replace(/[.,;]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getUserIdentityData(user, nameDetails) {
    return {
      uid: user.uid,
      email: user.email || "",
      googleEmail: getGoogleEmail(user),
      ...nameDetails,
      emailVerified: Boolean(user.emailVerified),
      providerIds: getProviderIds(user)
    };
  }

  function getChangedIdentityFields(data, identity) {
    const changes = {};

    Object.entries(identity).forEach(([key, value]) => {
      if (key === "googleEmail" && !value && !data?.googleEmail) return;
      if (Array.isArray(value)) {
        if (!arraysContainSameValues(value, Array.isArray(data?.[key]) ? data[key] : [])) {
          changes[key] = value;
        }

        return;
      }

      if (data?.[key] !== value) {
        changes[key] = value;
      }
    });

    return changes;
  }

  initPasswordVisibilityToggles();

  if (page === "landing") {
    const launchClasses = document.documentElement.classList;
    const standaloneLaunch = launchClasses.contains("app-launching");
    const revealLanding = () => launchClasses.remove("app-launching");

    if (!window.isFirebaseConfigured || !window.firebase?.auth) {
      revealLanding();
    } else {
      try {
        initFirebase().onAuthStateChanged(async (user) => {
          const verified = await hasVerifiedAccess(user);
          if (user && !isCurrentUser(user)) return;
          if (verified) {
            redirectToApp({ replace: standaloneLaunch });
          } else if (user) {
            redirectToLogin("needsVerification");
          } else {
            revealLanding();
          }
        }, revealLanding);
      } catch (error) {
        revealLanding();
        console.warn("Firebase-Anmeldung konnte nicht geprüft werden.", error);
      }
    }
  }

  if (["app", "settings", "link-request", "admin-accounts", "worktime", "clubs", "gliederungen", "training"].includes(page)) {
    if (window.location.protocol === "file:" || !window.isFirebaseConfigured || !window.firebase?.auth) {
      redirectToLogin();
      return;
    }

    initAppPage(initFirebase());
  }

  if (page === "settings") {
    initSettingsZoomProtection();
    initSettingsMenu();
  }

  function initSettingsZoomProtection() {
    ["gesturestart", "gesturechange"].forEach((type) => {
      document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
    });
    ["touchstart", "touchmove"].forEach((type) => {
      document.addEventListener(type, (event) => {
        if (event.touches?.length > 1) event.preventDefault();
      }, { passive: false });
    });
    document.addEventListener("wheel", (event) => {
      if (event.ctrlKey) event.preventDefault();
    }, { passive: false });
  }

  function initSettingsMenu() {
    const menuItems = Array.from(document.querySelectorAll(".settings-menu-item"));
    const categories = Array.from(document.querySelectorAll(".settings-category"));
    const mobileBackButtons = document.querySelectorAll("[data-settings-mobile-back]");
    const mobileSettingsQuery = window.matchMedia("(max-width: 860px)");

    if (!menuItems.length || !categories.length) {
      return;
    }

    function isMobileSettingsView() {
      return mobileSettingsQuery.matches;
    }

    function getVisibleItems() {
      return menuItems.filter((item) => !item.classList.contains("is-hidden"));
    }

    function updateResponsiveSettingsView(hasValidHash) {
      const isMobile = isMobileSettingsView();
      const showContent = !isMobile || hasValidHash;

      document.body.classList.toggle("settings-mobile-menu-view", isMobile && !showContent);
      document.body.classList.toggle("settings-mobile-content-view", isMobile && showContent);
    }

    function setActiveItem(hash, options = {}) {
      const visibleItems = getVisibleItems();
      const fallbackItem = visibleItems[0] || menuItems[0];
      const hashTargetItem = visibleItems.find((item) => item.getAttribute("href") === hash);
      const targetItem = hashTargetItem || fallbackItem;
      const activeHash = targetItem?.getAttribute("href") || "";
      const hasValidHash = Boolean(hashTargetItem);

      menuItems.forEach((item) => {
        item.classList.toggle("is-active", item === targetItem);
      });

      categories.forEach((category) => {
        const isActive = `#${category.id}` === activeHash;

        category.classList.toggle("is-hidden", !isActive);
        category.hidden = !isActive;
        category.setAttribute("aria-hidden", String(!isActive));
      });

      updateResponsiveSettingsView(hasValidHash);

      if (!options.keepHash && activeHash && window.location.hash !== activeHash
        && (!isMobileSettingsView() || hasValidHash)) {
        if (options.pushHash) {
          window.history.pushState(null, "", activeHash);
        } else {
          window.history.replaceState(null, "", activeHash);
        }
      }
    }

    function showMobileSettingsMenu() {
      if (!isMobileSettingsView()) {
        return;
      }

      if (window.location.hash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      }

      setActiveItem("", { keepHash: true });
    }

    menuItems.forEach((item) => {
      item.addEventListener("click", (event) => {
        event.preventDefault();
        const targetHash = item.getAttribute("href");

        if (isMobileSettingsView()) {
          setActiveItem(targetHash, { pushHash: true });
          return;
        }

        setActiveItem(targetHash);
      });
    });

    document.querySelectorAll("[data-sign-in-email]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const provider = link.dataset.emailSection;
        const section = provider ? document.querySelector(`[data-${provider}-provider-item]`) : null;
        setActiveItem("#sicherheit", { pushHash: isMobileSettingsView() });
        if (section) {
          section.open = true;
          section.querySelector("summary")?.focus();
        } else {
          document.querySelectorAll(".security-field-item").forEach((item) => { item.open = false; });
          document.querySelector("#settings-security-title")?.focus();
        }
      });
    });

    mobileBackButtons.forEach((button) => {
      button.addEventListener("click", () => showMobileSettingsMenu());
    });

    window.refreshSettingsMenu = (options = {}) => setActiveItem(window.location.hash, options);

    setActiveItem(window.location.hash, { keepHash: true });
    window.addEventListener("hashchange", () => setActiveItem(window.location.hash, { keepHash: true }));
    window.addEventListener("popstate", () => setActiveItem(window.location.hash, { keepHash: true }));

    if (typeof mobileSettingsQuery.addEventListener === "function") {
      mobileSettingsQuery.addEventListener("change", () => setActiveItem(window.location.hash, { keepHash: true }));
    } else if (typeof mobileSettingsQuery.addListener === "function") {
      mobileSettingsQuery.addListener(() => setActiveItem(window.location.hash, { keepHash: true }));
    }
  }

  function initAppPage(auth) {
    const logoutButtons = document.querySelectorAll("[data-logout]");
    const accountOpenButton = document.querySelector("[data-account-open]");
    const accountOverlay = document.querySelector("[data-account-overlay]");
    const accountCloseButton = document.querySelector("[data-account-close]");
    const deleteAccountButton = document.querySelector("[data-delete-account]");
    let settingsLoadedForUser = null;
    let bootstrapPromise = null;
    let bootstrapUid = null;

    accountOpenButton?.addEventListener("click", () => openAccountModal());
    accountCloseButton?.addEventListener("click", () => closeAccountModal());
    accountOverlay?.addEventListener("click", (event) => {
      if (event.target === accountOverlay) {
        closeAccountModal();
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeAccountModal();
      }
    });

    deleteAccountButton?.addEventListener("click", () => deleteCurrentAccount(auth, deleteAccountButton));

    async function initializeSignedInUser(user) {
      if (!user) {
        redirectToLogin();
        return;
      }

      if (bootstrapPromise && bootstrapUid === user.uid) {
        return bootstrapPromise;
      }

      bootstrapUid = user.uid;
      const pending = (async () => {
        await ensureLocalAuthPersistence(auth);
        const activeUser = await reloadUser(user);
        if (!isCurrentUser(activeUser)) return;

        const verified = await hasVerifiedAccess(activeUser);
        if (!isCurrentUser(activeUser)) return;
        if (!verified) {
          redirectToLogin("needsVerification");
          return;
        }

        updateGoogleProviderStatus(activeUser);

        if (settingsLoadedForUser !== activeUser.uid) {
          const { userData, claims } = await loadFreshUserContext(activeUser);
          if (!isCurrentUser(activeUser)) return;
          if (requiresAccountSetup(userData, claims) && page !== "link-request") {
            redirectToAccountSetup();
            return;
          }
          const role = getAccountRole(userData, claims);
          if (page === "training" && !role.isAthlete) {
            redirectToApp();
            return;
          }
          if (["admin-accounts", "gliederungen"].includes(page) && !role.isAdmin) {
            redirectToApp();
            return;
          }
          if (trainerApp && !role.isTrainer) {
            redirectToApp();
            return;
          }
          updateAccountProfile(activeUser);
          fillAccountManagementForms(activeUser);
          updateRoleUi(role);
          const initializers = [initAccountManagement, initUserSettings, initLinkStatus, initLinkManagement, initAdminStatus, initLinkRequest];
          for (const initialize of initializers) {
            if (!isCurrentUser(activeUser)) return;
            await initialize(auth, userData, claims);
          }
          if (!isCurrentUser(activeUser)) return;
          if (trainerApp) window[trainerApp].start(auth, activeUser, role);
          settingsLoadedForUser = activeUser.uid;
        }

        document.body.classList.remove("auth-context-loading");
      })();
      bootstrapPromise = pending;

      try {
        await pending;
      } catch (error) {
        if (!isCurrentUser(user)) return;
        console.warn("Kontodaten konnten nicht geladen werden.", error);
        settingsLoadedForUser = null;
        document.body.classList.remove("auth-context-loading");
        const message = document.querySelector("[data-auth-error]");
        if (message) {
          message.hidden = false;
          message.textContent = `${translateProfileSaveError(error)} Bitte lade die Seite erneut.`;
        }
      } finally {
        if (bootstrapPromise === pending) bootstrapPromise = null;
      }
    }

    auth.onAuthStateChanged((user) => {
      if (trainerApp) {
        window[trainerApp]?.stop();
        settingsLoadedForUser = null;
      }
      initializeSignedInUser(user).catch((error) => {
        console.warn("Firebase-Konto konnte nicht initialisiert werden.", error);
      });
    });

    logoutButtons.forEach((button) => button.addEventListener("click", async () => {
      clearAllUserDocCaches();
      await auth.signOut();
      redirectToLogin();
    }));
  }

  function openAccountModal() {
    const accountOverlay = document.querySelector("[data-account-overlay]");

    if (!accountOverlay) {
      return;
    }

    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);

    document.body.style.setProperty("--scrollbar-compensation", `${scrollbarWidth}px`);
    accountOverlay.classList.remove("is-hidden");
    accountOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeAccountModal() {
    const accountOverlay = document.querySelector("[data-account-overlay]");

    if (!accountOverlay) {
      return;
    }

    accountOverlay.classList.add("is-hidden");
    accountOverlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    document.body.style.removeProperty("--scrollbar-compensation");
  }

  function setTextForAll(selector, text) {
    document.querySelectorAll(selector).forEach((element) => {
      element.textContent = text;
    });
  }

  function getAccountName(user) {
    const cachedData = user?.uid ? readUserDocCache(user.uid) : null;
    return getNameDetailsFromData(cachedData, user).displayName;
  }

  function getInitials(user) {
    const source = getAccountName(user);
    const parts = source.replace(/[^a-z0-9]+/gi, " ").trim().split(/\s+/).filter(Boolean);

    if (!parts.length) {
      return "?";
    }

    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  function updateAvatar(photoSelector, initialsSelector, user) {
    const photos = Array.from(document.querySelectorAll(photoSelector));
    const initialsList = Array.from(document.querySelectorAll(initialsSelector));

    if (!photos.length || !initialsList.length) {
      return;
    }

    photos.forEach((photo, index) => {
      const initials = initialsList[index];

      if (!initials) {
        return;
      }

      if (user.photoURL) {
        photo.src = user.photoURL;
        photo.classList.remove("is-hidden");
        initials.classList.add("is-hidden");
        return;
      }

      photo.removeAttribute("src");
      photo.classList.add("is-hidden");
      initials.textContent = getInitials(user);
      initials.classList.remove("is-hidden");
    });
  }

  function updateAccountProfile(user) {
    const accountName = getAccountName(user);
    const googleEmail = getGoogleEmail(user);
    const passwordEmail = hasProvider(user, "password") ? user.email || "" : "";
    const separateEmails = Boolean(googleEmail && passwordEmail && passwordEmail.toLowerCase() !== googleEmail.toLowerCase());
    const accountEmail = googleEmail || passwordEmail
      || (hasProvider(user, "google.com") ? "" : user.email) || "Keine E-Mail geladen.";

    setTextForAll("[data-account-email]", accountEmail);
    updateSignInEmailRow("google", googleEmail, separateEmails);
    updateSignInEmailRow("password", googleEmail && !separateEmails ? "" : passwordEmail, separateEmails);
    setTextForAll("[data-account-name]", accountName);
    setTextForAll("[data-user-name-separator]", accountName ? "," : "");
    setTextForAll("[data-user-name]", accountName);
    setTextForAll("[data-link-account-email]", user.email || "Keine E-Mail geladen.");
    updateAvatar("[data-account-photo-small]", "[data-account-initials-small]", user);
    updateAvatar("[data-account-photo-large]", "[data-account-initials-large]", user);
  }

  function updateSignInEmailRow(provider, email, separateEmails) {
    const row = document.querySelector(`[data-sign-in-email="${provider}"]`);
    if (!row) return;
    row.hidden = !email;
    row.dataset.emailSection = separateEmails ? provider : "";
    row.querySelector("strong").textContent = separateEmails
      ? (provider === "google" ? "Google-Mail" : "Passwort-Mail")
      : "E-Mail";
    row.querySelector("[data-sign-in-email-value]").textContent = email;
  }

  async function synchronizeUserDocument(user, data) {
    requireCurrentUser(user);
    const db = window.firebase.firestore();
    const fieldValue = window.firebase.firestore.FieldValue;
    const userDoc = db.collection("users").doc(user.uid);

    const nameDetails = getNameDetailsFromData(data, user);

    if (nameDetails.displayName && nameDetails.displayName !== (user.displayName || "")) {
      try {
        await user.updateProfile({ displayName: nameDetails.displayName });
      } catch (error) {
        console.warn("Firebase Auth-Anzeigename konnte nicht aktualisiert werden.", error);
      }
    }

    const identity = getUserIdentityData(user, nameDetails);

    requireCurrentUser(user);
    const updatePayload = getChangedIdentityFields(data, identity);
    const shouldClearPendingEmail = Boolean(
      data?.pendingEmail
      && (!hasProvider(user, "password")
        || !data.pendingEmailFrom
        || String(data.pendingEmailFrom).toLowerCase() !== identity.email.toLowerCase()
        || String(data.pendingEmail).trim().toLowerCase() === identity.email.toLowerCase())
    );

    const shouldDeleteLinkedRequest = isPersonLinked(data)
      && Object.prototype.hasOwnProperty.call(data, "personLinkRequest");

    if (shouldClearPendingEmail) {
      updatePayload.pendingEmail = fieldValue.delete();
      updatePayload.pendingEmailFrom = fieldValue.delete();
    }

    if (shouldDeleteLinkedRequest) {
      updatePayload.personLinkRequest = fieldValue.delete();
    }

    if (Object.keys(updatePayload).length) {
      const payload = {
        ...updatePayload,
        updatedAt: fieldValue.serverTimestamp()
      };
      let pendingEmailReplaced = false;
      let currentData;
      if (shouldClearPendingEmail) {
        await db.runTransaction(async (transaction) => {
          const current = await transaction.get(userDoc);
          requireCurrentUser(user);
          currentData = current.data() || {};
          pendingEmailReplaced = currentData.pendingEmail !== data.pendingEmail
            || currentData.pendingEmailFrom !== data.pendingEmailFrom;
          const latestPayload = { ...payload };
          if (pendingEmailReplaced) {
            delete latestPayload.pendingEmail;
            delete latestPayload.pendingEmailFrom;
          }
          transaction.set(userDoc, latestPayload, { merge: true });
        });
      } else {
        await userDoc.set(payload, { merge: true });
      }

      const cacheData = {
        ...(currentData || data),
        ...getChangedIdentityFields(data, identity)
      };

      if (shouldDeleteLinkedRequest) {
        delete cacheData.personLinkRequest;
      }

      if (shouldClearPendingEmail && !pendingEmailReplaced) {
        delete cacheData.pendingEmail;
        delete cacheData.pendingEmailFrom;
      }

      return writeUserDocCache(user.uid, cacheData);
    }

    return writeUserDocCache(user.uid, data);
  }

  async function initLinkStatus(auth, userData) {
    const user = auth.currentUser;

    if (!user || !window.firebase.firestore) {
      updateLinkStatusUi(null);
      return;
    }

    try {
      const data = userData || await loadCurrentUserData(user);
      updateLinkStatusUi(data);
    } catch (error) {
      updateLinkStatusUi(null);
    }
  }

  function isPersonLinked(data) {
    return Boolean(window.LifesavingPersonLinks.linkedPerson(data));
  }

  function hasPendingLinkRequest(data) {
    const requestStatus = data?.personLinkRequest?.status;

    return Boolean(data?.personLinkStatus === "requested" || requestStatus === "requested");
  }

  function hasOpenLinkIssue(data) {
    return data?.personLinkIssue?.status === "reported";
  }

  function hasRejectedLinkRequest(data) {
    const requestStatus = data?.personLinkRequest?.status;

    return Boolean(data?.personLinkStatus === "rejected" || requestStatus === "rejected");
  }

  function hasChecklistValue(value) {
    return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
  }

  function getAccountChecklistItems(data) {
    const linked = isPersonLinked(data);
    const requestSubmitted = linked || hasPendingLinkRequest(data);
    const dlrgBranchAdded = hasChecklistValue(data?.dlrgBranch);
    const birthDateAdded = hasChecklistValue(data?.birthDate);
    const genderAdded = hasChecklistValue(data?.gender);

    return [
      { key: "linkRequest", complete: requestSubmitted },
      { key: "linked", complete: linked },
      { key: "dlrgBranch", complete: dlrgBranchAdded },
      { key: "birthDate", complete: birthDateAdded },
      { key: "gender", complete: genderAdded }
    ];
  }

  function isAccountChecklistComplete(data) {
    if (!data) {
      return false;
    }

    const items = getAccountChecklistItems(data);

    return items.length > 0 && items.every((item) => item.complete);
  }

  function updateAccountChecklist(data) {
    const hasLoadedData = Boolean(data);
    const items = getAccountChecklistItems(data || {});
    const completed = items.filter((item) => item.complete).length;
    const total = items.length;
    const percentage = total ? Math.round((completed / total) * 100) : 0;
    const isComplete = hasLoadedData && isAccountChecklistComplete(data);

    document.querySelectorAll("[data-account-attention], [data-account-manage-attention]").forEach((element) => {
      const shouldHide = !hasLoadedData || (element.hasAttribute("data-account-attention") ? isPersonLinked(data) : isComplete);

      element.classList.toggle("is-hidden", shouldHide);
      element.hidden = shouldHide;
      element.setAttribute("aria-hidden", "true");
    });

    document.querySelectorAll("[data-account-checklist]").forEach((checklist) => {
      if (!hasLoadedData) {
        checklist.classList.add("is-hidden");
        checklist.hidden = true;
        checklist.setAttribute("aria-hidden", "true");
        return;
      }

      const count = checklist.querySelector("[data-checklist-count]");
      const progress = checklist.querySelector("[data-checklist-progress]");

      if (count) {
        count.textContent = `${percentage}% abgeschlossen`;
      }

      if (progress) {
        progress.style.width = `${percentage}%`;
      }

      const shouldHide = isComplete;
      checklist.classList.toggle("is-hidden", shouldHide);
      checklist.hidden = shouldHide;
      checklist.setAttribute("aria-hidden", String(shouldHide));

      items.forEach((item) => {
        const element = checklist.querySelector(`[data-check-item="${item.key}"]`);

        if (element) {
          element.classList.toggle("is-complete", item.complete);
          element.hidden = item.complete;
          element.setAttribute("aria-hidden", String(item.complete));
        }
      });
    });
  }

  function getLinkStatusCopy(data) {
    if (isPersonLinked(data)) {
      return {
        state: "linked",
        title: "Konto verknüpft",
        text: "Deine Kontokonfiguration ist abgeschlossen.",
        action: ""
      };
    }

    if (hasPendingLinkRequest(data)) {
      return {
        state: "requested",
        title: "Antrag in Prüfung",
        text: "Deine Kontokonfiguration ist fast abgeschlossen.",
        action: "Antrag ansehen"
      };
    }

    if (hasRejectedLinkRequest(data)) {
      return {
        state: "rejected",
        title: "Antrag abgelehnt",
        text: "Prüfe deine Angaben und sende den Antrag erneut.",
        action: "Erneut beantragen"
      };
    }

    return {
      state: "open",
      title: "Kontokonfiguration offen",
      text: "Verknüpfe dein Konto, damit der Mitgliederbereich vollständig nutzbar wird.",
      action: "Jetzt abschließen"
    };
  }

  function updateText(selector, text) {
    document.querySelectorAll(selector).forEach((element) => {
      element.textContent = text;
    });
  }

  function updateLinkStatusUi(data) {
    const copy = getLinkStatusCopy(data);
    const hasLoadedData = Boolean(data);
    const isLinked = copy.state === "linked";

    document.querySelectorAll("[data-link-status-shell]").forEach((element) => {
      const shouldHide = !hasLoadedData || isLinked;
      element.classList.toggle("is-hidden", shouldHide);
      element.hidden = shouldHide;
      element.setAttribute("aria-hidden", String(shouldHide));
    });

    document.querySelectorAll("[data-link-indicator]").forEach((element) => {
      const shouldHide = !hasLoadedData || !isLinked;
      element.classList.toggle("is-hidden", shouldHide);
      element.hidden = shouldHide;
    });

    document.querySelectorAll("[data-account-open]").forEach((element) => {
      element.setAttribute("aria-label", hasLoadedData
        ? `Kontoprofil öffnen – Konto ${isLinked ? "verknüpft" : "nicht verknüpft"}`
        : "Kontoprofil öffnen");
    });

    document.querySelectorAll("[data-link-status-action]").forEach((element) => {
      element.textContent = copy.action;
      element.classList.toggle("is-hidden", !hasLoadedData || isLinked);
    });

    updateText("[data-link-status-title]", copy.title);
    updateText("[data-link-status-text]", copy.text);
    updateAccountChecklist(data);
  }

  async function initAdminStatus(auth, userData, claims = {}) {
    const user = auth.currentUser;

    if (!user) {
      updateRoleUi(getDefaultAccountRole());
      return;
    }

    try {
      const data = userData || await loadCurrentUserData(user) || {};
      const role = getAccountRole(data, claims);

      updateRoleUi(role);
      if (page === "admin-accounts") await initAdminAccounts(auth, role);
      if (page === "app" && role.isAdmin) {
        initAdminAccountBadge(auth);
        clubNotifications?.start(auth);
      }
    } catch (error) {
      updateRoleUi(getDefaultAccountRole());
    }
  }

  function updateRoleUi(role = getDefaultAccountRole()) {
    if (!role.isAdmin) clubNotifications?.stop();
    const visibility = {
      "data-admin-only": role.isAdmin,
      "data-non-admin-only": !role.isAdmin,
      "data-organizer-only": role.isOrganizer,
      "data-trainer-only": role.isTrainer,
      "data-athlete-only": role.isAthlete,
      "data-privileged-menu-divider": role.isOrganizer,
    };
    Object.entries(visibility).forEach(([attribute, visible]) => {
      document.querySelectorAll(`[${attribute}]`).forEach((element) => {
        element.classList.toggle("is-hidden", !visible);
      });
    });
    document.querySelectorAll("[data-account-type-card]").forEach((element) => {
      updateAdminAccountCardRole(element, role.value);
    });
    document.querySelectorAll(".dashboard-header, [data-account-role]").forEach((element) => {
      setAdminAccountRoleAppearance(element, role.value);
    });
    updateText("[data-account-role]", role.label);
    if (typeof window.refreshSettingsMenu === "function") window.refreshSettingsMenu();
  }

  function getLinkRequestIdentityHint(request = {}, data = {}) {
    return String(
      request.identityHint
      || data?.personLinkRequest?.identityHint
      || data?.personLinkIdentityHint
      || ""
    ).trim();
  }

  function hasLegacyLinkRequestFields(request = {}) {
    return [
      "firstCompetition",
      "lastCompetition",
      "decidedByUid",
      "decidedByEmail",
      "decidedAt",
      ...(request.status === "requested" ? [] : ["birthDate", "dlrgBranch"])
    ].some((fieldName) => Object.prototype.hasOwnProperty.call(request, fieldName));
  }

  async function cleanupLegacyLinkRequestFields(user, data = {}) {
    const request = data?.personLinkRequest || null;

    if (!user || !request || !window.firebase.firestore || !hasLegacyLinkRequestFields(request)) {
      return data || {};
    }

    const fieldValue = window.firebase.firestore.FieldValue;
    const cleanupPayload = {
      "personLinkRequest.firstCompetition": fieldValue.delete(),
      "personLinkRequest.lastCompetition": fieldValue.delete(),
      "personLinkRequest.decidedByUid": fieldValue.delete(),
      "personLinkRequest.decidedByEmail": fieldValue.delete(),
      "personLinkRequest.decidedAt": fieldValue.delete(),
      ...(request.status === "requested" ? {} : {
        "personLinkRequest.birthDate": fieldValue.delete(),
        "personLinkRequest.dlrgBranch": fieldValue.delete()
      }),
      updatedAt: fieldValue.serverTimestamp()
    };
    const cleanedRequest = { ...request };

    delete cleanedRequest.firstCompetition;
    delete cleanedRequest.lastCompetition;
    delete cleanedRequest.decidedByUid;
    delete cleanedRequest.decidedByEmail;
    delete cleanedRequest.decidedAt;

    if (request.status !== "requested") {
      delete cleanedRequest.birthDate;
      delete cleanedRequest.dlrgBranch;
    }

    await window.firebase.firestore().collection("users").doc(user.uid).update(cleanupPayload);

    return writeUserDocCache(user.uid, {
      ...data,
      personLinkRequest: cleanedRequest
    });
  }

  function hasInactiveLinkRequestData(data = {}) {
    const requestStatus = data?.personLinkRequest?.status;
    const accountStatus = data?.personLinkStatus;
    const hasActiveRequest = accountStatus === "requested" || requestStatus === "requested";

    return Boolean(
      !hasActiveRequest
      && (data?.personLinkRequest || data?.personLinkIdentityHint)
    );
  }

  async function cleanupInactiveLinkRequestData(user, data = {}) {
    if (!user || !window.firebase.firestore || !hasInactiveLinkRequestData(data)) {
      return data || {};
    }

    const fieldValue = window.firebase.firestore.FieldValue;

    await window.firebase.firestore().collection("users").doc(user.uid).update({
      personLinkRequest: fieldValue.delete(),
      personLinkIdentityHint: fieldValue.delete(),
      updatedAt: fieldValue.serverTimestamp()
    });

    const cleanedData = { ...data };

    delete cleanedData.personLinkRequest;
    delete cleanedData.personLinkIdentityHint;

    return writeUserDocCache(user.uid, cleanedData);
  }

  function hasFreshLogin(user) {
    const lastSignIn = Date.parse(user.metadata?.lastSignInTime || "");

    if (Number.isNaN(lastSignIn)) {
      return true;
    }

    return Date.now() - lastSignIn < 5 * 60 * 1000;
  }

  async function deleteCurrentAccount(auth, deleteButton) {
    const user = auth.currentUser;

    if (!user) {
      setDeleteMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    if (!hasFreshLogin(user)) {
      setDeleteMessage("Bitte melde dich neu an und lösche das Konto direkt danach.", false);
      return;
    }

    const confirmed = window.confirm(
      "Konto wirklich löschen? Dein Konto und deine Einstellungen werden entfernt."
    );

    if (!confirmed) {
      return;
    }

    try {
      await requireDeletableAccount(user);
      setLoading(deleteButton, true, "Löschen...");

      if (window.firebase.firestore) {
        await window.ClubsStore.prepareAccountDeletion(window.firebase.firestore(), user.uid, window.firebase.firestore, () => requireCurrentUser(user));
        await window.LifesavingPersonLinks.deleteAccount(window.firebase.firestore(), user.uid, () => requireCurrentUser(user));
      }

      clearUserDocCache(user.uid);
      await user.delete();
      redirectToLogin();
    } catch (error) {
      setDeleteMessage(translateProfileSaveError(error), false);
    } finally {
      setLoading(deleteButton, false);
    }
  }

  function getProviderIds(user) {
    return (user.providerData || []).map((provider) => provider.providerId);
  }

  function hasProvider(user, providerId) {
    return getProviderIds(user).includes(providerId);
  }

  function getGoogleEmail(user) {
    return user.providerData?.find((provider) => provider.providerId === "google.com")?.email || "";
  }

  const profileFieldConfig = {
    displayName: {
      label: "Name",
      type: "name-parts",
      required: true,
      emptyLabel: "Nicht angegeben"
    },
    dlrgBranch: {
      label: "DLRG-Gliederung",
      type: "text",
      autocomplete: "organization",
      emptyLabel: "Nicht angegeben"
    },
    birthDate: {
      label: "Geburtsdatum",
      type: "date",
      canDelete: true,
      emptyLabel: "Nicht angegeben"
    },
    gender: {
      label: "Geschlecht",
      type: "radio",
      canDelete: true,
      emptyLabel: "Nicht angegeben",
      options: [
        { value: "weiblich", label: "Weiblich" },
        { value: "maennlich", label: "Männlich" },
        { value: "", label: "Keine Angabe" }
      ]
    }
  };

  function getProfileFormValue(form, fieldName) {
    if (fieldName === "displayName") {
      return form?.elements.displayName?.value
        || formatFullName(form?.elements.firstName?.value, form?.elements.lastName?.value);
    }

    return form?.elements[fieldName]?.value || "";
  }

  function formatBirthDate(value) {
    if (!value) {
      return "";
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    });
  }

  function formatProfileFieldValue(fieldName, value) {
    const config = profileFieldConfig[fieldName];
    const trimmedValue = String(value || "").trim();

    if (!trimmedValue) {
      return config?.emptyLabel || "Nicht angegeben";
    }

    if (fieldName === "birthDate") {
      return formatBirthDate(trimmedValue);
    }

    if (fieldName === "gender") {
      return config.options.find((option) => option.value === trimmedValue)?.label || trimmedValue;
    }

    return trimmedValue;
  }

  function updateProfileFieldList(form = document.querySelector("[data-profile-form]")) {
    if (!form) {
      return;
    }

    document.querySelectorAll("[data-profile-value]").forEach((element) => {
      const fieldName = element.dataset.profileValue;
      const value = getProfileFormValue(form, fieldName);

      element.textContent = formatProfileFieldValue(fieldName, value);
    });

    document.querySelectorAll("[data-profile-edit]").forEach((row) => {
      const fieldName = row.dataset.profileEdit;
      const shouldHighlight = form.dataset.profileDetailsLoaded === "true"
        && row.hasAttribute("data-highlight-field-when-empty")
        && !getProfileFormValue(form, fieldName).trim();

      row.classList.toggle("is-empty-highlight", shouldHighlight);
    });
  }

  function closeProfileFieldEditor() {
    const editor = document.querySelector("[data-profile-editor]");

    if (!editor) {
      return;
    }

    delete editor.dataset.activeField;
    editor.classList.add("is-hidden");
    editor.hidden = true;
    editor.setAttribute("aria-hidden", "true");

    document.querySelectorAll("[data-profile-edit]").forEach((row) => {
      row.classList.remove("is-active");
      row.setAttribute("aria-expanded", "false");
    });
  }

  function createProfileFieldControl(fieldName, form) {
    const config = profileFieldConfig[fieldName];
    const value = getProfileFormValue(form, fieldName);

    if (config.type === "name-parts") {
      const group = document.createElement("div");
      const firstNameInput = document.createElement("input");
      const lastNameInput = document.createElement("input");
      const firstNameField = document.createElement("span");
      const lastNameField = document.createElement("span");
      const firstNameLabel = document.createElement("span");
      const lastNameLabel = document.createElement("span");

      group.className = "profile-name-parts";
      group.dataset.profileNameParts = "";
      firstNameField.className = "profile-name-part";
      lastNameField.className = "profile-name-part";
      firstNameLabel.className = "profile-name-part-label";
      lastNameLabel.className = "profile-name-part-label";
      firstNameLabel.textContent = "Vorname";
      lastNameLabel.textContent = "Nachname";

      firstNameInput.name = "firstName";
      firstNameInput.type = "text";
      firstNameInput.value = normalizeNamePart(form?.elements.firstName?.value);
      firstNameInput.placeholder = "Vorname";
      firstNameInput.autocomplete = "given-name";
      firstNameInput.required = true;
      firstNameInput.minLength = 2;
      firstNameInput.setAttribute("aria-label", "Vorname");

      lastNameInput.name = "lastName";
      lastNameInput.type = "text";
      lastNameInput.value = normalizeNamePart(form?.elements.lastName?.value);
      lastNameInput.placeholder = "Nachname";
      lastNameInput.autocomplete = "family-name";
      lastNameInput.required = true;
      lastNameInput.minLength = 2;
      lastNameInput.setAttribute("aria-label", "Nachname");

      firstNameField.append(firstNameLabel, firstNameInput);
      lastNameField.append(lastNameLabel, lastNameInput);
      group.append(firstNameField, lastNameField);
      return group;
    }

    if (config.type === "radio") {
      const list = document.createElement("div");

      list.className = "profile-radio-list";
      list.setAttribute("role", "radiogroup");
      list.setAttribute("aria-label", config.label);
      list.addEventListener("change", () => {
        const editorForm = list.closest("form");

        if (editorForm?.requestSubmit) {
          editorForm.requestSubmit();
          return;
        }

        editorForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });

      config.options.forEach((option) => {
        const optionLabel = document.createElement("label");
        const radio = document.createElement("input");
        const marker = document.createElement("span");
        const text = document.createElement("span");

        optionLabel.className = "profile-radio-option";
        radio.type = "radio";
        radio.name = "profileFieldValue";
        radio.value = option.value;
        radio.checked = option.value === value;
        marker.className = "profile-radio-marker";
        marker.setAttribute("aria-hidden", "true");
        text.textContent = option.label;
        optionLabel.append(radio, marker, text);
        list.append(optionLabel);
      });

      return list;
    }

    if (config.type === "select") {
      const select = document.createElement("select");
      select.name = "profileFieldValue";

      config.options.forEach((option) => {
        const optionElement = document.createElement("option");
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        select.appendChild(optionElement);
      });

      select.value = value;
      return select;
    }

    const input = document.createElement("input");
    input.name = "profileFieldValue";
    input.type = config.type;
    input.value = value;

    if (config.autocomplete) {
      input.autocomplete = config.autocomplete;
    }

    if (config.required) {
      input.required = true;
    }

    if (fieldName === "displayName") {
      input.minLength = 2;
    }

    return input;
  }

  function getProfileEditorValue(control, config) {
    if (config.type === "radio") {
      return document.querySelector('[name="profileFieldValue"]:checked')?.value || "";
    }

    return config.type === "text" || config.type === "email"
      ? control.value.trim()
      : control.value;
  }

  function openProfileFieldEditor(fieldName, form) {
    const config = profileFieldConfig[fieldName];
    const editor = document.querySelector("[data-profile-editor]");
    const editorLabel = document.querySelector("[data-profile-editor-label]");
    const editorControl = document.querySelector("[data-profile-editor-control]");
    const editorHelp = document.querySelector("[data-profile-editor-help]");
    const deleteButton = document.querySelector("[data-profile-edit-delete]");
    const activeRow = document.querySelector(`[data-profile-edit="${fieldName}"]`);

    if (!config || !editor || !editorLabel || !editorControl || !deleteButton || !activeRow) {
      return;
    }

    activeRow.insertAdjacentElement("afterend", editor);
    editor.dataset.activeField = fieldName;
    editor.classList.toggle("is-choice-editor", config.type === "radio");
    editor.classList.toggle("is-name-editor", config.type === "name-parts");
    editorLabel.textContent = config.label;
    if (editorHelp) {
      editorHelp.textContent = config.help || "";
      editorHelp.classList.toggle("is-hidden", !config.help);
    }
    editorControl.replaceChildren(createProfileFieldControl(fieldName, form));
    deleteButton.hidden = !config.canDelete;
    deleteButton.disabled = !config.canDelete;

    editor.classList.remove("is-hidden");
    editor.hidden = false;
    editor.setAttribute("aria-hidden", "false");

    document.querySelectorAll("[data-profile-edit]").forEach((row) => {
      const isActive = row.dataset.profileEdit === fieldName;

      row.classList.toggle("is-active", isActive);
      row.setAttribute("aria-expanded", String(isActive));
    });

    editorControl.querySelector("input, select")?.focus();
  }

  function initProfileFieldEditor(profileForm, auth) {
    const editorForm = document.querySelector("[data-profile-field-form]");
    const cancelButton = document.querySelector("[data-profile-edit-cancel]");
    const deleteButton = document.querySelector("[data-profile-edit-delete]");

    if (!profileForm || !editorForm || profileForm.dataset.fieldEditorAttached) {
      return;
    }

    profileForm.dataset.fieldEditorAttached = "true";

    document.querySelectorAll("[data-profile-edit]").forEach((row) => {
      row.addEventListener("click", () => {
        const editor = document.querySelector("[data-profile-editor]");
        const isSameOpenField = editor?.dataset.activeField === row.dataset.profileEdit && !editor.hidden;

        if (isSameOpenField) {
          closeProfileFieldEditor();
          return;
        }

        openProfileFieldEditor(row.dataset.profileEdit, profileForm);
      });
    });

    editorForm.addEventListener("submit", (event) => saveProfileField(event, auth, profileForm));
    cancelButton?.addEventListener("click", () => closeProfileFieldEditor());
    deleteButton?.addEventListener("click", () => deleteProfileField(auth, profileForm));
  }

  async function saveProfileField(event, auth, profileForm) {
    event.preventDefault();

    const editor = document.querySelector("[data-profile-editor]");
    const saveButton = document.querySelector("[data-profile-edit-save]");
    const fieldName = editor?.dataset.activeField;
    const config = profileFieldConfig[fieldName];
    const control = config?.type === "name-parts"
      ? document.querySelector("[data-profile-name-parts]")
      : document.querySelector('[name="profileFieldValue"]');

    if (!fieldName || !config || !control || !profileForm.elements[fieldName]) {
      return;
    }

    if (config.type === "name-parts") {
      const firstNameInput = control.querySelector('[name="firstName"]');
      const lastNameInput = control.querySelector('[name="lastName"]');

      if (firstNameInput?.reportValidity && !firstNameInput.reportValidity()) {
        return;
      }

      if (lastNameInput?.reportValidity && !lastNameInput.reportValidity()) {
        return;
      }

      const nextNameDetails = normalizeNameDetails({
        firstName: firstNameInput?.value,
        lastName: lastNameInput?.value
      });

      if (!nextNameDetails.firstName || !nextNameDetails.lastName) {
        setProfileMessage("Vorname und Nachname dürfen nicht leer sein.", false);
        return;
      }

      const previousNameDetails = {
        firstName: profileForm.elements.firstName?.value || "",
        lastName: profileForm.elements.lastName?.value || "",
        displayName: profileForm.elements.displayName.value
      };

      profileForm.elements.firstName.value = nextNameDetails.firstName;
      profileForm.elements.lastName.value = nextNameDetails.lastName;
      profileForm.elements.displayName.value = nextNameDetails.displayName;

      if (await persistProfileDetails(auth, profileForm, saveButton)) {
        closeProfileFieldEditor();
      } else {
        profileForm.elements.firstName.value = previousNameDetails.firstName;
        profileForm.elements.lastName.value = previousNameDetails.lastName;
        profileForm.elements.displayName.value = previousNameDetails.displayName;
        updateProfileFieldList(profileForm);
      }

      return;
    }

    if (control.reportValidity && !control.reportValidity()) {
      return;
    }

    const value = getProfileEditorValue(control, config);

    if (config.required && !value) {
      setProfileMessage(`${config.label} darf nicht leer sein.`, false);
      return;
    }

    const previousValue = profileForm.elements[fieldName].value;

    profileForm.elements[fieldName].value = value;

    if (await persistProfileDetails(auth, profileForm, saveButton)) {
      closeProfileFieldEditor();
    } else {
      profileForm.elements[fieldName].value = previousValue;
      updateProfileFieldList(profileForm);
    }
  }

  async function deleteProfileField(auth, profileForm) {
    const editor = document.querySelector("[data-profile-editor]");
    const deleteButton = document.querySelector("[data-profile-edit-delete]");
    const fieldName = editor?.dataset.activeField;
    const config = profileFieldConfig[fieldName];

    if (!fieldName || !config?.canDelete || !profileForm.elements[fieldName]) {
      return;
    }

    const previousValue = profileForm.elements[fieldName].value;

    profileForm.elements[fieldName].value = "";

    if (await persistProfileDetails(auth, profileForm, deleteButton)) {
      closeProfileFieldEditor();
    } else {
      profileForm.elements[fieldName].value = previousValue;
      updateProfileFieldList(profileForm);
    }
  }

  function fillAccountManagementForms(user) {
    const profileForm = document.querySelector("[data-profile-form]");

    if (!profileForm) {
      return;
    }

    const nameDetails = getNameDetailsFromData(readUserDocCache(user.uid), user);

    if (profileForm.elements.firstName) {
      profileForm.elements.firstName.value = nameDetails.firstName;
    }

    if (profileForm.elements.lastName) {
      profileForm.elements.lastName.value = nameDetails.lastName;
    }

    profileForm.elements.displayName.value = nameDetails.displayName;
    updateProfileFieldList(profileForm);
  }

  function updateEmptyProfileFieldHighlights(form = document.querySelector("[data-profile-form]")) {
    if (!form || form.dataset.profileDetailsLoaded !== "true") {
      return;
    }

    form.querySelectorAll("[data-highlight-when-empty]").forEach((input) => {
      input.classList.toggle("is-empty-highlight", !input.value.trim());
    });

    updateProfileFieldList(form);
  }

  function clearEmptyProfileFieldHighlights(form = document.querySelector("[data-profile-form]")) {
    if (!form) {
      return;
    }

    form.querySelectorAll("[data-highlight-when-empty]").forEach((input) => {
      input.classList.remove("is-empty-highlight");
    });

    document.querySelectorAll("[data-highlight-field-when-empty]").forEach((row) => {
      row.classList.remove("is-empty-highlight");
    });
  }

  function updateGoogleProviderStatus(user) {
    const status = document.querySelector("[data-google-provider-status]");
    const button = document.querySelector("[data-google-link]");
    const unlinkButton = document.querySelector("[data-google-unlink]");
    const googleProviderItem = document.querySelector("[data-google-provider-item]");

    if (!status || !button || !user) {
      return;
    }

    const googleLinked = hasProvider(user, "google.com");
    const passwordLinked = hasProvider(user, "password");
    const hasEmailFallback = passwordLinked && Boolean(user.emailVerified);

    setProviderStatusClass(googleProviderItem, googleLinked ? "active" : "inactive");
    button.disabled = googleLinked && !hasEmailFallback;
    updatePasswordProviderStatus(user);
    if (unlinkButton) {
      unlinkButton.classList.toggle("is-hidden", !googleLinked);
      unlinkButton.disabled = !hasEmailFallback;
      unlinkButton.title = hasEmailFallback
        ? ""
        : "Erst möglich, wenn ein bestätigtes E-Mail-Konto vorhanden ist.";
      unlinkButton.setAttribute("aria-disabled", String(!hasEmailFallback));
      unlinkButton.textContent = "Google-Konto abmelden";
      unlinkButton.dataset.defaultHtml = "Google-Konto abmelden";
    }

    if (googleLinked) {
      updateText("[data-google-provider-summary]", getGoogleEmail(user) || "Google-Konto aktiv");
      status.textContent = hasEmailFallback
        ? "Google ist aktiv. Du kannst das Google-Konto wechseln oder abmelden, weil ein bestätigtes E-Mail-Konto vorhanden ist."
        : "Google ist aktiv. Zum Wechseln oder Abmelden brauchst du zuerst ein bestätigtes E-Mail-Konto.";
      button.textContent = "Google-Konto wechseln";
      button.dataset.defaultHtml = "Google-Konto wechseln";
      return;
    }

    updateText("[data-google-provider-summary]", "Nicht verbunden");
    status.textContent = "Dieses Konto ist noch nicht mit Google verbunden.";
    button.textContent = "Google-Konto hinzufügen";
    button.dataset.defaultHtml = "Google-Konto hinzufügen";
  }

  function setProviderStatusClass(element, status) {
    if (!element) {
      return;
    }

    element.classList.toggle("is-provider-active", status === "active");
    element.classList.toggle("is-provider-warning", status === "warning");
    element.classList.toggle("is-provider-inactive", status === "inactive");
  }

  function setPasswordFormOpen(form, isOpen) {
    if (!form) {
      return;
    }

    form.dataset.editing = String(isOpen);
    form.classList.toggle("is-hidden", !isOpen);
    form.hidden = !isOpen;
    form.setAttribute("aria-hidden", String(!isOpen));
  }

  function updatePasswordProviderStatus(user) {
    const form = document.querySelector("[data-password-form]");
    const help = document.querySelector("[data-password-provider-help]");
    const passwordProviderItem = document.querySelector("[data-password-provider-item]");
    const currentPasswordRow = document.querySelector("[data-current-password-row]");
    const editButton = document.querySelector("[data-password-edit]");
    const submitButton = form?.querySelector('button[type="submit"]');
    const currentPasswordInput = form?.elements.currentPassword;
    const emailInput = form?.elements.email;
    const emailRow = document.querySelector("[data-password-email-row]");
    const emailEditButton = document.querySelector("[data-password-email-edit]");
    const verificationButton = document.querySelector("[data-password-verification]");
    const unlinkButton = document.querySelector("[data-password-unlink]");

    if (!user) {
      return;
    }

    const passwordLinked = hasProvider(user, "password");
    const googleLinked = hasProvider(user, "google.com");
    const emailLabel = user.email || "keine E-Mail-Adresse";
    const passwordVerified = passwordLinked && Boolean(user.emailVerified);
    const editLabel = passwordLinked ? "Passwort ändern" : "E-Mail-Konto hinzufügen";
    const submitLabel = passwordLinked ? "Passwort speichern" : "E-Mail-Konto hinzufügen";
    const formIsOpen = form?.dataset.editing === "true";
    const pendingEmail = passwordLinked ? String(readUserDocCache(user.uid)?.pendingEmail || "").trim() : "";
    const emailChangePending = pendingEmail && pendingEmail.toLowerCase() !== user.email?.toLowerCase();
    const passwordStatus = !passwordLinked ? "inactive" : (passwordVerified && !emailChangePending ? "active" : "warning");

    setProviderStatusClass(passwordProviderItem, passwordStatus);
    updateText(
      "[data-password-provider-summary]",
      passwordLinked ? emailLabel : "Nicht eingerichtet"
    );

    if (help) {
      help.hidden = passwordVerified && !emailChangePending;
      if (!passwordLinked) {
        help.textContent = "Gib eine E-Mail-Adresse und ein Passwort ein, um eine weitere Anmeldemethode hinzuzufügen.";
      } else if (emailChangePending) {
        help.textContent = `Neue Adresse: ${pendingEmail} · Bestätigung ausstehend.`;
      } else {
        help.textContent = "Bitte bestätige deine Passwort-Mail über den Link in deinem Postfach.";
      }
    }

    if (emailRow) emailRow.hidden = passwordLinked;
    if (emailInput) {
      emailInput.disabled = passwordLinked;
      emailInput.required = !passwordLinked;
    }
    if (emailEditButton) {
      emailEditButton.hidden = !passwordLinked || formIsOpen;
      if (!passwordLinked) setPasswordEmailFormOpen(false);
    }

    if (currentPasswordRow) {
      currentPasswordRow.hidden = !passwordLinked;
    }

    if (currentPasswordInput) {
      currentPasswordInput.required = passwordLinked;

      if (!passwordLinked) {
        currentPasswordInput.value = "";
      }
    }

    if (submitButton) {
      submitButton.textContent = submitLabel;
      submitButton.dataset.defaultHtml = submitLabel;
    }

    if (editButton) {
      editButton.textContent = editLabel;
      editButton.dataset.defaultHtml = editLabel;
      editButton.classList.toggle("is-hidden", formIsOpen);
    }

    setPasswordFormOpen(form, formIsOpen);
    verificationButton?.classList.toggle("is-hidden", formIsOpen || !passwordLinked || passwordVerified);
    unlinkButton?.classList.toggle("is-hidden", formIsOpen || !passwordLinked || !googleLinked);
  }

  function openPasswordForm(auth) {
    const form = document.querySelector("[data-password-form]");

    setPasswordEmailFormOpen(false);
    setPasswordFormOpen(form, true);
    updatePasswordProviderStatus(auth.currentUser);

    const firstVisibleInput = Array.from(form?.querySelectorAll("input") || [])
      .find((input) => !input.closest("[hidden]"));

    firstVisibleInput?.focus({ preventScroll: true });
  }

  function setPasswordEmailFormOpen(isOpen, email = "") {
    const form = document.querySelector("[data-password-email-form]");
    if (!form) return;
    form.hidden = !isOpen;
    form.elements.email.value = email;
    document.querySelector("[data-password-email-edit]")?.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) form.elements.email.focus();
  }

  async function savePasswordEmail(event, auth) {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user || !hasProvider(user, "password")) return;
    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    if (!email) return;
    const button = form.querySelector('button[type="submit"]');
    if (button?.disabled) return;
    try {
      setLoading(button, true, "Speichern...");
      await user.reload();
      requireCurrentUser(user);
      if (email.toLowerCase() === user.email?.toLowerCase()) {
        await saveIdentitySnapshot(user, null);
        setPasswordEmailFormOpen(false);
        updatePasswordProviderStatus(user);
        setPasswordMessage("Ausstehende E-Mail-Änderung verworfen.", true);
        return;
      }
      await user.verifyBeforeUpdateEmail(email, { url: getVerificationRedirectUrl() });
      requireCurrentUser(user);
      await saveIdentitySnapshot(user, email);
      setPasswordEmailFormOpen(false);
      updatePasswordProviderStatus(user);
      setPasswordMessage(`Bestätige die neue Passwort-Mail über den Link an ${email}.`, true);
    } catch (error) {
      setPasswordMessage(translateProfileSaveError(error), false);
    } finally {
      setLoading(button, false);
    }
  }

  function closePasswordForm(auth) {
    const form = document.querySelector("[data-password-form]");

    form?.reset();
    setPasswordFormOpen(form, false);
    updatePasswordProviderStatus(auth.currentUser);
  }

  function initSecurityAccordion() {
    const items = Array.from(document.querySelectorAll(".security-field-item"));

    items.forEach((item) => {
      if (item.dataset.accordionAttached) {
        return;
      }

      item.dataset.accordionAttached = "true";
      item.addEventListener("toggle", () => {
        if (!item.open) {
          return;
        }

        items.forEach((otherItem) => {
          if (otherItem !== item) {
            otherItem.open = false;
          }
        });
      });
    });
  }

  async function initAccountManagement(auth, userData) {
    const profileForm = document.querySelector("[data-profile-form]");
    const passwordForm = document.querySelector("[data-password-form]");
    const googleLinkButton = document.querySelector("[data-google-link]");
    const googleUnlinkButton = document.querySelector("[data-google-unlink]");
    const passwordEditButton = document.querySelector("[data-password-edit]");
    const passwordCancelButton = document.querySelector("[data-password-cancel]");
    const passwordVerificationButton = document.querySelector("[data-password-verification]");
    const passwordUnlinkButton = document.querySelector("[data-password-unlink]");

    initSecurityAccordion();

    if (profileForm && !profileForm.dataset.listenerAttached) {
      profileForm.dataset.listenerAttached = "true";
      profileForm.addEventListener("submit", (event) => saveProfileDetails(event, auth));
      initProfileFieldEditor(profileForm, auth);
      profileForm.querySelectorAll("[data-highlight-when-empty]").forEach((input) => {
        input.addEventListener("input", () => {
          if (profileForm.dataset.profileDetailsLoaded === "true") {
            updateEmptyProfileFieldHighlights(profileForm);
          }
        });
        input.addEventListener("change", () => {
          if (profileForm.dataset.profileDetailsLoaded === "true") {
            updateEmptyProfileFieldHighlights(profileForm);
          }
        });
      });
    }

    if (passwordForm && !passwordForm.dataset.listenerAttached) {
      passwordForm.dataset.listenerAttached = "true";
      passwordForm.addEventListener("submit", (event) => changeAccountPassword(event, auth));
      document.querySelector("[data-password-email-form]")?.addEventListener("submit", (event) => savePasswordEmail(event, auth));
      document.querySelector("[data-password-email-edit]")?.addEventListener("click", () => {
        const user = auth.currentUser;
        if (!user || !hasProvider(user, "password")) return;
        const isOpen = document.querySelector("[data-password-email-form]")?.hidden;
        setPasswordMessage("");
        setPasswordEmailFormOpen(isOpen, isOpen ? readUserDocCache(user.uid)?.pendingEmail || user.email : "");
      });
      document.querySelector("[data-password-email-cancel]")?.addEventListener("click", () => {
        setPasswordEmailFormOpen(false);
        document.querySelector("[data-password-email-edit]")?.focus();
      });
    }

    if (passwordEditButton && !passwordEditButton.dataset.listenerAttached) {
      passwordEditButton.dataset.listenerAttached = "true";
      passwordEditButton.addEventListener("click", () => openPasswordForm(auth));
    }

    if (passwordCancelButton && !passwordCancelButton.dataset.listenerAttached) {
      passwordCancelButton.dataset.listenerAttached = "true";
      passwordCancelButton.addEventListener("click", () => closePasswordForm(auth));
    }

    if (googleLinkButton && !googleLinkButton.dataset.listenerAttached) {
      googleLinkButton.dataset.listenerAttached = "true";
      googleLinkButton.addEventListener("click", () => manageGoogleAccount(auth, googleLinkButton));
    }

    if (googleUnlinkButton && !googleUnlinkButton.dataset.listenerAttached) {
      googleUnlinkButton.dataset.listenerAttached = "true";
      googleUnlinkButton.addEventListener("click", () => unlinkGoogleAccount(auth, googleUnlinkButton));
    }

    if (passwordVerificationButton && !passwordVerificationButton.dataset.listenerAttached) {
      passwordVerificationButton.dataset.listenerAttached = "true";
      passwordVerificationButton.addEventListener("click", () => sendPasswordVerification(auth, passwordVerificationButton));
    }

    if (passwordUnlinkButton && !passwordUnlinkButton.dataset.listenerAttached) {
      passwordUnlinkButton.dataset.listenerAttached = "true";
      passwordUnlinkButton.addEventListener("click", () => unlinkPasswordAccount(auth, passwordUnlinkButton));
    }

    await loadAccountProfileDetails(auth, userData);
    updatePasswordProviderStatus(auth.currentUser);
  }

  function getOptionalProfileDetails(form) {
    return {
      dlrgBranch: normalizeDlrgBranchName(form.elements.dlrgBranch?.value),
      birthDate: form.elements.birthDate?.value || "",
      gender: form.elements.gender?.value || ""
    };
  }

  function haveOptionalProfileDetailsChanged(user, details) {
    const cachedData = readUserDocCache(user.uid);

    if (!cachedData) {
      return true;
    }

    const storedDetails = getProfileDetailsFromData(cachedData);

    const storedRawBranch = String(cachedData.dlrgBranch || "").trim();

    return details.dlrgBranch !== storedDetails.dlrgBranch
      || (storedRawBranch && details.dlrgBranch !== storedRawBranch)
      || details.birthDate !== storedDetails.birthDate
      || details.gender !== storedDetails.gender;
  }

  function haveNameDetailsChanged(user, nameDetails) {
    const cachedData = readUserDocCache(user.uid);

    if (!cachedData) {
      return true;
    }

    const storedNameDetails = getNameDetailsFromData(cachedData, user);

    return nameDetails.firstName !== storedNameDetails.firstName
      || nameDetails.lastName !== storedNameDetails.lastName
      || nameDetails.displayName !== storedNameDetails.displayName;
  }

  async function loadAccountProfileDetails(auth, userData) {
    const user = auth.currentUser;
    const profileForm = document.querySelector("[data-profile-form]");

    if (!user || !profileForm || !window.firebase.firestore) {
      return;
    }

    try {
      profileForm.dataset.profileDetailsLoaded = "false";
      clearEmptyProfileFieldHighlights(profileForm);

      const data = userData || await loadCurrentUserData(user) || {};
      const details = await syncProfileDetailsFromLinkRequest(user, data);
      const nameDetails = getNameDetailsFromData(data, user);
      if (profileForm.elements.firstName) {
        profileForm.elements.firstName.value = nameDetails.firstName;
      }

      if (profileForm.elements.lastName) {
        profileForm.elements.lastName.value = nameDetails.lastName;
      }

      if (profileForm.elements.displayName) {
        profileForm.elements.displayName.value = nameDetails.displayName;
      }

      if (profileForm.elements.dlrgBranch) {
        profileForm.elements.dlrgBranch.value = details.dlrgBranch;
      }

      if (profileForm.elements.birthDate) {
        profileForm.elements.birthDate.value = details.birthDate;
      }

      if (profileForm.elements.gender) {
        profileForm.elements.gender.value = details.gender;
      }

      profileForm.dataset.profileDetailsLoaded = "true";
      updateEmptyProfileFieldHighlights(profileForm);
    } catch (error) {
      profileForm.dataset.profileDetailsLoaded = "false";
      setProfileMessage(translateFirestoreError(error), false);
    }
  }

  function getProfileDetailsFromData(data) {
    return {
      dlrgBranch: normalizeDlrgBranchName(data.dlrgBranch),
      birthDate: data.birthDate || "",
      gender: data.gender || ""
    };
  }

  async function syncProfileDetailsFromLinkRequest(user, data) {
    return getProfileDetailsFromData(data);
  }

  async function persistProfileDetails(auth, form, button) {
    const user = auth.currentUser;
    const nameDetails = normalizeNameDetails({
      firstName: form.elements.firstName?.value,
      lastName: form.elements.lastName?.value,
      displayName: form.elements.displayName?.value
    });
    const displayName = nameDetails.displayName;
    const optionalProfileDetails = getOptionalProfileDetails(form);

    if (!user) {
      setProfileMessage("Bitte logge dich erneut ein.", false);
      return false;
    }

    if (form.elements.displayName) {
      form.elements.displayName.value = displayName;
    }

    const displayNameChanged = Boolean(displayName && displayName !== (user.displayName || ""));
    const nameDetailsChanged = haveNameDetailsChanged(user, nameDetails);
    const profileDetailsChanged = haveOptionalProfileDetailsChanged(user, optionalProfileDetails);

    if (!displayNameChanged && !nameDetailsChanged && !profileDetailsChanged) {
      setProfileMessage("Keine Ã„nderung zu speichern.", true);
      updateEmptyProfileFieldHighlights(form);
      return true;
    }

    try {
      setLoading(button, true, "Speichern...");

      if (displayNameChanged) {
        await user.updateProfile({ displayName });
      }

      await user.reload();
      const updatedData = await saveIdentitySnapshot(
        auth.currentUser,
        undefined,
        optionalProfileDetails,
        nameDetails
      );
      updateAccountProfile(auth.currentUser);
      fillAccountManagementForms(auth.currentUser);
      await loadAccountProfileDetails(auth, updatedData);
      await initLinkStatus(auth, updatedData);
      updateEmptyProfileFieldHighlights(form);

      setProfileMessage("Kontodaten gespeichert.", true);
      return true;
    } catch (error) {
      setProfileMessage(translateProfileSaveError(error), false);
      return false;
    } finally {
      setLoading(button, false);
    }
  }

  async function saveProfileDetails(event, auth) {
    event.preventDefault();

    await persistProfileDetails(
      auth,
      event.currentTarget,
      event.currentTarget.querySelector('button[type="submit"]')
    );
  }

  async function saveIdentitySnapshot(user, pendingEmail, optionalProfileDetails, nameDetails = null) {
    requireCurrentUser(user);
    if (!window.firebase.firestore) {
      return null;
    }

    const cachedData = readUserDocCache(user.uid) || {};
    const identity = getUserIdentityData(user, nameDetails || getNameDetailsFromData(cachedData, user));
    const payload = {
      ...identity,
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    };
    const cachePayload = { ...identity };

    if (optionalProfileDetails) {
      payload.dlrgBranch = optionalProfileDetails.dlrgBranch;
      payload.birthDate = optionalProfileDetails.birthDate;
      payload.gender = optionalProfileDetails.gender;
      payload.profileDetailsUpdatedAt = window.firebase.firestore.FieldValue.serverTimestamp();

      cachePayload.dlrgBranch = optionalProfileDetails.dlrgBranch;
      cachePayload.birthDate = optionalProfileDetails.birthDate;
      cachePayload.gender = optionalProfileDetails.gender;
    }

    if (pendingEmail === null) {
      payload.pendingEmail = window.firebase.firestore.FieldValue.delete();
      payload.pendingEmailFrom = window.firebase.firestore.FieldValue.delete();
    } else if (pendingEmail) {
      payload.pendingEmail = pendingEmail;
      payload.pendingEmailFrom = user.email || "";
      cachePayload.pendingEmail = pendingEmail;
      cachePayload.pendingEmailFrom = payload.pendingEmailFrom;
    }

    requireCurrentUser(user);
    const db = window.firebase.firestore();
    await db.runTransaction(async (transaction) => {
      const ref = db.collection("users").doc(user.uid);
      const snapshot = await transaction.get(ref);
      requireCurrentUser(user);
      transaction.set(ref, payload, { merge: true });
      window.LifesavingPersonLinks.syncClubProfile(transaction, db, user.uid, { ...(snapshot.data() || {}), ...cachePayload });
    });
    requireCurrentUser(user);
    const updatedData = { ...cachedData, ...cachePayload };
    if (pendingEmail === null) {
      delete updatedData.pendingEmail;
      delete updatedData.pendingEmailFrom;
    }
    return writeUserDocCache(user.uid, updatedData);
  }

  async function changeAccountPassword(event, auth) {
    event.preventDefault();

    const user = auth.currentUser;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const currentPassword = form.elements.currentPassword?.value || "";
    const email = form.elements.email?.value.trim() || "";
    const newPassword = form.elements.newPassword.value;
    const repeatPassword = form.elements.repeatPassword.value;
    const passwordLinked = user ? hasProvider(user, "password") : false;

    if (!user) {
      setPasswordMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    if (newPassword !== repeatPassword) {
      setPasswordMessage("Die neuen Passwörter stimmen nicht überein.", false);
      return;
    }

    if (newPassword.length < 8) {
      setPasswordMessage("Das neue Passwort muss mindestens 8 Zeichen haben.", false);
      return;
    }

    if (!passwordLinked && !email) {
      setPasswordMessage("Bitte gib eine E-Mail-Adresse für den Passwort-Login ein.", false);
      return;
    }

    if (passwordLinked && !currentPassword) {
      setPasswordMessage("Bitte gib dein altes Passwort ein.", false);
      return;
    }

    let verificationSent = false;

    try {
      setLoading(button, true, passwordLinked ? "Speichern..." : "Aktiviere...");

      if (passwordLinked) {
        const credential = window.firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
        await user.reauthenticateWithCredential(credential);
        await user.updatePassword(newPassword);
      } else {
        const credential = window.firebase.auth.EmailAuthProvider.credential(email, newPassword);
        await user.linkWithCredential(credential);
        await user.reload();
        requireCurrentUser(user);

        updateAccountProfile(user);
        updateGoogleProviderStatus(user);
        await saveIdentitySnapshot(user, null);

        if (!user.emailVerified) {
          await user.sendEmailVerification({
            url: getLoginRedirectUrl()
          });
          verificationSent = true;
        }
      }

      form.reset();
      setPasswordFormOpen(form, false);
      setPasswordMessage(
        passwordLinked
          ? "Passwort wurde geändert."
          : (verificationSent
            ? `E-Mail-Konto wurde angelegt. Die Bestätigungsmail wurde an ${user.email} gesendet. Google bleibt aktiv.`
            : "E-Mail-Konto wurde angelegt und ist bestätigt. Du kannst dich jetzt auch mit E-Mail und Passwort anmelden."),
        true
      );
    } catch (error) {
      setPasswordMessage(translateAuthError(error), false);
    } finally {
      setLoading(button, false);
      if (auth.currentUser) {
        updatePasswordProviderStatus(auth.currentUser);
      }
    }
  }

  async function manageGoogleAccount(auth, button) {
    const user = auth.currentUser;

    if (!user) {
      setGoogleAccountMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    const provider = new window.firebase.auth.GoogleAuthProvider();

    provider.setCustomParameters({
      prompt: "select_account"
    });

    const googleLinked = hasProvider(user, "google.com");
    const passwordLinked = hasProvider(user, "password");
    let googleWasUnlinked = false;

    if (googleLinked && (!passwordLinked || !user.emailVerified)) {
      setGoogleAccountMessage(
        passwordLinked
          ? "Google-Konto wechseln ist erst möglich, wenn das E-Mail-Konto bestätigt ist."
          : "Google-Konto wechseln ist erst möglich, wenn zusätzlich ein bestätigtes E-Mail-Konto existiert.",
        false
      );
      return;
    }

    try {
      setLoading(button, true, "Google öffnet...");

      if (googleLinked && passwordLinked) {
        const confirmed = window.confirm(
          "Google-Konto wechseln? Dein Konto bleibt erhalten, weil E-Mail/Passwort weiterhin als Login vorhanden ist."
        );

        if (!confirmed) {
          return;
        }

        await user.unlink("google.com");
        googleWasUnlinked = true;
        updateAccountProfile(user);
      }

      await user.linkWithPopup(provider);
      await user.reload();
      updateAccountProfile(auth.currentUser);
      updateGoogleProviderStatus(auth.currentUser);
      await saveIdentitySnapshot(auth.currentUser);
      setGoogleAccountMessage(googleWasUnlinked ? "Google-Konto wurde gewechselt." : "Google-Konto wurde verbunden.", true);
    } catch (error) {
      setGoogleAccountMessage(
        googleWasUnlinked
          ? `${translateAuthError(error)} Du kannst dich weiterhin mit E-Mail und Passwort anmelden.`
          : translateAuthError(error),
        false
      );
    } finally {
      setLoading(button, false);
      if (auth.currentUser) {
        updateGoogleProviderStatus(auth.currentUser);
      }
    }
  }

  async function unlinkGoogleAccount(auth, button) {
    const user = auth.currentUser;

    if (!user) {
      setGoogleAccountMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    if (!hasProvider(user, "google.com")) {
      setGoogleAccountMessage("Dieses Konto ist nicht mit Google verbunden.", false);
      return;
    }

    if (!hasProvider(user, "password") || !user.emailVerified) {
      setGoogleAccountMessage("Google kann erst abgemeldet werden, wenn ein bestätigtes E-Mail-Konto vorhanden ist.", false);
      return;
    }

    const confirmed = window.confirm("Google-Konto abmelden? Dein Login über E-Mail und Passwort bleibt erhalten.");

    if (!confirmed) {
      return;
    }

    try {
      setLoading(button, true, "Entferne...");
      await user.unlink("google.com");
      await user.reload();
      updateAccountProfile(auth.currentUser);
      updateGoogleProviderStatus(auth.currentUser);
      await saveIdentitySnapshot(auth.currentUser);
      setGoogleAccountMessage("Google-Konto wurde abgemeldet.", true);
    } catch (error) {
      setGoogleAccountMessage(translateAuthError(error), false);
    } finally {
      setLoading(button, false);
      if (auth.currentUser) {
        updateGoogleProviderStatus(auth.currentUser);
      }
    }
  }

  async function sendPasswordVerification(auth, button) {
    const user = auth.currentUser;

    if (!user) {
      setPasswordMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    if (!hasProvider(user, "password")) {
      setPasswordMessage("Es ist noch kein E-Mail-Konto eingerichtet.", false);
      return;
    }

    if (user.emailVerified) {
      setPasswordMessage("Dieses E-Mail-Konto ist bereits bestätigt.", true);
      updatePasswordProviderStatus(user);
      return;
    }

    try {
      setLoading(button, true, "Sende...");
      await user.sendEmailVerification({
        url: getLoginRedirectUrl()
      });
      setPasswordMessage(`Bestätigungsmail wurde an ${user.email} gesendet.`, true);
    } catch (error) {
      setPasswordMessage(translateAuthError(error), false);
    } finally {
      setLoading(button, false);
      if (auth.currentUser) {
        updatePasswordProviderStatus(auth.currentUser);
      }
    }
  }

  async function unlinkPasswordAccount(auth, button) {
    const user = auth.currentUser;

    if (!user) {
      setPasswordMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    if (!hasProvider(user, "password")) {
      setPasswordMessage("Es ist kein E-Mail-Konto eingerichtet.", false);
      return;
    }

    if (!hasProvider(user, "google.com")) {
      setPasswordMessage("Das E-Mail-Konto kann nicht entfernt werden, solange kein Google-Konto verbunden ist.", false);
      return;
    }

    const confirmed = window.confirm("E-Mail-Konto entfernen? Dein Google-Login bleibt erhalten.");

    if (!confirmed) {
      return;
    }

    try {
      setLoading(button, true, "Entferne...");
      await user.unlink("password");
      await user.reload();
      updateAccountProfile(auth.currentUser);
      updateGoogleProviderStatus(auth.currentUser);
      await saveIdentitySnapshot(auth.currentUser, null);
      setPasswordMessage("E-Mail-Konto wurde entfernt. Google bleibt aktiv.", true);
    } catch (error) {
      setPasswordMessage(translateAuthError(error), false);
    } finally {
      setLoading(button, false);
      if (auth.currentUser) {
        updatePasswordProviderStatus(auth.currentUser);
      }
    }
  }

  function getLinkManagementControls() {
    return {
      root: document.querySelector("[data-link-management]"),
      details: document.querySelector("[data-link-management-details]"),
      statusRow: document.querySelector("[data-link-management-status-row]"),
      title: document.querySelector("[data-link-management-title]"),
      text: document.querySelector("[data-link-management-text]"),
      openPanel: document.querySelector("[data-link-open-panel]"),
      requestedPanel: document.querySelector("[data-link-requested-panel]"),
      linkedPanel: document.querySelector("[data-link-linked-panel]"),
      withdrawButton: document.querySelector("[data-link-request-withdraw]"),
      unlinkButton: document.querySelector("[data-link-unlink]"),
      issueOpenButton: document.querySelector("[data-link-issue-open]"),
      issueWithdrawButton: document.querySelector("[data-link-issue-withdraw]"),
      issueCancelButton: document.querySelector("[data-link-issue-cancel]"),
      issueForm: document.querySelector("[data-link-issue-form]")
    };
  }

  function setLinkManagementPanel(panel, shouldShow) {
    if (!panel) {
      return;
    }

    panel.classList.toggle("is-hidden", !shouldShow);
    panel.hidden = !shouldShow;
    panel.setAttribute("aria-hidden", String(!shouldShow));
  }

  function setLinkManagementControlsDisabled(isDisabled) {
    const controls = getLinkManagementControls();

    controls.root?.querySelectorAll("button, textarea").forEach((control) => {
      control.disabled = isDisabled;
    });
  }

  function setLinkManagementStatus(data) {
    const controls = getLinkManagementControls();
    const linked = isPersonLinked(data);
    const requested = hasPendingLinkRequest(data);
    const issueReported = hasOpenLinkIssue(data);
    const rejected = hasRejectedLinkRequest(data);
    let state = "open";
    let title = "Nicht verknüpft";
    let text = "Dein Konto ist noch nicht mit der Datenbank verknüpft.";

    if (linked && issueReported) {
      state = "issue";
      title = "Fehler gemeldet";
      text = "Deine Meldung wurde an den Adminbereich übermittelt.";
    } else if (linked) {
      state = "linked";
      title = "Verknüpft";
      text = "Dein Konto ist mit der Datenbank verknüpft.";
    } else if (requested) {
      state = "requested";
      title = "Antrag gestellt";
      text = "Dein Verknüpfungsantrag liegt im Adminbereich zur Prüfung.";
    } else if (rejected) {
      state = "rejected";
      title = "Antrag abgelehnt";
      text = "Du kannst die Angaben prüfen und erneut absenden.";
    }

    if (controls.title) {
      controls.title.textContent = title;
    }

    if (controls.text) {
      controls.text.textContent = text;
    }

    controls.root?.classList.remove("is-link-open", "is-link-requested", "is-link-linked", "is-link-issue", "is-link-rejected");
    controls.root?.classList.add(`is-link-${state}`);

    setLinkManagementPanel(controls.openPanel, state === "open" || state === "rejected");
    setLinkManagementPanel(controls.requestedPanel, state === "requested");
    setLinkManagementPanel(controls.linkedPanel, state === "linked" || state === "issue");

    if (controls.issueOpenButton) {
      controls.issueOpenButton.classList.toggle("is-hidden", state === "issue");
      controls.issueOpenButton.hidden = state === "issue";
    }

    if (controls.issueWithdrawButton) {
      controls.issueWithdrawButton.classList.toggle("is-hidden", state !== "issue");
      controls.issueWithdrawButton.hidden = state !== "issue";
    }

    if (controls.issueForm && state !== "linked") {
      closeLinkIssueForm();
    }

    return state;
  }

  function fillLinkRequestPreview(data) {
    const request = data?.personLinkRequest || {};
    const fullName = `${request.firstName || ""} ${request.lastName || ""}`.trim();

    updateText("[data-link-request-name]", fullName || "Nicht angegeben");
    updateText("[data-link-request-birth-date]", formatBirthDate(data?.birthDate) || "Nicht angegeben");
    updateText("[data-link-request-gender]", request.gender
      ? formatProfileFieldValue("gender", request.gender)
      : "Keine Angabe");
    updateText("[data-link-request-branch]", normalizeDlrgBranchName(data?.dlrgBranch) || "Nicht angegeben");
    updateText("[data-link-request-identity-hint]", getLinkRequestIdentityHint(request, data) || "Nicht angegeben");
    updateText("[data-link-request-email]", request.accountEmail || data?.email || "Nicht angegeben");
  }

  function updateLinkManagementUi(data) {
    if (!document.querySelector("[data-link-management]")) {
      return;
    }

    updateText("[data-linked-person-details]", formatLinkedPerson(window.LifesavingPersonLinks.linkedPerson(data)));
    updateText("[data-linked-account-email]", data?.email || "");
    fillLinkRequestPreview(data || {});
    setLinkManagementStatus(data || {});
  }

  function openLinkIssueForm() {
    const { issueForm } = getLinkManagementControls();

    if (!issueForm) {
      return;
    }

    issueForm.classList.remove("is-hidden");
    issueForm.hidden = false;
    issueForm.setAttribute("aria-hidden", "false");
    issueForm.elements.issueText?.focus();
  }

  function closeLinkIssueForm() {
    const { issueForm } = getLinkManagementControls();

    if (!issueForm) {
      return;
    }

    issueForm.reset();
    issueForm.classList.add("is-hidden");
    issueForm.hidden = true;
    issueForm.setAttribute("aria-hidden", "true");
  }

  async function initLinkManagement(auth, userData) {
    const controls = getLinkManagementControls();
    const user = auth.currentUser;

    if (!controls.root || !user) {
      return;
    }

    if (!window.firebase.firestore) {
      setLinkManagementControlsDisabled(true);
      setLinkManagementMessage("Firestore ist noch nicht geladen.", false);
      return;
    }

    if (controls.withdrawButton && !controls.withdrawButton.dataset.listenerAttached) {
      controls.withdrawButton.dataset.listenerAttached = "true";
      controls.withdrawButton.addEventListener("click", () => withdrawLinkRequest(auth, controls.withdrawButton));
    }

    if (controls.unlinkButton && !controls.unlinkButton.dataset.listenerAttached) {
      controls.unlinkButton.dataset.listenerAttached = "true";
      controls.unlinkButton.addEventListener("click", () => unlinkOwnPerson(auth, controls.unlinkButton));
    }

    if (controls.issueOpenButton && !controls.issueOpenButton.dataset.listenerAttached) {
      controls.issueOpenButton.dataset.listenerAttached = "true";
      controls.issueOpenButton.addEventListener("click", () => openLinkIssueForm());
    }

    if (controls.issueWithdrawButton && !controls.issueWithdrawButton.dataset.listenerAttached) {
      controls.issueWithdrawButton.dataset.listenerAttached = "true";
      controls.issueWithdrawButton.addEventListener("click", () => withdrawLinkIssue(auth, controls.issueWithdrawButton));
    }

    if (controls.issueCancelButton && !controls.issueCancelButton.dataset.listenerAttached) {
      controls.issueCancelButton.dataset.listenerAttached = "true";
      controls.issueCancelButton.addEventListener("click", () => closeLinkIssueForm());
    }

    if (controls.issueForm && !controls.issueForm.dataset.listenerAttached) {
      controls.issueForm.dataset.listenerAttached = "true";
      controls.issueForm.addEventListener("submit", (event) => reportLinkIssue(event, auth));
    }

    try {
      let data = userData || await loadCurrentUserData(user) || {};

      data = await cleanupLegacyLinkRequestFields(user, data);
      data = await cleanupInactiveLinkRequestData(user, data);
      updateLinkManagementUi(data);
      setLinkManagementMessage("", true);
    } catch (error) {
      setLinkManagementMessage(translateFirestoreError(error), false);
    }
  }

  async function withdrawLinkRequest(auth, button) {
    const user = auth.currentUser;

    if (!user || !window.firebase.firestore) {
      setLinkManagementMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    try {
      const fieldValue = window.firebase.firestore.FieldValue;

      setLoading(button, true, "Ziehe zurück...");
      setLinkManagementControlsDisabled(true);
      await window.firebase.firestore().collection("users").doc(user.uid).update({
        personLinkStatus: "open",
        personLinkRequest: fieldValue.delete(),
        personLinkIdentityHint: fieldValue.delete(),
        updatedAt: fieldValue.serverTimestamp()
      });

      const cachedData = { ...(readUserDocCache(user.uid) || {}) };

      cachedData.personLinkStatus = "open";
      delete cachedData.personLinkRequest;
      delete cachedData.personLinkIdentityHint;

      const data = writeUserDocCache(user.uid, cachedData);

      updateLinkStatusUi(data);
      updateLinkManagementUi(data);
      setLinkManagementMessage("Antrag zurückgezogen.", true);
    } catch (error) {
      setLinkManagementMessage(translateFirestoreError(error), false);
    } finally {
      setLoading(button, false);
      setLinkManagementControlsDisabled(false);
    }
  }



  async function unlinkOwnPerson(auth, button) {
    const user = auth.currentUser;
    if (!user || !window.firebase.firestore) return;
    if (!window.confirm("Verknüpfung zu deiner Datenbankperson wirklich aufheben?")) return;
    try {
      setLoading(button, true, "Hebe auf …");
      setLinkManagementControlsDisabled(true);
      const data = await window.LifesavingPersonLinks.unlinkOwn(window.firebase.firestore(), user.uid,
        window.firebase.firestore.FieldValue, () => requireCurrentUser(user));
      requireCurrentUser(user);
      writeUserDocCache(user.uid, data);
      updateLinkStatusUi(data);
      updateLinkManagementUi(data);
      setLinkManagementMessage("Verknüpfung aufgehoben.", true);
    } catch (error) { setLinkManagementMessage(translateFirestoreError(error), false); }
    finally {
      setLoading(button, false);
      setLinkManagementControlsDisabled(false);
    }
  }

  async function reportLinkIssue(event, auth) {
    event.preventDefault();

    const user = auth.currentUser;
    const controls = getLinkManagementControls();
    const text = controls.issueForm?.elements.issueText?.value.trim() || "";

    if (!user || !window.firebase.firestore) {
      setLinkManagementMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    if (!text) {
      setLinkManagementMessage("Bitte beschreibe kurz, was nicht stimmt.", false);
      return;
    }

    try {
      const fieldValue = window.firebase.firestore.FieldValue;
      const payload = {
        status: "reported",
        message: text,
        accountEmail: user.email || "",
        accountName: getAccountName(user),
        accountUid: user.uid
      };

      setLinkManagementControlsDisabled(true);
      await window.firebase.firestore().collection("users").doc(user.uid).update({
        personLinkIssue: {
          ...payload,
          reportedAt: fieldValue.serverTimestamp(),
          updatedAt: fieldValue.serverTimestamp()
        },
        updatedAt: fieldValue.serverTimestamp()
      });

      const data = mergeUserDocCache(user.uid, {
        personLinkIssue: payload
      });

      closeLinkIssueForm();
      updateLinkManagementUi(data);
      setLinkManagementMessage("Fehlermeldung gesendet.", true);
    } catch (error) {
      setLinkManagementMessage(translateFirestoreError(error), false);
    } finally {
      setLinkManagementControlsDisabled(false);
    }
  }

  async function withdrawLinkIssue(auth, button) {
    const user = auth.currentUser;

    if (!user || !window.firebase.firestore) {
      setLinkManagementMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    try {
      const fieldValue = window.firebase.firestore.FieldValue;

      setLoading(button, true, "Ziehe zurück...");
      setLinkManagementControlsDisabled(true);
      await window.firebase.firestore().collection("users").doc(user.uid).update({
        "personLinkIssue.status": "withdrawn",
        "personLinkIssue.withdrawnAt": fieldValue.serverTimestamp(),
        "personLinkIssue.updatedAt": fieldValue.serverTimestamp(),
        updatedAt: fieldValue.serverTimestamp()
      });

      const data = mergeUserDocCache(user.uid, {
        personLinkIssue: {
          ...(readUserDocCache(user.uid)?.personLinkIssue || {}),
          status: "withdrawn"
        }
      });

      updateLinkManagementUi(data);
      setLinkManagementMessage("Fehlermeldung zurückgezogen.", true);
    } catch (error) {
      setLinkManagementMessage(translateFirestoreError(error), false);
    } finally {
      setLoading(button, false);
      setLinkManagementControlsDisabled(false);
    }
  }

  async function initUserSettings(auth, userData) {
    const controls = getSettingsControls();

    if (!controls.keepData || !controls.privateProfile) {
      return;
    }

    if (!window.firebase.firestore) {
      setSettingsControlsDisabled(true);
      setSettingsMessage("Firestore ist noch nicht geladen.", false);
      return;
    }

    const db = window.firebase.firestore();

    Object.values(controls).forEach((control) => {
      if (!control.dataset.listenerAttached) {
        control.dataset.listenerAttached = "true";
        control.addEventListener("change", () => saveUserSettings(auth, db));
      }
    });

    await loadUserSettings(auth, db, userData);
  }

  function getSettingsControls() {
    return {
      keepData: document.querySelector("[data-keep-data]"),
      privateProfile: document.querySelector("[data-private-profile]")
    };
  }

  function setSettingsControlsDisabled(isDisabled) {
    Object.values(getSettingsControls()).forEach((control) => {
      if (control) {
        control.disabled = isDisabled;
      }
    });
  }

  function rememberCurrentSettings() {
    const controls = getSettingsControls();

    Object.values(controls).forEach((control) => {
      if (control) {
        control.dataset.savedValue = String(control.checked);
      }
    });
  }

  function restoreRememberedSettings() {
    const controls = getSettingsControls();

    Object.values(controls).forEach((control) => {
      if (control && control.dataset.savedValue) {
        control.checked = control.dataset.savedValue === "true";
      }
    });
  }

  function getSettingsPayloadFromControls(auth, db) {
    const controls = getSettingsControls();
    const fieldValue = window.firebase.firestore.FieldValue;
    const user = auth.currentUser;
    const shouldKeepData = controls.keepData.checked;
    const isPrivateProfile = controls.privateProfile.checked;
    const nameDetails = getNameDetailsFromData(readUserDocCache(user.uid) || {}, user);
    const payload = {
      email: user.email || "",
      displayName: nameDetails.displayName,
      firstName: nameDetails.firstName,
      lastName: nameDetails.lastName,
      keepPersonalDataUntilRevoked: shouldKeepData,
      privateProfile: isPrivateProfile,
      publicProfile: !isPrivateProfile,
      consentTextVersion: "2026-07-11-v1",
      updatedAt: fieldValue.serverTimestamp()
    };

    if (shouldKeepData) {
      payload.keepPersonalDataConsentAt = fieldValue.serverTimestamp();
      payload.keepPersonalDataRevokedAt = null;
    } else {
      payload.keepPersonalDataRevokedAt = fieldValue.serverTimestamp();
    }

    return {
      payload,
      userDoc: db.collection("users").doc(user.uid)
    };
  }

  async function loadUserSettings(auth, db, userData) {
    const controls = getSettingsControls();
    const user = auth.currentUser;

    if (!controls.keepData || !controls.privateProfile || !user) {
      return;
    }

    setSettingsControlsDisabled(true);
    setSettingsMessage("Einstellung wird geladen...", true);

    try {
      const loadedData = userData || await loadCurrentUserData(user);
      const data = loadedData || {};
      const hasKeepDataSetting = Object.prototype.hasOwnProperty.call(
        data,
        "keepPersonalDataUntilRevoked"
      );

      controls.keepData.checked = hasKeepDataSetting
        ? Boolean(data.keepPersonalDataUntilRevoked)
        : true;
      controls.privateProfile.checked = Boolean(data.privateProfile);
      rememberCurrentSettings();
      setSettingsMessage(
        loadedData ? "Einstellung geladen." : "Noch keine Einstellung gespeichert.",
        true
      );
    } catch (error) {
      setSettingsMessage(translateFirestoreError(error), false);
    } finally {
      setSettingsControlsDisabled(false);
    }
  }

  async function saveUserSettings(auth, db) {
    const controls = getSettingsControls();
    const user = auth.currentUser;

    if (!controls.keepData || !controls.privateProfile || !user) {
      return;
    }

    const { payload, userDoc } = getSettingsPayloadFromControls(auth, db);
    const savedKeepData = controls.keepData.dataset.savedValue;
    const savedPrivateProfile = controls.privateProfile.dataset.savedValue;

    if (
      savedKeepData === String(controls.keepData.checked)
      && savedPrivateProfile === String(controls.privateProfile.checked)
    ) {
      setSettingsMessage("Keine Ã„nderung zu speichern.", true);
      return;
    }

    setSettingsControlsDisabled(true);
    setSettingsMessage("Einstellung wird gespeichert...", true);

    try {
      await userDoc.set(payload, { merge: true });
      mergeUserDocCache(user.uid, {
        email: payload.email,
        displayName: payload.displayName,
        firstName: payload.firstName,
        lastName: payload.lastName,
        keepPersonalDataUntilRevoked: payload.keepPersonalDataUntilRevoked,
        privateProfile: payload.privateProfile,
        publicProfile: payload.publicProfile,
        consentTextVersion: payload.consentTextVersion
      });
      rememberCurrentSettings();
      setSettingsMessage("Einstellung gespeichert.", true);
    } catch (error) {
      restoreRememberedSettings();
      setSettingsMessage(translateFirestoreError(error), false);
    } finally {
      setSettingsControlsDisabled(false);
    }
  }

  async function initLinkRequest(auth, userData, claims) {
    const controls = getLinkRequestControls();

    if (!controls.form) {
      return;
    }

    if (!window.firebase.firestore) {
      setLinkRequestControlsDisabled(true);
      setLinkRequestMessage("Firestore ist noch nicht geladen.", false);
      return;
    }

    const db = window.firebase.firestore();
    const requiredSetup = requiresAccountSetup(userData, claims);
    controls.form.dataset.requiredSetup = String(requiredSetup);
    const capturedName = requiredSetup && userData.loginNameCaptured === true
      && normalizeNamePart(userData.firstName) && normalizeNamePart(userData.lastName);
    const nameStep = controls.form.querySelector("[data-link-name-step]");
    if (nameStep) {
      if (capturedName) {
        nameStep.removeAttribute("data-link-request-step");
        nameStep.hidden = true;
        nameStep.setAttribute("aria-hidden", "true");
      } else nameStep.setAttribute("data-link-request-step", "");
      controls.steps = Array.from(controls.form.querySelectorAll("[data-link-request-step]"));
    }
    const brand = document.querySelector(".site-header .brand");
    if (requiredSetup) {
      document.title = "Konto einrichten – Lifesaving Baden";
      updateText("[data-setup-eyebrow], [data-setup-title]", "Konto einrichten");
      updateText("[data-setup-description]", capturedName
        ? "Dein Name ist bereits gespeichert. Alle weiteren Angaben kannst du überspringen und später ergänzen."
        : "Vorname und Nachname sind erforderlich. Alle weiteren Angaben kannst du überspringen und später ergänzen.");
      document.querySelector("[data-link-progress]")?.setAttribute("aria-label", "Fortschritt der Kontoeinrichtung");
      const lastStep = controls.steps[controls.steps.length - 1];
      lastStep.dataset.stepLabel = "Prüfen & speichern";
      lastStep.querySelector("h3 span").textContent = "Prüfen & speichern";
      brand?.removeAttribute("href");
      brand?.setAttribute("aria-disabled", "true");
      document.querySelectorAll("[data-account-open], [data-link-return]").forEach((element) => { element.hidden = true; });
      document.querySelectorAll("[data-account-setup-save], [data-account-setup-logout], [data-account-setup-link-help]").forEach((element) => { element.hidden = false; });
      controls.submitButton.textContent = "Speichern und Verknüpfung beantragen";
    } else {
      brand?.setAttribute("href", "app.html");
    }

    if (!controls.form.dataset.listenerAttached) {
      controls.form.dataset.listenerAttached = "true";
      initLinkRequestSteps(controls.form);
      controls.form.addEventListener("submit", (event) => {
        if (controls.form.dataset.busy === "true") {
          event.preventDefault();
          return;
        }
        const currentStep = getLinkRequestCurrentStep(controls.form);

        if (currentStep < getLinkRequestControls().steps.length - 1) {
          event.preventDefault();
          goToNextLinkRequestStep(controls.form);
          return;
        }

        if (requiredSetup && event.submitter?.hasAttribute("data-account-setup-save")) {
          event.preventDefault();
          saveAccountSetup(auth, db, controls.form);
        } else {
          submitLinkRequest(event, auth, db);
        }
      });
      controls.form.querySelector("[data-link-request-preview-withdraw]")?.addEventListener("click", (event) => {
        withdrawLinkRequestFromForm(auth, db, controls.form, event.currentTarget);
      });
    }

    await loadLinkRequest(auth, db, userData);
  }

  async function saveAccountSetup(auth, db, form) {
    const user = auth.currentUser;
    if (!user || form.dataset.requiredSetup !== "true") return;
    const details = getLinkRequestEditableDetails(form);
    const name = normalizeNameDetails(details);
    if (!name.firstName || !name.lastName) {
      setLinkRequestMessage("Bitte fülle Vorname und Nachname aus.", false);
      showLinkRequestStep(form, 0);
      return;
    }
    if (details.identityHint.length > 200 || (details.gender && !["maennlich", "weiblich"].includes(details.gender))) {
      setLinkRequestMessage("Bitte prüfe deine Angaben.", false);
      return;
    }
    const button = form.querySelector("[data-account-setup-save]");
    try {
      setLinkRequestControlsDisabled(true);
      setLoading(button, true, "Speichern...");
      requireCurrentUser(user);
      const payload = {
        ...name,
        birthDate: details.birthDate,
        dlrgBranch: details.dlrgBranch,
        gender: details.gender,
        personLinkIdentityHint: details.identityHint,
        accountSetupRequired: false,
        profileDetailsUpdatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      };
      await db.collection("users").doc(user.uid).update(payload);
      requireCurrentUser(user);
      mergeUserDocCache(user.uid, payload);
      redirectToApp();
    } catch (error) {
      setLinkRequestMessage(translateFirestoreError(error), false);
    } finally {
      setLoading(button, false);
      setLinkRequestControlsDisabled(false);
    }
  }

  async function withdrawLinkRequestFromForm(auth, db, form, button) {
    const user = auth.currentUser;

    if (!user) {
      setLinkRequestMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    try {
      const fieldValue = window.firebase.firestore.FieldValue;

      setLoading(button, true, "Ziehe zurück...");
      setLinkRequestControlsDisabled(true);
      await db.collection("users").doc(user.uid).update({
        personLinkStatus: "open",
        personLinkRequest: fieldValue.delete(),
        personLinkIdentityHint: fieldValue.delete(),
        updatedAt: fieldValue.serverTimestamp()
      });

      const data = { ...(readUserDocCache(user.uid) || {}) };

      data.personLinkStatus = "open";
      delete data.personLinkRequest;
      delete data.personLinkIdentityHint;
      writeUserDocCache(user.uid, data);
      updateLinkStatusUi(data);
      await loadLinkRequest(auth, db, data);
    } catch (error) {
      setLinkRequestMessage(translateFirestoreError(error), false);
    } finally {
      setLoading(button, false);
      if (!isPersonLinked(readUserDocCache(user.uid))) {
        setLinkRequestControlsDisabled(false);
      }
    }
  }

  function getLinkRequestCurrentStep(form) {
    const stepIndex = Number.parseInt(form?.dataset.currentStep || "0", 10);

    return Number.isFinite(stepIndex) ? stepIndex : 0;
  }

  function shouldOpenLinkRequestEditor() {
    return new URLSearchParams(window.location.search).get("edit") === "1";
  }

  function getLinkRequestEditableDetails(form) {
    return {
      firstName: form?.elements.firstName?.value.trim() || "",
      lastName: form?.elements.lastName?.value.trim() || "",
      gender: form?.querySelector('[name="gender"]:checked')?.value || "",
      birthDate: form?.elements.birthDate?.value || "",
      dlrgBranch: normalizeDlrgBranchName(form?.elements.dlrgBranch?.value),
      identityHint: form?.elements.identityHint?.value.trim() || ""
    };
  }

  function rememberLinkRequestBaseline(form) {
    if (form) {
      form.dataset.linkRequestBaseline = JSON.stringify(getLinkRequestEditableDetails(form));
    }
  }

  function getLinkRequestBaseline(form) {
    if (!form?.dataset.linkRequestBaseline) {
      return null;
    }

    try {
      return JSON.parse(form.dataset.linkRequestBaseline);
    } catch (error) {
      return null;
    }
  }

  function getChangedLinkRequestFields(form) {
    const baseline = getLinkRequestBaseline(form);
    const currentDetails = getLinkRequestEditableDetails(form);

    if (!baseline) {
      return Object.keys(currentDetails);
    }

    return Object.keys(currentDetails).filter((fieldName) => currentDetails[fieldName] !== baseline[fieldName]);
  }

  function updateLinkRequestSummary(form) {
    if (!form) {
      return;
    }

    const firstName = form.elements.firstName?.value.trim() || "";
    const lastName = form.elements.lastName?.value.trim() || "";
    const gender = form.querySelector('[name="gender"]:checked')?.value || "";
    const setSummaryText = (selector, value) => {
      const element = form.querySelector(selector);

      if (element) {
        element.textContent = value;
      }
    };

    setSummaryText("[data-link-summary-name]", `${firstName} ${lastName}`.trim() || "Nicht angegeben");
    setSummaryText("[data-link-summary-gender]", gender
      ? formatProfileFieldValue("gender", gender)
      : "");
    setSummaryText("[data-link-summary-birth-date]", formatBirthDate(form.elements.birthDate?.value) || "Nicht angegeben");
    setSummaryText("[data-link-summary-branch]", normalizeDlrgBranchName(form.elements.dlrgBranch?.value) || "Nicht angegeben");
    setSummaryText("[data-link-summary-identity-hint]", form.elements.identityHint?.value.trim() || "");
    if (form.dataset.requiredSetup === "true") {
      form.querySelector("[data-account-setup-save]").disabled = form.dataset.busy === "true" || !firstName || !lastName;
      form.querySelector("[data-link-submit]").disabled = form.dataset.busy === "true"
        || !firstName || !lastName || !gender || !form.elements.birthDate.value || !form.elements.dlrgBranch.value.trim()
        || !form.elements.identityConfirmation.checked || form.dataset.alreadyLinked === "true";
    }
  }

  function showLinkRequestStep(form, nextStepIndex, shouldFocus = true) {
    const steps = Array.from(form?.querySelectorAll("[data-link-request-step]") || []);

    if (!form || !steps.length) {
      return;
    }

    const stepIndex = Math.max(0, Math.min(nextStepIndex, steps.length - 1));
    const progress = document.querySelector("[data-link-progress]");
    const progressBar = document.querySelector("[data-link-progress-bar]");
    const currentStepText = document.querySelector("[data-link-step-current]");
    const totalStepText = document.querySelector("[data-link-step-total]");
    const stepLabel = document.querySelector("[data-link-step-label]");

    form.dataset.currentStep = String(stepIndex);
    steps.forEach((step, index) => {
      const isActive = index === stepIndex;

      step.hidden = !isActive;
      step.setAttribute("aria-hidden", String(!isActive));
    });

    if (currentStepText) {
      currentStepText.textContent = String(stepIndex + 1);
    }

    if (totalStepText) {
      totalStepText.textContent = String(steps.length);
    }

    if (stepLabel) {
      stepLabel.textContent = steps[stepIndex].dataset.stepLabel || "";
    }

    if (progress) {
      progress.setAttribute("aria-valuemax", String(steps.length));
      progress.setAttribute("aria-valuenow", String(stepIndex + 1));
    }

    if (progressBar) {
      progressBar.style.width = `${((stepIndex + 1) / steps.length) * 100}%`;
    }

    updateLinkRequestSummary(form);

    if (stepIndex === steps.length - 1 && form.dataset.editingExistingRequest === "true") {
      const hasChanges = getChangedLinkRequestFields(form).length > 0;

      setLinkRequestPreviewMode(form, !hasChanges);
      if (!hasChanges) {
        delete form.dataset.editingExistingRequest;
      }
    }

    if (shouldFocus) {
      window.requestAnimationFrame(() => steps[stepIndex].querySelector("h3")?.focus());
    }
  }

  function validateLinkRequestStep(step) {
    const invalidControl = Array.from(step?.querySelectorAll("input, textarea, select") || [])
      .find((control) => !control.checkValidity());

    if (!invalidControl) {
      return true;
    }

    invalidControl.reportValidity();
    return false;
  }

  function goToNextLinkRequestStep(form) {
    const steps = Array.from(form?.querySelectorAll("[data-link-request-step]") || []);
    const currentStep = getLinkRequestCurrentStep(form);

    if (!steps[currentStep] || !validateLinkRequestStep(steps[currentStep])) {
      return;
    }

    showLinkRequestStep(form, currentStep + 1);
  }

  function setLinkRequestPreviewMode(form, isPreview) {
    const steps = Array.from(form?.querySelectorAll("[data-link-request-step]") || []);
    const summaryStep = steps[steps.length - 1];
    const backButton = summaryStep?.querySelector("[data-link-step-back]");
    const editButton = summaryStep?.querySelector("[data-link-request-edit]");
    const withdrawButton = summaryStep?.querySelector("[data-link-request-preview-withdraw]");
    const submitButton = summaryStep?.querySelector("[data-link-submit]");
    const confirmation = summaryStep?.querySelector("[data-link-request-confirmation]");
    const confirmationInput = confirmation?.querySelector('[name="identityConfirmation"]');

    if (!form || !summaryStep || !editButton) {
      return;
    }

    form.dataset.previewMode = String(isPreview);

    [backButton, submitButton].forEach((button) => {
      if (!button) {
        return;
      }

      button.hidden = isPreview;
      button.setAttribute("aria-hidden", String(isPreview));
    });

    editButton.hidden = !isPreview;
    editButton.setAttribute("aria-hidden", String(!isPreview));

    if (withdrawButton) {
      withdrawButton.hidden = !isPreview;
      withdrawButton.setAttribute("aria-hidden", String(!isPreview));
    }

    if (confirmation) {
      confirmation.hidden = false;
      confirmation.setAttribute("aria-hidden", "false");
    }

    if (confirmationInput) {
      if (isPreview) {
        confirmationInput.checked = form.dataset.linkRequestIdentityConfirmed === "true";
      }
      confirmationInput.disabled = isPreview;
    }
  }

  function initLinkRequestSteps(form) {
    if (!form || form.dataset.stepNavigationAttached) {
      return;
    }

    form.dataset.stepNavigationAttached = "true";

    form.querySelectorAll("[data-link-step-next]").forEach((button) => {
      button.addEventListener("click", () => goToNextLinkRequestStep(form));
    });

    form.querySelectorAll("[data-link-step-back]").forEach((button) => {
      button.addEventListener("click", () => {
        showLinkRequestStep(form, getLinkRequestCurrentStep(form) - 1);
      });
    });

    form.querySelector("[data-link-request-edit]")?.addEventListener("click", () => {
      form.dataset.editingExistingRequest = "true";
      if (form.elements.identityConfirmation) {
        form.elements.identityConfirmation.checked = false;
      }
      setLinkRequestPreviewMode(form, false);
      showLinkRequestStep(form, 0);
    });

    form.querySelectorAll('[name="gender"]').forEach((control) => {
      const rememberCheckedState = () => {
        control.dataset.wasChecked = String(control.checked);
      };

      control.addEventListener("pointerdown", rememberCheckedState);
      control.closest("label")?.addEventListener("pointerdown", rememberCheckedState);
      control.addEventListener("click", () => {
        if (control.dataset.wasChecked === "true") {
          control.checked = false;
        }

        delete control.dataset.wasChecked;
        updateLinkRequestSummary(form);
      });
      control.addEventListener("keydown", (event) => {
        if (event.key !== " " || !control.checked) {
          return;
        }

        event.preventDefault();
        control.checked = false;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });

    form.querySelectorAll("input, textarea").forEach((control) => {
      control.addEventListener("input", () => updateLinkRequestSummary(form));
      control.addEventListener("change", () => updateLinkRequestSummary(form));

      if (control.tagName !== "TEXTAREA") {
        control.addEventListener("keydown", (event) => {
          if (
            event.key === "Enter"
            && control.name !== "gender"
            && getLinkRequestCurrentStep(form) < form.querySelectorAll("[data-link-request-step]").length - 1
          ) {
            event.preventDefault();
            goToNextLinkRequestStep(form);
          }
        });
      }
    });

    showLinkRequestStep(form, 0, false);
  }

  function getLinkRequestControls() {
    const form = document.querySelector("[data-link-request-form]");

    return {
      form,
      steps: Array.from(form?.querySelectorAll("[data-link-request-step]") || []),
      firstName: form?.querySelector('[name="firstName"]'),
      lastName: form?.querySelector('[name="lastName"]'),
      genderInputs: Array.from(form?.querySelectorAll('[name="gender"]') || []),
      birthDate: form?.querySelector('[name="birthDate"]'),
      dlrgBranch: form?.querySelector('[name="dlrgBranch"]'),
      identityHint: form?.querySelector('[name="identityHint"]'),
      identityConfirmation: form?.querySelector('[name="identityConfirmation"]'),
      submitButton: form?.querySelector("[data-link-submit]")
    };
  }

  function setLinkRequestControlsDisabled(isDisabled) {
    const controls = getLinkRequestControls();

    if (!controls.form) {
      return;
    }

    controls.form.dataset.busy = String(isDisabled);
    controls.form.querySelectorAll("input, textarea, select, button").forEach((control) => {
      const isPreviewConfirmation = control.name === "identityConfirmation"
        && controls.form.dataset.previewMode === "true";

      control.disabled = isDisabled || isPreviewConfirmation;
    });
    if (!isDisabled) updateLinkRequestSummary(controls.form);
  }

  async function loadLinkRequest(auth, db, userData) {
    const controls = getLinkRequestControls();
    const user = auth.currentUser;

    if (!controls.form || !user) {
      return;
    }

    setLinkRequestControlsDisabled(true);

    try {
      let data = userData || await loadCurrentUserData(user) || {};

      data = await cleanupLegacyLinkRequestFields(user, data);
      data = await cleanupInactiveLinkRequestData(user, data);
      const request = data.personLinkRequest || null;
      controls.form.dataset.alreadyLinked = String(isPersonLinked(data));

      if (isPersonLinked(data) && controls.form.dataset.requiredSetup !== "true") {
        setLinkRequestControlsDisabled(true);
        setLinkRequestMessage("Dieses Konto ist bereits mit der Datenbank verknüpft.", true);
        return;
      }

      if (request && controls.form.dataset.requiredSetup !== "true") {
        await syncProfileDetailsFromLinkRequest(user, data);
        const nameDetails = getNameDetailsFromData(data, user);

        controls.firstName.value = request.firstName || nameDetails.firstName || "";
        controls.lastName.value = request.lastName || nameDetails.lastName || "";
        controls.genderInputs.forEach((input) => {
          input.checked = input.value === request.gender;
        });
        controls.birthDate.value = data.birthDate || "";
        controls.dlrgBranch.value = normalizeDlrgBranchName(data.dlrgBranch);
        controls.identityHint.value = getLinkRequestIdentityHint(request, data).slice(0, 200);
        const identityConfirmed = request.identityConfirmed !== false;

        controls.form.dataset.linkRequestIdentityConfirmed = String(identityConfirmed);
        if (controls.identityConfirmation) {
          controls.identityConfirmation.checked = identityConfirmed;
        }
        rememberLinkRequestBaseline(controls.form);
        delete controls.form.dataset.editingExistingRequest;
        setLinkRequestMessage(
          request.status === "rejected"
            ? "Letzter Antrag wurde abgelehnt. Du kannst die Angaben prüfen und erneut absenden."
            : request.status === "withdrawn"
              ? "Letzter Antrag wurde zurückgezogen. Du kannst die Angaben prüfen und erneut absenden."
            : "Letzter Antrag ist gespeichert.",
          true
        );
        if (shouldOpenLinkRequestEditor()) {
          controls.form.dataset.editingExistingRequest = "true";
          if (controls.identityConfirmation) {
            controls.identityConfirmation.checked = false;
          }
          setLinkRequestPreviewMode(controls.form, false);
          showLinkRequestStep(controls.form, 0, false);
        } else {
          setLinkRequestPreviewMode(controls.form, true);
          showLinkRequestStep(controls.form, controls.steps.length - 1, false);
        }
      } else {
        const nameDetails = getNameDetailsFromData(data, user);

        controls.firstName.value = nameDetails.firstName || "";
        controls.lastName.value = nameDetails.lastName || "";
        controls.genderInputs.forEach((input) => {
          input.checked = input.value === data.gender;
        });
        controls.birthDate.value = data.birthDate || "";
        controls.dlrgBranch.value = normalizeDlrgBranchName(data.dlrgBranch);
        controls.identityHint.value = getLinkRequestIdentityHint({}, data);
        delete controls.form.dataset.linkRequestIdentityConfirmed;
        if (controls.identityConfirmation) {
          controls.identityConfirmation.checked = false;
        }
        delete controls.form.dataset.linkRequestBaseline;
        delete controls.form.dataset.editingExistingRequest;
        setLinkRequestPreviewMode(controls.form, false);
        showLinkRequestStep(controls.form, 0, false);
      }
    } catch (error) {
      setLinkRequestMessage(translateFirestoreError(error), false);
    } finally {
      if (!isPersonLinked(readUserDocCache(user.uid))) {
        setLinkRequestControlsDisabled(false);
      }
      updateLinkRequestSummary(controls.form);
    }
  }

  async function submitLinkRequest(event, auth, db) {
    event.preventDefault();

    const controls = getLinkRequestControls();
    const user = auth.currentUser;

    if (!controls.form || !user) {
      setLinkRequestMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    const editableDetails = getLinkRequestEditableDetails(controls.form);
    const details = {
      ...editableDetails,
      accountEmail: user.email || "",
      accountName: getAccountName(user) || formatFullName(editableDetails.firstName, editableDetails.lastName),
      accountUid: user.uid
    };
    const cachedData = readUserDocCache(user.uid) || {};
    const isUpdatingExistingRequest = Boolean(
      getLinkRequestBaseline(controls.form)
      && cachedData.personLinkRequest?.status === "requested"
    );
    const changedFields = isUpdatingExistingRequest
      ? getChangedLinkRequestFields(controls.form)
      : Object.keys(editableDetails);

    if (details.identityHint.length > 200) {
      setLinkRequestMessage("Die Identitätsinfo darf maximal 200 Zeichen haben.", false);
      return;
    }

    if (details.gender && !["maennlich", "weiblich"].includes(details.gender)) {
      setLinkRequestMessage("Bitte wähle eine gültige Geschlechtsangabe aus oder überspringe den Schritt.", false);
      return;
    }

    if (!details.firstName || !details.lastName || !details.gender || !details.birthDate || !details.dlrgBranch) {
      setLinkRequestMessage("Bitte fülle Vorname, Nachname, Geschlecht, Geburtsdatum und DLRG-Gliederung aus.", false);
      return;
    }

    if (isPersonLinked(readUserDocCache(user.uid))) {
      setLinkRequestMessage("Dieses Konto ist bereits mit der Datenbank verknüpft.", false);
      return;
    }

    if (isUpdatingExistingRequest && !changedFields.length) {
      delete controls.form.dataset.editingExistingRequest;
      setLinkRequestPreviewMode(controls.form, true);
      showLinkRequestStep(controls.form, controls.steps.length - 1, false);
      return;
    }

    if (!controls.identityConfirmation?.checked) {
      setLinkRequestMessage("Bitte bestätige deine Angaben vor dem Absenden.", false);
      return;
    }

    const fieldValue = window.firebase.firestore.FieldValue;

    try {
      controls.dlrgBranch.value = details.dlrgBranch;
      setLinkRequestControlsDisabled(true);
      setLoading(
        controls.submitButton,
        true,
        isUpdatingExistingRequest ? "Änderungen speichern..." : "Antrag speichern..."
      );

      let requestCacheData;
      let userCacheData;
      let updatePayload;

      if (isUpdatingExistingRequest) {
        requestCacheData = { ...cachedData.personLinkRequest };
        userCacheData = {};
        updatePayload = {
          "personLinkRequest.identityConfirmed": true,
          "personLinkRequest.identityConfirmedAt": fieldValue.serverTimestamp(),
          "personLinkRequest.updatedAt": fieldValue.serverTimestamp(),
          updatedAt: fieldValue.serverTimestamp()
        };
        requestCacheData.identityConfirmed = true;

        changedFields.forEach((fieldName) => {
          const value = editableDetails[fieldName];

          if (fieldName === "gender") {
            updatePayload["personLinkRequest.gender"] = value || fieldValue.delete();
            if (value) {
              updatePayload.gender = value;
              userCacheData.gender = value;
              requestCacheData.gender = value;
            } else {
              delete requestCacheData.gender;
            }
            return;
          }

          updatePayload[`personLinkRequest.${fieldName}`] = value;
          requestCacheData[fieldName] = value;

          if (fieldName === "birthDate" || fieldName === "dlrgBranch") {
            updatePayload[fieldName] = value;
            userCacheData[fieldName] = value;
          } else if (fieldName === "identityHint") {
            updatePayload.personLinkIdentityHint = value;
            userCacheData.personLinkIdentityHint = value;
          }
        });

        if (changedFields.some((fieldName) => ["birthDate", "dlrgBranch", "gender"].includes(fieldName))) {
          updatePayload.profileDetailsUpdatedAt = fieldValue.serverTimestamp();
        }

        userCacheData.personLinkRequest = requestCacheData;
      } else {
        requestCacheData = {
          ...details,
          identityConfirmed: true,
          status: "requested"
        };
        if (!details.gender) {
          delete requestCacheData.gender;
        }
        userCacheData = {
          dlrgBranch: details.dlrgBranch,
          birthDate: details.birthDate,
          ...(details.gender ? { gender: details.gender } : {}),
          personLinkIdentityHint: details.identityHint,
          personLinkStatus: "requested",
          personLinkRequest: requestCacheData
        };
        updatePayload = {
          dlrgBranch: details.dlrgBranch,
          birthDate: details.birthDate,
          personLinkIdentityHint: details.identityHint,
          profileDetailsUpdatedAt: fieldValue.serverTimestamp(),
          personLinkStatus: "requested",
          "personLinkRequest.firstName": details.firstName,
          "personLinkRequest.lastName": details.lastName,
          "personLinkRequest.gender": details.gender || fieldValue.delete(),
          "personLinkRequest.birthDate": details.birthDate,
          "personLinkRequest.dlrgBranch": details.dlrgBranch,
          "personLinkRequest.identityHint": details.identityHint,
          "personLinkRequest.identityConfirmed": true,
          "personLinkRequest.identityConfirmedAt": fieldValue.serverTimestamp(),
          "personLinkRequest.accountEmail": details.accountEmail,
          "personLinkRequest.accountName": details.accountName,
          "personLinkRequest.accountUid": details.accountUid,
          "personLinkRequest.status": "requested",
          "personLinkRequest.requestedAt": fieldValue.serverTimestamp(),
          "personLinkRequest.updatedAt": fieldValue.serverTimestamp(),
          "personLinkRequest.firstCompetition": fieldValue.delete(),
          "personLinkRequest.lastCompetition": fieldValue.delete(),
          "personLinkRequest.decidedByUid": fieldValue.delete(),
          "personLinkRequest.decidedByEmail": fieldValue.delete(),
          "personLinkRequest.decidedAt": fieldValue.delete(),
          "personLinkRequest.withdrawnAt": fieldValue.delete(),
          updatedAt: fieldValue.serverTimestamp()
        };

        if (details.gender) {
          updatePayload.gender = details.gender;
        }
      }

      if (controls.form.dataset.requiredSetup === "true") {
        const setup = { ...normalizeNameDetails(details), accountSetupRequired: false };
        Object.assign(updatePayload, setup);
        Object.assign(userCacheData, setup);
      }
      const userDoc = db.collection("users").doc(user.uid);
      if (getAccountName(user) || controls.form.dataset.requiredSetup === "true") {
        await userDoc.update(updatePayload);
      } else {
        const savedName = await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(userDoc);
          requireCurrentUser(user);
          const currentName = getNameDetailsFromData(snapshot.data(), user);
          const name = currentName.displayName ? currentName : normalizeNameDetails(details);
          transaction.update(userDoc, currentName.displayName ? updatePayload : { ...updatePayload, ...name });
          return name;
        });
        Object.assign(userCacheData, savedName);
      }

      updateLinkStatusUi(mergeUserDocCache(user.uid, userCacheData));
      clearUserDocCache(user.uid);
      setLinkRequestMessage("Antrag gespeichert. Er ist jetzt im Adminbereich sichtbar.", true);
      redirectToApp();
    } catch (error) {
      setLinkRequestMessage(translateFirestoreError(error), false);
    } finally {
      setLoading(controls.submitButton, false);
      setLinkRequestControlsDisabled(false);
    }
  }
})();
