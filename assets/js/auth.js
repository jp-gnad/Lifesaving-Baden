(function () {
  const page = document.body.dataset.page;
  const appUrl = "app.html";
  const loginUrl = "login.html";

  function getVerificationRedirectUrl() {
    return new URL("login.html?verified=1", window.location.href).href;
  }

  function getLoginRedirectUrl() {
    return new URL("login.html", window.location.href).href;
  }

  function redirectToApp() {
    window.location.href = appUrl;
  }

  function redirectToLogin(reason) {
    const target = new URL(loginUrl, window.location.href);

    if (reason) {
      target.searchParams.set(reason, "1");
    }

    window.location.href = target.href;
  }

  function setMessage(type, text, isSuccess) {
    const message = document.querySelector(`[data-form-message="${type}"]`);

    if (!message) {
      return;
    }

    message.textContent = text;
    message.classList.toggle("success", Boolean(isSuccess));
  }

  function setLoading(button, isLoading, loadingLabel) {
    if (!button) {
      return;
    }

    if (!button.dataset.defaultHtml) {
      button.dataset.defaultHtml = button.innerHTML;
    }

    button.disabled = isLoading;
    button.innerHTML = isLoading ? loadingLabel : button.dataset.defaultHtml;
  }

  function showTab(tabName) {
    document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
      const isActive = tab.dataset.authTab === tabName;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });

    document.querySelectorAll("[data-auth-form]").forEach((form) => {
      form.classList.toggle("is-hidden", form.dataset.authForm !== tabName);
    });
  }

  function initTabs() {
    document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
      tab.addEventListener("click", () => showTab(tab.dataset.authTab));
    });
  }

  function showResendButton(show) {
    const resendButton = document.querySelector("[data-resend-verification]");

    if (resendButton) {
      resendButton.classList.toggle("is-hidden", !show);
    }
  }

  function translateAuthError(error) {
    const messages = {
      "auth/email-already-in-use": "Diese E-Mail ist bereits registriert.",
      "auth/account-exists-with-different-credential": "Diese E-Mail ist bereits mit einer anderen Login-Methode registriert.",
      "auth/credential-already-in-use": "Dieses Google-Konto ist bereits mit einem anderen Konto verbunden.",
      "auth/invalid-credential": "E-Mail oder Passwort stimmt nicht.",
      "auth/invalid-email": "Bitte gib eine gültige E-Mail-Adresse ein.",
      "auth/network-request-failed": "Firebase ist gerade nicht erreichbar.",
      "auth/operation-not-allowed": "Dieser Login-Anbieter ist in Firebase noch nicht aktiviert.",
      "auth/popup-blocked": "Das Google-Popup wurde vom Browser blockiert.",
      "auth/popup-closed-by-user": "Google-Login wurde abgebrochen.",
      "auth/provider-already-linked": "Dieses Konto ist bereits mit diesem Anbieter verbunden.",
      "auth/requires-recent-login": "Bitte melde dich neu an und versuche es direkt danach erneut.",
      "auth/too-many-requests": "Zu viele Versuche. Bitte später erneut probieren.",
      "auth/unauthorized-domain": "Diese Domain ist in Firebase noch nicht freigegeben.",
      "auth/user-disabled": "Dieses Konto wurde deaktiviert.",
      "auth/user-mismatch": "Die erneute Anmeldung gehört nicht zu diesem Konto.",
      "auth/user-not-found": "E-Mail oder Passwort stimmt nicht.",
      "auth/weak-password": "Das Passwort muss mindestens 6 Zeichen haben.",
      "auth/wrong-password": "E-Mail oder Passwort stimmt nicht."
    };

    return messages[error.code] || "Der Login ist fehlgeschlagen. Bitte prüfe die Eingaben.";
  }

  function translateFirestoreError(error) {
    const messages = {
      "permission-denied": "Firestore-Regeln erlauben diese Aktion noch nicht.",
      "unavailable": "Firestore ist gerade nicht erreichbar.",
      "unauthenticated": "Bitte logge dich erneut ein."
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

  function disableAuthControls() {
    document
      .querySelectorAll('[data-auth-form] button, [data-google-login], [data-resend-verification], [data-reset-password]')
      .forEach((button) => {
        button.disabled = true;
      });
  }

  function canUseFirebase() {
    if (window.location.protocol === "file:") {
      setMessage(
        "login",
        "Bitte öffne die Seite über GitHub Pages oder einen lokalen HTTP-Server, nicht per Doppelklick als Datei."
      );
      disableAuthControls();
      return false;
    }

    if (!window.isFirebaseConfigured) {
      setMessage(
        "login",
        "Firebase ist noch nicht konfiguriert. Prüfe assets/js/firebase-config.js."
      );
      disableAuthControls();
      return false;
    }

    if (!window.firebase || !window.firebase.auth) {
      setMessage(
        "login",
        "Firebase konnte nicht geladen werden. Prüfe Internetverbindung, Browser-Blocker oder die Firebase-Skripte."
      );
      disableAuthControls();
      return false;
    }

    return true;
  }

  function initFirebase() {
    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(window.firebaseConfig);
    }

    return window.firebase.auth();
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

  function getUserIdentityData(user) {
    return {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "",
      emailVerified: Boolean(user.emailVerified),
      providerIds: getProviderIds(user)
    };
  }

  function getChangedIdentityFields(data, identity) {
    const changes = {};

    Object.entries(identity).forEach(([key, value]) => {
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

  function initPasswordVisibilityToggles() {
    document.querySelectorAll("[data-password-toggle]").forEach((button) => {
      if (button.dataset.listenerAttached) {
        return;
      }

      const field = button.closest(".password-field");
      const input = field?.querySelector('input[type="password"], input[type="text"]');

      if (!input) {
        return;
      }

      button.dataset.listenerAttached = "true";

      function setVisible(isVisible) {
        input.type = isVisible ? "text" : "password";
        button.setAttribute("aria-pressed", String(isVisible));
        button.setAttribute("aria-label", isVisible ? "Passwort ausblenden" : "Passwort anzeigen");
        button.title = isVisible ? "Passwort ausblenden" : "Passwort anzeigen";
      }

      button.addEventListener("click", () => {
        const isVisible = input.type === "password";
        setVisible(isVisible);
        input.focus({ preventScroll: true });
      });

      setVisible(false);
    });
  }

  initPasswordVisibilityToggles();

  if (page === "login") {
    initTabs();

    if (!canUseFirebase()) {
      return;
    }

    const auth = initFirebase();
    const googleProvider = new window.firebase.auth.GoogleAuthProvider();

    googleProvider.setCustomParameters({
      prompt: "select_account"
    });

    initLoginPage(auth, googleProvider);
  }

  if (page === "app" || page === "settings" || page === "link-request") {
    if (window.location.protocol === "file:" || !window.isFirebaseConfigured || !window.firebase?.auth) {
      redirectToLogin();
      return;
    }

    initAppPage(initFirebase());
  }

  if (page === "settings") {
    initSettingsMenu();
  }

  function initLoginPage(auth, googleProvider) {
    const params = new URLSearchParams(window.location.search);
    const loginForm = document.querySelector('[data-auth-form="login"]');
    const registerForm = document.querySelector('[data-auth-form="register"]');
    const googleButton = document.querySelector("[data-google-login]");
    const resendButton = document.querySelector("[data-resend-verification]");
    const resetPasswordButton = document.querySelector("[data-reset-password]");
    let loginRedirectStarted = false;

    async function finishVerifiedLogin(user) {
      if (loginRedirectStarted) {
        return;
      }

      loginRedirectStarted = true;
      await ensureUserDocument(user);
      redirectToApp();
    }

    if (params.has("verified")) {
      setMessage("login", "E-Mail bestätigt. Du kannst jetzt den Login nutzen.", true);
    }

    if (params.has("needsVerification")) {
      setMessage("login", "Bitte bestätige zuerst deine E-Mail-Adresse.");
    }

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        showResendButton(false);
        return;
      }

      await user.reload();

      if (hasVerifiedAccess(auth.currentUser)) {
        await finishVerifiedLogin(auth.currentUser || user);
        return;
      }

      showResendButton(true);
      setMessage("login", "Bitte bestätige deine E-Mail-Adresse, bevor du fortfährst.");
    });

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const button = loginForm.querySelector('button[type="submit"]');
      const formData = new FormData(loginForm);
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");

      try {
        setLoading(button, true, "Login...");
        const { user } = await auth.signInWithEmailAndPassword(email, password);

        await user.reload();

        if (!hasVerifiedAccess(auth.currentUser)) {
          showResendButton(true);
          setMessage("login", "Bitte bestätige deine E-Mail-Adresse, bevor du fortfährst.");
          return;
        }

        await finishVerifiedLogin(auth.currentUser || user);
      } catch (error) {
        setMessage("login", translateAuthError(error));
      } finally {
        setLoading(button, false);
      }
    });

    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const button = registerForm.querySelector('button[type="submit"]');
      const formData = new FormData(registerForm);
      const name = String(formData.get("name") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");

      try {
        setLoading(button, true, "Konto erstellen...");
        const { user } = await auth.createUserWithEmailAndPassword(email, password);
        let firestoreError = null;

        await user.updateProfile({ displayName: name });

        try {
          await ensureUserDocument(auth.currentUser || user, { throwOnError: true });
        } catch (error) {
          firestoreError = error;
        }

        await user.sendEmailVerification({
          url: getVerificationRedirectUrl()
        });

        showTab("login");
        showResendButton(true);
        setMessage(
          "login",
          firestoreError
            ? `Konto erstellt, aber der Firestore-Eintrag fehlt noch: ${translateFirestoreError(firestoreError)}`
            : "Konto erstellt. Bitte bestätige deine E-Mail-Adresse. Danach schließen wir die Kontokonfiguration ab.",
          !firestoreError
        );
        registerForm.reset();
      } catch (error) {
        setMessage("register", translateAuthError(error));
      } finally {
        setLoading(button, false);
      }
    });

    googleButton.addEventListener("click", async () => {
      try {
        setLoading(googleButton, true, "Google öffnet...");
        const { user } = await auth.signInWithPopup(googleProvider);
        await finishVerifiedLogin(user);
      } catch (error) {
        setMessage("login", translateAuthError(error));
      } finally {
        setLoading(googleButton, false);
      }
    });

    resetPasswordButton.addEventListener("click", async () => {
      const email = String(new FormData(loginForm).get("email") || "").trim();

      if (!email) {
        setMessage("login", "Bitte gib zuerst deine E-Mail-Adresse ein.");
        return;
      }

      try {
        setLoading(resetPasswordButton, true, "Sende...");
        await auth.sendPasswordResetEmail(email, {
          url: getLoginRedirectUrl()
        });
        setMessage("login", "Passwort-E-Mail wurde gesendet. Bitte prüfe dein Postfach.", true);
      } catch (error) {
        setMessage("login", translateAuthError(error));
      } finally {
        setLoading(resetPasswordButton, false);
      }
    });

    resendButton.addEventListener("click", async () => {
      const user = auth.currentUser;

      if (!user) {
        setMessage("login", "Logge dich zuerst ein, um die Mail erneut zu senden.");
        return;
      }

      try {
        setLoading(resendButton, true, "Sende...");
        await user.sendEmailVerification({
          url: getVerificationRedirectUrl()
        });
        setMessage("login", "Bestätigungs-Mail wurde erneut gesendet.", true);
      } catch (error) {
        setMessage("login", translateAuthError(error));
      } finally {
        setLoading(resendButton, false);
      }
    });
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

      if (!options.keepHash && activeHash && window.location.hash !== activeHash) {
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
    const userName = document.querySelector("[data-user-name]");
    const logoutButtons = document.querySelectorAll("[data-logout]");
    const accountOpenButton = document.querySelector("[data-account-open]");
    const accountOverlay = document.querySelector("[data-account-overlay]");
    const accountCloseButton = document.querySelector("[data-account-close]");
    const deleteAccountButton = document.querySelector("[data-delete-account]");
    let settingsLoadedForUser = null;

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

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        redirectToLogin();
        return;
      }

      await user.reload();

      if (!hasVerifiedAccess(auth.currentUser)) {
        redirectToLogin("needsVerification");
        return;
      }

      if (userName) {
        userName.textContent = getAccountName(auth.currentUser);
      }

      updateAccountProfile(auth.currentUser);
      fillAccountManagementForms(auth.currentUser);
      updateGoogleProviderStatus(auth.currentUser);

      if (settingsLoadedForUser !== auth.currentUser.uid) {
        const userData = await ensureUserDocument(auth.currentUser);
        settingsLoadedForUser = auth.currentUser.uid;
        await initAccountManagement(auth, userData);
        await initUserSettings(auth, userData);
        await initLinkStatus(auth, userData);
        await initAdminStatus(auth, userData);
        await initLinkRequest(auth, userData);
      }
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
  }

  function setTextForAll(selector, text) {
    document.querySelectorAll(selector).forEach((element) => {
      element.textContent = text;
    });
  }

  function getAccountName(user) {
    if (user.displayName) {
      return user.displayName;
    }

    if (user.email) {
      return user.email.split("@")[0];
    }

    return "Mitglied";
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
    const photo = document.querySelector(photoSelector);
    const initials = document.querySelector(initialsSelector);

    if (!photo || !initials) {
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
  }

  function updateAccountProfile(user) {
    const accountName = getAccountName(user);
    const accountEmail = user.email || "Keine E-Mail geladen.";

    setTextForAll("[data-account-email]", accountEmail);
    setTextForAll("[data-account-name]", accountName);
    setTextForAll("[data-account-greeting-name]", accountName);
    setTextForAll("[data-link-account-email]", accountEmail);
    updateAvatar("[data-account-photo-small]", "[data-account-initials-small]", user);
    updateAvatar("[data-account-photo-large]", "[data-account-initials-large]", user);
  }

  async function ensureUserDocument(user, options = {}) {
    if (!user || !window.firebase.firestore) {
      return null;
    }

    const db = window.firebase.firestore();
    const fieldValue = window.firebase.firestore.FieldValue;
    const userDoc = db.collection("users").doc(user.uid);

    try {
      let data = options.forceRefresh ? null : readUserDocCache(user.uid);
      let exists = Boolean(data);

      if (!data) {
        const snapshot = await userDoc.get();
        exists = snapshot.exists;
        data = snapshot.exists ? snapshot.data() || {} : null;
      }

      const identity = getUserIdentityData(user);

      if (!exists) {
        const cacheData = {
          ...identity,
          role: "sportler",
          keepPersonalDataUntilRevoked: true,
          privateProfile: false,
          publicProfile: true
        };

        await userDoc.set({
          ...cacheData,
          updatedAt: fieldValue.serverTimestamp(),
          createdAt: fieldValue.serverTimestamp(),
          lastSignInAt: fieldValue.serverTimestamp()
        });
        return writeUserDocCache(user.uid, cacheData);
      }

      const updatePayload = getChangedIdentityFields(data, identity);

      if (!Object.prototype.hasOwnProperty.call(data, "role")) {
        updatePayload.role = "sportler";
      }

      if (Object.keys(updatePayload).length) {
        await userDoc.set({
          ...updatePayload,
          updatedAt: fieldValue.serverTimestamp()
        }, { merge: true });
        return mergeUserDocCache(user.uid, updatePayload);
      }

      return writeUserDocCache(user.uid, data);
    } catch (error) {
      if (options.throwOnError) {
        throw error;
      }

      console.warn("Firestore-Nutzerdokument konnte nicht angelegt oder aktualisiert werden.", error);
      return null;
    }
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
    return Boolean(data?.linkedPersonId || data?.personId);
  }

  function hasPendingLinkRequest(data) {
    const requestStatus = data?.personLinkRequest?.status;

    return Boolean(data?.personLinkStatus === "requested" || requestStatus === "requested");
  }

  function hasRejectedLinkRequest(data) {
    const requestStatus = data?.personLinkRequest?.status;

    return Boolean(data?.personLinkStatus === "rejected" || requestStatus === "rejected");
  }

  function hasChecklistValue(value) {
    return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
  }

  function getAccountChecklistItems(data) {
    const request = data?.personLinkRequest || {};
    const linked = isPersonLinked(data);
    const requestSubmitted = linked || hasPendingLinkRequest(data);
    const dlrgBranchAdded = hasChecklistValue(data?.dlrgBranch) || hasChecklistValue(request.dlrgBranch);
    const birthDateAdded = hasChecklistValue(data?.birthDate) || hasChecklistValue(request.birthDate);
    const genderAdded = hasChecklistValue(data?.gender);

    return [
      { key: "linkRequest", complete: requestSubmitted },
      { key: "linked", complete: linked },
      { key: "dlrgBranch", complete: dlrgBranchAdded },
      { key: "birthDate", complete: birthDateAdded },
      { key: "gender", complete: genderAdded }
    ];
  }

  function updateAccountChecklist(data) {
    const hasLoadedData = Boolean(data);
    const items = getAccountChecklistItems(data || {});
    const completed = items.filter((item) => item.complete).length;
    const total = items.length;
    const percentage = total ? Math.round((completed / total) * 100) : 0;

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
        count.textContent = `${completed} von ${total} abgeschlossen`;
      }

      if (progress) {
        progress.style.width = `${percentage}%`;
      }

      const shouldHide = completed === total;
      checklist.classList.toggle("is-hidden", shouldHide);
      checklist.hidden = shouldHide;
      checklist.setAttribute("aria-hidden", String(shouldHide));

      items.forEach((item) => {
        const element = checklist.querySelector(`[data-check-item="${item.key}"]`);

        if (element) {
          element.classList.toggle("is-complete", item.complete);
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
    const hasRequest = copy.state === "requested";

    document.querySelectorAll("[data-account-attention]").forEach((element) => {
      element.classList.toggle("is-hidden", !hasLoadedData || isLinked);
    });

    document.querySelectorAll("[data-link-status-shell]").forEach((element) => {
      const shouldHide = !hasLoadedData || isLinked;
      element.classList.toggle("is-hidden", shouldHide);
      element.hidden = shouldHide;
      element.setAttribute("aria-hidden", String(shouldHide));
    });

    document.querySelectorAll("[data-link-indicator]").forEach((element) => {
      element.classList.toggle("is-hidden", !hasLoadedData || !isLinked);
    });

    document.querySelectorAll("[data-account-link-status]").forEach((element) => {
      const statusLabel = element.querySelector("strong");

      element.classList.toggle("is-hidden", !hasLoadedData || isLinked);

      if (statusLabel) {
        statusLabel.textContent = hasRequest ? "Antrag in Prüfung" : copy.title;
      }
    });

    document.querySelectorAll("[data-link-status-action], [data-link-card-action]").forEach((element) => {
      element.textContent = copy.action;
      element.classList.toggle("is-hidden", !hasLoadedData || isLinked);
    });

    document.querySelectorAll("[data-link-status-card]").forEach((element) => {
      const shouldHide = !hasLoadedData || isLinked;
      element.classList.toggle("is-hidden", shouldHide);
      element.hidden = shouldHide;
      element.setAttribute("aria-hidden", String(shouldHide));
      element.classList.toggle("is-linked", isLinked);
    });

    updateText("[data-link-status-title], [data-link-card-title]", copy.title);
    updateText("[data-link-status-text], [data-link-card-text]", copy.text);
    updateAccountChecklist(data);
  }

  async function initAdminStatus(auth, userData) {
    const user = auth.currentUser;

    if (!user) {
      updateRoleUi(getDefaultAccountRole());
      return;
    }

    try {
      const tokenResult = await user.getIdTokenResult();
      const claims = tokenResult.claims || {};
      const data = userData || await loadCurrentUserData(user) || {};
      const role = getAccountRole(data, claims);

      updateRoleUi(role);
      await initAdminAccounts(auth, role);
    } catch (error) {
      updateRoleUi(getDefaultAccountRole());
    }
  }

  function getDefaultAccountRole() {
    return {
      isAdmin: false,
      isOrganizer: false,
      isKaderAthlete: false,
      label: "Sportler"
    };
  }

  function getAccountRole(data, claims) {
    const isAdmin = isAdminAccount(data, claims);
    const isOrganizer = isAdmin || isOrganizerAccount(data, claims);
    const isKaderAthlete = !isOrganizer && isKaderAthleteAccount(data, claims);

    return {
      isAdmin,
      isOrganizer,
      isKaderAthlete,
      label: isAdmin ? "Admin" : isOrganizer ? "Organisator" : isKaderAthlete ? "Kader-Sportler" : "Sportler"
    };
  }

  function normalizeRole(value) {
    return String(value || "").trim().toLowerCase();
  }

  function hasRole(value, acceptedRoles) {
    return acceptedRoles.includes(normalizeRole(value));
  }

  function isAdminAccount(data, claims) {
    return Boolean(
      claims?.admin === true
      || claims?.isAdmin === true
      || hasRole(claims?.role, ["admin"])
      || hasRole(data?.role, ["admin"])
      || data?.isAdmin === true
      || data?.admin === true
    );
  }

  function isOrganizerAccount(data, claims) {
    return Boolean(
      claims?.organizer === true
      || claims?.isOrganizer === true
      || hasRole(claims?.role, ["organizer", "organisator"])
      || hasRole(data?.role, ["organizer", "organisator"])
    );
  }

  function isKaderAthleteAccount(data, claims) {
    return Boolean(
      hasRole(claims?.role, ["kader-sportler", "kadersportler", "kader"])
      || hasRole(data?.role, ["kader-sportler", "kadersportler", "kader"])
    );
  }

  function updateRoleUi(role) {
    const isAdmin = Boolean(role?.isAdmin);
    const isOrganizer = Boolean(role?.isOrganizer);
    const isKaderAthlete = Boolean(role?.isKaderAthlete);

    document.querySelectorAll("[data-admin-only]").forEach((element) => {
      element.classList.toggle("is-hidden", !isAdmin);
    });

    document.querySelectorAll("[data-organizer-only]").forEach((element) => {
      element.classList.toggle("is-hidden", !isOrganizer);
    });

    document.querySelectorAll("[data-privileged-menu-divider]").forEach((element) => {
      element.classList.toggle("is-hidden", !isOrganizer && !isAdmin);
    });

    document.querySelectorAll("[data-admin-badge]").forEach((element) => {
      element.classList.toggle("is-hidden", !isAdmin);
    });

    document.querySelectorAll("[data-organizer-badge]").forEach((element) => {
      element.classList.toggle("is-hidden", !isOrganizer || isAdmin);
    });

    document.querySelectorAll("[data-kader-badge]").forEach((element) => {
      element.classList.toggle("is-hidden", !isKaderAthlete);
    });

    document.querySelectorAll("[data-account-type-card]").forEach((element) => {
      element.classList.toggle("is-organizer-account", isOrganizer && !isAdmin);
      element.classList.toggle("is-kader-account", isKaderAthlete);
      element.classList.toggle("is-admin-account", isAdmin);
    });

    updateText("[data-account-role]", role?.label || "Sportler");

    if (typeof window.refreshSettingsMenu === "function") {
      window.refreshSettingsMenu();
    }
  }

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

  function getAdminRequestName(data) {
    const request = data?.personLinkRequest || {};
    const requestName = `${request.firstName || ""} ${request.lastName || ""}`.trim();

    return requestName || data?.displayName || request.accountName || "Unbenanntes Konto";
  }

  function getInitialsFromName(name) {
    const parts = String(name || "")
      .replace(/[^a-z0-9äöüß]+/gi, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!parts.length) {
      return "?";
    }

    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
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

  function getAdminBirthYear(data) {
    const request = data?.personLinkRequest || {};

    return getShortBirthYear(data?.birthDate || request.birthDate);
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

  function createAdminRequestCard(item) {
    const data = item.data || {};
    const request = data.personLinkRequest || {};
    const requestName = getAdminRequestName(data);
    const detailsId = `admin-request-details-${item.uid.replace(/[^a-z0-9_-]/gi, "")}`;
    const card = document.createElement("article");
    const compactRow = document.createElement("div");
    const identity = document.createElement("div");
    const title = document.createElement("button");
    const branch = document.createElement("p");
    const details = document.createElement("dl");
    const personIdLabel = document.createElement("label");
    const personIdText = document.createElement("span");
    const personIdInput = document.createElement("input");
    const actions = document.createElement("div");
    const approveButton = document.createElement("button");
    const rejectButton = document.createElement("button");

    card.className = "admin-request-card";
    card.dataset.adminRequestCard = "";
    card.dataset.targetUid = item.uid;

    compactRow.className = "admin-request-compact";
    identity.className = "admin-request-identity";
    title.className = "admin-request-toggle";
    title.type = "button";
    title.textContent = `${requestName} (${getAdminBirthYear(data)})`;
    title.dataset.adminRequestToggle = "";
    title.setAttribute("aria-expanded", "false");
    title.setAttribute("aria-controls", detailsId);
    branch.className = "admin-request-branch";
    branch.textContent = `DLRG ${request.dlrgBranch || data.dlrgBranch || "Nicht angegeben"}`;
    identity.append(title, branch);

    details.className = "admin-request-details";
    details.id = detailsId;
    details.hidden = true;
    details.setAttribute("aria-hidden", "true");
    appendAdminRequestDetail(details, "Geburtsdatum", formatBirthDate(request.birthDate || data.birthDate));
    appendAdminRequestDetail(details, "Erster Wettkampf", request.firstCompetition || "Nicht angegeben");
    appendAdminRequestDetail(details, "Letzter Wettkampf", request.lastCompetition || "Nicht angegeben");
    appendAdminRequestDetail(details, "E-Mail", request.accountEmail || data.email || "Keine E-Mail gespeichert");

    personIdLabel.className = "admin-decision-field";
    personIdText.textContent = "Personen-ID";
    personIdInput.type = "text";
    personIdInput.placeholder = "Optional";
    personIdInput.dataset.adminPersonId = "";
    personIdLabel.append(personIdText, personIdInput);

    actions.className = "admin-request-actions";
    approveButton.className = "button button-primary";
    approveButton.type = "button";
    approveButton.textContent = "Verknüpfen";
    approveButton.dataset.adminRequestAction = "approve";
    rejectButton.className = "button button-danger";
    rejectButton.type = "button";
    rejectButton.textContent = "Ablehnen";
    rejectButton.dataset.adminRequestAction = "reject";
    actions.append(approveButton, rejectButton);

    compactRow.append(identity, personIdLabel, actions);
    card.append(compactRow, details);
    return card;
  }

  function toggleAdminRequestDetails(button) {
    const details = document.getElementById(button.getAttribute("aria-controls"));

    if (!details) {
      return;
    }

    const shouldOpen = button.getAttribute("aria-expanded") !== "true";

    button.setAttribute("aria-expanded", String(shouldOpen));
    details.hidden = !shouldOpen;
    details.setAttribute("aria-hidden", String(!shouldOpen));
  }

  function renderAdminLinkRequests(requests) {
    const { list } = getAdminLinkRequestControls();

    if (!list) {
      return;
    }

    list.replaceChildren();

    if (!requests.length) {
      const emptyState = document.createElement("p");

      emptyState.className = "admin-request-empty";
      emptyState.textContent = "Keine offenen Verknüpfungsanträge.";
      list.append(emptyState);
      setAdminRequestSummary("Keine offenen Anträge.");
      return;
    }

    requests.forEach((request) => {
      list.append(createAdminRequestCard(request));
    });

    setAdminRequestSummary(`${requests.length} offene Anträge.`);
  }

  async function loadAdminLinkRequests(auth) {
    const { list, refreshButton } = getAdminLinkRequestControls();

    if (!list || !window.firebase.firestore) {
      return;
    }

    try {
      setLoading(refreshButton, true, "Lade...");
      setAdminRequestSummary("Offene Anträge werden geladen.");
      setAdminRequestMessage("", true);

      const snapshot = await window.firebase.firestore()
        .collection("users")
        .where("personLinkStatus", "==", "requested")
        .limit(50)
        .get();
      const requests = snapshot.docs
        .map((doc) => ({ uid: doc.id, data: doc.data() || {} }))
        .filter((item) => hasPendingLinkRequest(item.data))
        .sort((first, second) => getAdminRequestTimestamp(second.data) - getAdminRequestTimestamp(first.data));

      renderAdminLinkRequests(requests);
    } catch (error) {
      setAdminRequestSummary("Anträge konnten nicht geladen werden.");
      setAdminRequestMessage(translateFirestoreError(error), false);
    } finally {
      setLoading(refreshButton, false);
    }
  }

  async function decideAdminLinkRequest(auth, button) {
    const user = auth.currentUser;
    const card = button.closest("[data-admin-request-card]");
    const targetUid = card?.dataset.targetUid;
    const action = button.dataset.adminRequestAction;
    const approve = action === "approve";
    const personId = card?.querySelector("[data-admin-person-id]")?.value.trim() || "";

    if (!user || !targetUid || !window.firebase.firestore) {
      setAdminRequestMessage("Aktion nicht möglich. Bitte lade die Seite neu.", false);
      return;
    }

    const fieldValue = window.firebase.firestore.FieldValue;
    const status = approve ? "linked" : "rejected";
    const updatePayload = {
      personLinkStatus: status,
      personLinked: approve,
      updatedAt: fieldValue.serverTimestamp(),
      personLinkDecision: {
        status,
        personId,
        decidedByUid: user.uid,
        decidedByEmail: user.email || "",
        decidedAt: fieldValue.serverTimestamp()
      },
      "personLinkRequest.status": status,
      "personLinkRequest.decidedByUid": user.uid,
      "personLinkRequest.decidedByEmail": user.email || "",
      "personLinkRequest.decidedAt": fieldValue.serverTimestamp()
    };

    if (approve && personId) {
      updatePayload.linkedPersonId = personId;
    }

    if (!approve) {
      updatePayload.linkedPersonId = fieldValue.delete();
    }

    try {
      card.querySelectorAll("button, input").forEach((control) => {
        control.disabled = true;
      });
      setAdminRequestMessage(approve ? "Antrag wird verknüpft..." : "Antrag wird abgelehnt...", true);

      await window.firebase.firestore().collection("users").doc(targetUid).update(updatePayload);

      if (targetUid === user.uid) {
        clearUserDocCache(user.uid);
      }

      card.remove();

      const remaining = document.querySelectorAll("[data-admin-request-card]").length;
      setAdminRequestSummary(remaining ? `${remaining} offene Anträge.` : "Keine offenen Anträge.");
      setAdminRequestMessage(approve ? "Antrag verknüpft." : "Antrag abgelehnt.", true);

      if (!remaining) {
        renderAdminLinkRequests([]);
      }
    } catch (error) {
      card.querySelectorAll("button, input").forEach((control) => {
        control.disabled = false;
      });
      setAdminRequestMessage(translateFirestoreError(error), false);
    }
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
    return data?.displayName || data?.personLinkRequest?.accountName || data?.email || "Unbenanntes Konto";
  }

  function getAdminAccountBranch(data) {
    return data?.dlrgBranch || data?.personLinkRequest?.dlrgBranch || "Nicht angegeben";
  }

  function getAdminAccountLinkedId(data) {
    return data?.linkedPersonId || data?.personId || "";
  }

  function getAdminAccountRoleValue(data) {
    if (isAdminAccount(data, {})) {
      return "admin";
    }

    if (isOrganizerAccount(data, {})) {
      return "organisator";
    }

    if (isKaderAthleteAccount(data, {})) {
      return "kader-sportler";
    }

    return "sportler";
  }

  function getAdminAccountRoleLabel(value) {
    const labels = {
      admin: "Admin",
      organisator: "Organisator",
      "kader-sportler": "Kader-Sportler",
      sportler: "Sportler"
    };

    return labels[value] || "Sportler";
  }

  function getAdminAccountSortRank(item) {
    const data = item?.data || {};
    const roleValue = getAdminAccountRoleValue(data);

    if (roleValue === "admin") {
      return 0;
    }

    if (hasPendingLinkRequest(data)) {
      return 1;
    }

    if (roleValue === "organisator") {
      return 2;
    }

    if (roleValue === "kader-sportler") {
      return 3;
    }

    return 4;
  }

  function getAdminAccountRoleSortRank(roleValue, hasOpenRequest) {
    if (roleValue === "admin") {
      return 0;
    }

    if (hasOpenRequest) {
      return 1;
    }

    if (roleValue === "organisator") {
      return 2;
    }

    if (roleValue === "kader-sportler") {
      return 3;
    }

    return 4;
  }

  function updateAdminAccountCardRole(card, roleValue) {
    if (!card) {
      return;
    }

    card.dataset.accountRole = roleValue;
    card.classList.toggle("is-admin-account", roleValue === "admin");
    card.classList.toggle("is-organizer-account", roleValue === "organisator");
    card.classList.toggle("is-kader-account", roleValue === "kader-sportler");
  }

  function getAdminAccountCardSortData(card) {
    return {
      rank: getAdminAccountRoleSortRank(
        card?.dataset.accountRole || "sportler",
        card?.dataset.hasPendingRequest === "true"
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
    element.classList.toggle("is-role-organisator", value === "organisator");
    element.classList.toggle("is-role-kader-sportler", value === "kader-sportler");
    element.classList.toggle("is-role-sportler", value === "sportler");
  }

  function createAdminAccountRoleSelect(item) {
    const data = item.data || {};
    const roleValue = getAdminAccountRoleValue(data);
    const control = roleValue === "admin"
      ? document.createElement("span")
      : document.createElement("select");

    control.className = "admin-role-control";
    setAdminAccountRoleAppearance(control, roleValue);

    if (roleValue === "admin") {
      control.textContent = "Admin";
      return control;
    }

    control.dataset.adminAccountRole = "";
    control.dataset.previousValue = roleValue;

    [
      { value: "organisator", label: "Organisator" },
      { value: "kader-sportler", label: "Kader-Sportler" },
      { value: "sportler", label: "Sportler" }
    ].forEach((role) => {
      const option = document.createElement("option");

      option.value = role.value;
      option.textContent = role.label;
      control.append(option);
    });

    control.value = roleValue;
    return control;
  }

  function createAdminLinkIconButton(label, icon, action) {
    const button = document.createElement("button");

    button.className = `admin-link-icon-button admin-link-${action}`;
    button.type = "button";
    button.textContent = icon;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset[`adminAccountLink${action.charAt(0).toUpperCase()}${action.slice(1)}`] = "";

    return button;
  }

  function getAdminAccountLinkedIdFromCard(card) {
    return card?.dataset.linkedPersonId || "";
  }

  function setAdminAccountLinkedIdDisplay(card, linkedId) {
    const normalizedId = linkedId.trim();
    const display = card?.querySelector("[data-admin-account-link-value]");
    const input = card?.querySelector("[data-admin-account-link-id]");

    if (!card || !display) {
      return;
    }

    card.dataset.linkedPersonId = normalizedId;
    display.textContent = normalizedId || "Keine ID";
    display.classList.toggle("is-empty", !normalizedId);

    if (input) {
      input.value = normalizedId;
      input.dataset.previousValue = normalizedId;
    }
  }

  function setAdminLinkEditorOpen(card, shouldOpen) {
    const display = card?.querySelector(".admin-link-display");
    const editor = card?.querySelector(".admin-link-editor");
    const input = card?.querySelector("[data-admin-account-link-id]");

    if (!display || !editor || !input) {
      return;
    }

    display.classList.toggle("is-hidden", shouldOpen);
    display.hidden = shouldOpen;
    display.setAttribute("aria-hidden", String(shouldOpen));
    editor.classList.toggle("is-hidden", !shouldOpen);
    editor.hidden = !shouldOpen;
    editor.setAttribute("aria-hidden", String(!shouldOpen));

    if (shouldOpen) {
      input.value = getAdminAccountLinkedIdFromCard(card);
      input.focus();
      input.select();
    }
  }

  function createAdminAccountCard(item) {
    const data = item.data || {};
    const request = data.personLinkRequest || {};
    const accountName = getAdminAccountName(data);
    const linkedId = getAdminAccountLinkedId(data);
    const hasOpenRequest = hasPendingLinkRequest(data);
    const detailsId = `admin-account-details-${item.uid.replace(/[^a-z0-9_-]/gi, "")}`;
    const card = document.createElement("article");
    const identity = document.createElement("div");
    const titleRow = document.createElement("div");
    const name = hasOpenRequest ? document.createElement("button") : document.createElement("h3");
    const branch = document.createElement("p");
    const roleLabel = document.createElement("label");
    const roleText = document.createElement("span");
    const roleSelect = createAdminAccountRoleSelect(item);
    const linkField = document.createElement("div");
    const linkTitle = document.createElement("span");
    const linkControls = document.createElement("div");
    const linkDisplay = document.createElement("div");
    const linkedIdValue = document.createElement("span");
    const editLinkButton = createAdminLinkIconButton("Personen-ID bearbeiten", "✎", "edit");
    const linkEditor = document.createElement("div");
    const linkedIdInput = document.createElement("input");
    const saveLinkButton = createAdminLinkIconButton("Personen-ID speichern", "✓", "save");
    const cancelLinkButton = createAdminLinkIconButton("Bearbeitung abbrechen", "×", "cancel");
    const detailsShell = document.createElement("div");
    const details = document.createElement("dl");
    const actions = document.createElement("div");
    const approveButton = document.createElement("button");
    const rejectButton = document.createElement("button");

    card.className = "admin-account-card";
    card.classList.toggle("has-open-request", hasOpenRequest);
    card.dataset.adminAccountCard = "";
    card.dataset.targetUid = item.uid;
    card.dataset.hasPendingRequest = String(hasOpenRequest);
    card.dataset.accountName = accountName;
    card.dataset.linkedPersonId = linkedId;
    updateAdminAccountCardRole(card, getAdminAccountRoleValue(data));

    identity.className = "admin-account-identity";
    titleRow.className = "admin-account-title-row";

    if (hasOpenRequest) {
      const requestAlert = document.createElement("span");

      requestAlert.className = "admin-account-alert";
      requestAlert.textContent = "!";
      requestAlert.title = "Offener Verknüpfungsantrag";
      name.className = "admin-request-toggle admin-account-toggle";
      name.type = "button";
      name.textContent = `${accountName} (${getAdminBirthYear(data)})`;
      name.dataset.adminAccountToggle = "";
      name.setAttribute("aria-expanded", "false");
      name.setAttribute("aria-controls", detailsId);
      titleRow.append(requestAlert, name);
    } else {
      name.className = "admin-account-title";
      name.textContent = `${accountName} (${getAdminBirthYear(data)})`;
      titleRow.append(name);
    }

    branch.textContent = `DLRG ${getAdminAccountBranch(data)}`;
    identity.append(titleRow, branch);

    roleLabel.className = "admin-account-field";
    roleText.textContent = "Rolle";
    roleLabel.append(roleText, roleSelect);

    linkField.className = "admin-account-field admin-account-link-field";
    linkTitle.textContent = "Verknüpfung";
    linkControls.className = "admin-account-link-controls";

    linkDisplay.className = "admin-link-display";
    linkedIdValue.className = "admin-link-id-value";
    linkedIdValue.dataset.adminAccountLinkValue = "";
    linkedIdValue.textContent = linkedId || "Keine ID";
    linkedIdValue.classList.toggle("is-empty", !linkedId);
    linkDisplay.append(linkedIdValue, editLinkButton);

    linkEditor.className = "admin-link-editor is-hidden";
    linkEditor.hidden = true;
    linkEditor.setAttribute("aria-hidden", "true");

    linkedIdInput.type = "text";
    linkedIdInput.value = linkedId;
    linkedIdInput.placeholder = hasOpenRequest ? "Personen-ID zum Verknüpfen" : "Personen-ID";
    linkedIdInput.dataset.adminAccountLinkId = "";
    linkedIdInput.dataset.previousValue = linkedId;
    linkEditor.append(linkedIdInput, saveLinkButton, cancelLinkButton);

    linkControls.append(linkDisplay, linkEditor);
    linkField.append(linkTitle, linkControls);
    card.append(identity, roleLabel, linkField);

    if (hasOpenRequest) {
      detailsShell.className = "admin-account-details-shell";
      detailsShell.id = detailsId;
      detailsShell.hidden = true;
      detailsShell.setAttribute("aria-hidden", "true");

      details.className = "admin-request-details";
      appendAdminRequestDetail(details, "Geburtsdatum", formatBirthDate(request.birthDate || data.birthDate));
      appendAdminRequestDetail(details, "Erster Wettkampf", request.firstCompetition || "Nicht angegeben");
      appendAdminRequestDetail(details, "Letzter Wettkampf", request.lastCompetition || "Nicht angegeben");
      appendAdminRequestDetail(details, "E-Mail", request.accountEmail || data.email || "Keine E-Mail gespeichert");

      actions.className = "admin-request-actions admin-account-request-actions";
      approveButton.className = "button button-primary";
      approveButton.type = "button";
      approveButton.textContent = "Verknüpfen";
      approveButton.dataset.adminAccountRequestAction = "approve";
      rejectButton.className = "button button-danger";
      rejectButton.type = "button";
      rejectButton.textContent = "Ablehnen";
      rejectButton.dataset.adminAccountRequestAction = "reject";
      actions.append(approveButton, rejectButton);
      detailsShell.append(details, actions);
      card.append(detailsShell);
    }

    return card;
  }

  function toggleAdminAccountDetails(button) {
    const details = document.getElementById(button.getAttribute("aria-controls"));

    if (!details) {
      return;
    }

    const shouldOpen = button.getAttribute("aria-expanded") !== "true";

    button.setAttribute("aria-expanded", String(shouldOpen));
    details.hidden = !shouldOpen;
    details.setAttribute("aria-hidden", String(!shouldOpen));
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
      return;
    }

    accounts.forEach((account) => {
      list.append(createAdminAccountCard(account));
    });

    const pendingCount = accounts.filter((account) => hasPendingLinkRequest(account.data)).length;

    setAdminAccountSummary(
      pendingCount
        ? `${accounts.length} Konten gefunden, ${pendingCount} offene Anträge.`
        : `${accounts.length} Konten gefunden.`
    );
  }

  async function loadAdminAccounts(auth) {
    const { list, refreshButton } = getAdminAccountControls();

    if (!list || !window.firebase.firestore) {
      return;
    }

    try {
      setLoading(refreshButton, true, "Lade...");
      setAdminAccountSummary("Firebase-Konten werden geladen.");
      setAdminAccountMessage("", true);

      const snapshot = await window.firebase.firestore()
        .collection("users")
        .limit(200)
        .get();
      const accounts = snapshot.docs
        .map((doc) => ({ uid: doc.id, data: doc.data() || {} }))
        .sort((first, second) => {
          const rankDifference = getAdminAccountSortRank(first) - getAdminAccountSortRank(second);

          if (rankDifference !== 0) {
            return rankDifference;
          }

          if (hasPendingLinkRequest(first.data) && hasPendingLinkRequest(second.data)) {
            const timeDifference = getAdminRequestTimestamp(second.data) - getAdminRequestTimestamp(first.data);

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

      renderAdminAccounts(accounts);
    } catch (error) {
      setAdminAccountSummary("Konten konnten nicht geladen werden.");
      setAdminAccountMessage(translateFirestoreError(error), false);
    } finally {
      setLoading(refreshButton, false);
    }
  }

  async function updateAdminAccountRole(auth, select) {
    const card = select.closest("[data-admin-account-card]");
    const targetUid = card?.dataset.targetUid;
    const nextRole = select.value;
    const previousRole = select.dataset.previousValue || "sportler";

    if (!targetUid || !["sportler", "kader-sportler", "organisator"].includes(nextRole)) {
      select.value = previousRole;
      setAdminAccountMessage("Diese Rolle kann hier nicht vergeben werden.", false);
      return;
    }

    if (nextRole === previousRole) {
      return;
    }

    try {
      select.disabled = true;
      setAdminAccountMessage("Rolle wird gespeichert...", true);
      await window.firebase.firestore().collection("users").doc(targetUid).update({
        role: nextRole,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      });
      select.dataset.previousValue = nextRole;
      setAdminAccountRoleAppearance(select, nextRole);
      updateAdminAccountCardRole(card, nextRole);
      reorderAdminAccountCard(card);

      if (targetUid === auth.currentUser?.uid) {
        clearUserDocCache(targetUid);
      }

      setAdminAccountMessage(`Rolle gespeichert: ${getAdminAccountRoleLabel(nextRole)}.`, true);
    } catch (error) {
      select.value = previousRole;
      setAdminAccountRoleAppearance(select, previousRole);
      setAdminAccountMessage(translateFirestoreError(error), false);
    } finally {
      select.disabled = false;
    }
  }

  async function updateAdminAccountLinkedId(auth, input) {
    const card = input.closest("[data-admin-account-card]");
    const targetUid = card?.dataset.targetUid;
    const user = auth.currentUser;
    const nextId = input.value.trim();
    const previousId = input.dataset.previousValue || "";
    const hasOpenRequest = card?.dataset.hasPendingRequest === "true";

    if (!targetUid || !user) {
      setAdminAccountMessage("Personen-ID kann gerade nicht gespeichert werden.", false);
      return;
    }

    if (hasOpenRequest && !nextId) {
      setAdminAccountMessage("Bitte trage zuerst eine Personen-ID ein.", false);
      input.focus();
      return;
    }

    if (nextId === previousId) {
      setAdminLinkEditorOpen(card, false);
      return;
    }

    const fieldValue = window.firebase.firestore.FieldValue;
    const payload = {
      updatedAt: fieldValue.serverTimestamp()
    };

    if (nextId) {
      payload.linkedPersonId = nextId;
      payload.personLinkStatus = "linked";
      payload.personLinked = true;
      if (hasOpenRequest) {
        payload.personLinkDecision = {
          status: "linked",
          personId: nextId,
          decidedByUid: user.uid,
          decidedByEmail: user.email || "",
          decidedAt: fieldValue.serverTimestamp()
        };
        payload["personLinkRequest.status"] = "linked";
        payload["personLinkRequest.decidedByUid"] = user.uid;
        payload["personLinkRequest.decidedByEmail"] = user.email || "";
        payload["personLinkRequest.decidedAt"] = fieldValue.serverTimestamp();
      }
    } else {
      payload.linkedPersonId = fieldValue.delete();
      payload.personId = fieldValue.delete();
      payload.personLinkStatus = "open";
      payload.personLinked = false;
    }

    try {
      card.querySelectorAll("[data-admin-account-link-id], [data-admin-account-link-save], [data-admin-account-link-cancel]")
        .forEach((control) => {
          control.disabled = true;
        });
      setAdminAccountMessage("Personen-ID wird gespeichert...", true);
      await window.firebase.firestore().collection("users").doc(targetUid).update(payload);
      input.dataset.previousValue = nextId;
      setAdminAccountLinkedIdDisplay(card, nextId);
      setAdminLinkEditorOpen(card, false);

      if (hasOpenRequest && nextId) {
        await loadAdminAccounts(auth);
      }

      if (targetUid === auth.currentUser?.uid) {
        clearUserDocCache(targetUid);
      }

      setAdminAccountMessage(
        nextId ? "Personen-ID gespeichert. Konto ist verknüpft." : "Personen-ID entfernt. Konto ist nicht verknüpft.",
        true
      );
    } catch (error) {
      input.value = previousId;
      setAdminAccountMessage(translateFirestoreError(error), false);
    } finally {
      card.querySelectorAll("[data-admin-account-link-id], [data-admin-account-link-save], [data-admin-account-link-cancel]")
        .forEach((control) => {
          control.disabled = false;
        });
    }
  }

  async function decideAdminAccountRequest(auth, button) {
    const user = auth.currentUser;
    const card = button.closest("[data-admin-account-card]");
    const targetUid = card?.dataset.targetUid;
    const action = button.dataset.adminAccountRequestAction;
    const approve = action === "approve";
    const personId = getAdminAccountLinkedIdFromCard(card)
      || card?.querySelector("[data-admin-account-link-id]")?.value.trim()
      || "";

    if (!user || !targetUid || !window.firebase.firestore) {
      setAdminAccountMessage("Aktion nicht möglich. Bitte lade die Seite neu.", false);
      return;
    }

    if (approve && !personId) {
      setAdminAccountMessage("Bitte trage zuerst eine Personen-ID ein.", false);
      setAdminLinkEditorOpen(card, true);
      return;
    }

    const fieldValue = window.firebase.firestore.FieldValue;
    const status = approve ? "linked" : "rejected";
    const updatePayload = {
      personLinkStatus: status,
      personLinked: approve,
      updatedAt: fieldValue.serverTimestamp(),
      personLinkDecision: {
        status,
        personId,
        decidedByUid: user.uid,
        decidedByEmail: user.email || "",
        decidedAt: fieldValue.serverTimestamp()
      },
      "personLinkRequest.status": status,
      "personLinkRequest.decidedByUid": user.uid,
      "personLinkRequest.decidedByEmail": user.email || "",
      "personLinkRequest.decidedAt": fieldValue.serverTimestamp()
    };

    if (approve && personId) {
      updatePayload.linkedPersonId = personId;
    }

    if (!approve) {
      updatePayload.linkedPersonId = fieldValue.delete();
      updatePayload.personId = fieldValue.delete();
    }

    try {
      card.querySelectorAll("button, input, select").forEach((control) => {
        control.disabled = true;
      });
      setAdminAccountMessage(approve ? "Antrag wird verknüpft..." : "Antrag wird abgelehnt...", true);

      await window.firebase.firestore().collection("users").doc(targetUid).update(updatePayload);

      if (targetUid === user.uid) {
        clearUserDocCache(user.uid);
      }

      await loadAdminAccounts(auth);
      setAdminAccountMessage(approve ? "Antrag verknüpft." : "Antrag abgelehnt.", true);
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

    if (!list.dataset.listenerAttached) {
      list.dataset.listenerAttached = "true";
      list.addEventListener("click", (event) => {
        const toggleButton = event.target.closest("[data-admin-account-toggle]");
        const actionButton = event.target.closest("[data-admin-account-request-action]");
        const editLinkButton = event.target.closest("[data-admin-account-link-edit]");
        const saveLinkButton = event.target.closest("[data-admin-account-link-save]");
        const cancelLinkButton = event.target.closest("[data-admin-account-link-cancel]");

        if (toggleButton) {
          toggleAdminAccountDetails(toggleButton);
          return;
        }

        if (editLinkButton) {
          setAdminLinkEditorOpen(editLinkButton.closest("[data-admin-account-card]"), true);
          return;
        }

        if (saveLinkButton) {
          const card = saveLinkButton.closest("[data-admin-account-card]");
          const input = card?.querySelector("[data-admin-account-link-id]");

          if (input) {
            updateAdminAccountLinkedId(auth, input);
          }
          return;
        }

        if (cancelLinkButton) {
          setAdminLinkEditorOpen(cancelLinkButton.closest("[data-admin-account-card]"), false);
          return;
        }

        if (actionButton) {
          decideAdminAccountRequest(auth, actionButton);
        }
      });

      list.addEventListener("keydown", (event) => {
        if (!event.target.matches("[data-admin-account-link-id]")) {
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          updateAdminAccountLinkedId(auth, event.target);
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          setAdminLinkEditorOpen(event.target.closest("[data-admin-account-card]"), false);
        }
      });

      list.addEventListener("change", (event) => {
        if (event.target.matches("[data-admin-account-role]")) {
          updateAdminAccountRole(auth, event.target);
        }
      });
    }

    if (refreshButton && !refreshButton.dataset.listenerAttached) {
      refreshButton.dataset.listenerAttached = "true";
      refreshButton.addEventListener("click", () => loadAdminAccounts(auth));
    }

    await loadAdminAccounts(auth);
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
      "Konto wirklich löschen? Diese Aktion entfernt dein Konto und deine gespeicherten Einstellungen."
    );

    if (!confirmed) {
      return;
    }

    try {
      setLoading(deleteButton, true, "Löschen...");

      if (window.firebase.firestore) {
        await window.firebase.firestore().collection("users").doc(user.uid).delete();
      }

      clearUserDocCache(user.uid);
      await user.delete();
      redirectToLogin();
    } catch (error) {
      setDeleteMessage(translateAuthError(error), false);
    } finally {
      setLoading(deleteButton, false);
    }
  }

  function getProviderIds(user) {
    return user.providerData.map((provider) => provider.providerId);
  }

  function hasProvider(user, providerId) {
    return getProviderIds(user).includes(providerId);
  }

  function hasVerifiedAccess(user) {
    return Boolean(user?.emailVerified || (user && hasProvider(user, "google.com")));
  }

  const profileFieldConfig = {
    displayName: {
      label: "Name",
      type: "text",
      autocomplete: "name",
      required: true,
      emptyLabel: "Nicht angegeben"
    },
    email: {
      label: "E-Mail",
      type: "email",
      autocomplete: "email",
      required: true,
      emptyLabel: "Nicht angegeben",
      help: "Bei einer neuen E-Mail-Adresse wird eine Bestätigungs-Mail an die neue Adresse gesendet."
    },
    dlrgBranch: {
      label: "DLRG-Gliederung",
      type: "text",
      autocomplete: "organization",
      canDelete: true,
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

      element.textContent = formatProfileFieldValue(fieldName, getProfileFormValue(form, fieldName));
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

    if (!config || !editor || !editorLabel || !editorControl || !editorHelp || !deleteButton || !activeRow) {
      return;
    }

    activeRow.insertAdjacentElement("afterend", editor);
    editor.dataset.activeField = fieldName;
    editor.classList.toggle("is-choice-editor", config.type === "radio");
    editorLabel.textContent = config.label;
    editorHelp.textContent = config.help || "";
    editorHelp.classList.toggle("is-hidden", !config.help);
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
    const control = document.querySelector('[name="profileFieldValue"]');
    const saveButton = document.querySelector("[data-profile-edit-save]");
    const fieldName = editor?.dataset.activeField;
    const config = profileFieldConfig[fieldName];

    if (!fieldName || !config || !control || !profileForm.elements[fieldName]) {
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

    profileForm.elements.displayName.value = getAccountName(user);
    profileForm.elements.email.value = user.email || "";
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
      updateText("[data-google-provider-summary]", "Google-Konto aktiv");
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
    const passwordStatus = !passwordLinked ? "inactive" : (passwordVerified ? "active" : "warning");
    const formIsOpen = form?.dataset.editing === "true";

    setProviderStatusClass(passwordProviderItem, passwordStatus);
    updateText(
      "[data-password-provider-summary]",
      !passwordLinked
        ? "Nicht eingerichtet"
        : (passwordVerified ? "Bestätigt" : "E-Mail nicht bestätigt")
    );

    if (help) {
      if (!passwordLinked) {
        help.textContent = `E-Mail-Konto: ${emailLabel}. Lege ein Passwort für diese E-Mail-Adresse an. Danach führen Google und E-Mail/Passwort zum selben Konto.`;
      } else if (passwordVerified) {
        help.textContent = `E-Mail-Konto: ${emailLabel}. Dieses E-Mail-Konto ist bestätigt.`;
      } else {
        help.textContent = `E-Mail-Konto: ${emailLabel}. Dieses E-Mail-Konto ist eingerichtet, aber noch nicht per Mail bestätigt.`;
      }
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

    setPasswordFormOpen(form, true);
    updatePasswordProviderStatus(auth.currentUser);

    const firstVisibleInput = Array.from(form?.querySelectorAll("input") || [])
      .find((input) => !input.closest("[hidden]"));

    firstVisibleInput?.focus({ preventScroll: true });
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
  }

  function getOptionalProfileDetails(form) {
    return {
      dlrgBranch: form.elements.dlrgBranch?.value.trim() || "",
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

    return details.dlrgBranch !== storedDetails.dlrgBranch
      || details.birthDate !== storedDetails.birthDate
      || details.gender !== storedDetails.gender;
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

  function hasStoredProfileField(data, fieldName) {
    return Object.prototype.hasOwnProperty.call(data, fieldName);
  }

  function getProfileDetailsFromData(data) {
    const request = data.personLinkRequest || {};

    return {
      dlrgBranch: hasStoredProfileField(data, "dlrgBranch")
        ? data.dlrgBranch || ""
        : request.dlrgBranch || "",
      birthDate: hasStoredProfileField(data, "birthDate")
        ? data.birthDate || ""
        : request.birthDate || "",
      gender: data.gender || ""
    };
  }

  async function syncProfileDetailsFromLinkRequest(user, data) {
    const request = data.personLinkRequest || {};
    const payload = {};
    const cachePayload = {};

    if (!hasStoredProfileField(data, "dlrgBranch") && request.dlrgBranch) {
      payload.dlrgBranch = request.dlrgBranch;
      cachePayload.dlrgBranch = request.dlrgBranch;
    }

    if (!hasStoredProfileField(data, "birthDate") && request.birthDate) {
      payload.birthDate = request.birthDate;
      cachePayload.birthDate = request.birthDate;
    }

    if (Object.keys(payload).length) {
      const fieldValue = window.firebase.firestore.FieldValue;

      payload.profileDetailsUpdatedAt = fieldValue.serverTimestamp();
      payload.updatedAt = fieldValue.serverTimestamp();

      await window.firebase.firestore().collection("users").doc(user.uid).set(payload, { merge: true });
      Object.assign(data, cachePayload);
      mergeUserDocCache(user.uid, cachePayload);
    }

    return getProfileDetailsFromData(data);
  }

  async function persistProfileDetails(auth, form, button) {
    const user = auth.currentUser;
    const displayName = form.elements.displayName.value.trim();
    const email = form.elements.email.value.trim();
    const optionalProfileDetails = getOptionalProfileDetails(form);

    if (!user) {
      setProfileMessage("Bitte logge dich erneut ein.", false);
      return false;
    }

    if (!displayName || !email) {
      setProfileMessage("Bitte fülle Name und E-Mail aus.", false);
      return false;
    }

    const emailChanged = email.toLowerCase() !== String(user.email || "").toLowerCase();
    const displayNameChanged = displayName !== (user.displayName || "");
    const profileDetailsChanged = haveOptionalProfileDetailsChanged(user, optionalProfileDetails);

    if (!displayNameChanged && !emailChanged && !profileDetailsChanged) {
      setProfileMessage("Keine Ã„nderung zu speichern.", true);
      updateEmptyProfileFieldHighlights(form);
      return true;
    }

    try {
      setLoading(button, true, "Speichern...");

      if (displayNameChanged) {
        await user.updateProfile({ displayName });
      }

      if (emailChanged) {
        await requestEmailChange(user, email);
      }

      await user.reload();
      updateAccountProfile(auth.currentUser);
      fillAccountManagementForms(auth.currentUser);
      const updatedData = await saveIdentitySnapshot(auth.currentUser, emailChanged ? email : null, optionalProfileDetails);
      await loadAccountProfileDetails(auth, updatedData);
      await initLinkStatus(auth, updatedData);
      updateEmptyProfileFieldHighlights(form);

      setProfileMessage(
        emailChanged
          ? "Name gespeichert. Bitte bestätige die neue E-Mail-Adresse über die gesendete Mail."
          : "Kontodaten gespeichert.",
        true
      );
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

  async function requestEmailChange(user, email) {
    const actionSettings = {
      url: getVerificationRedirectUrl()
    };

    if (typeof user.verifyBeforeUpdateEmail === "function") {
      await user.verifyBeforeUpdateEmail(email, actionSettings);
      return;
    }

    await user.updateEmail(email);
    await user.sendEmailVerification(actionSettings);
  }

  async function saveIdentitySnapshot(user, pendingEmail, optionalProfileDetails) {
    if (!window.firebase.firestore) {
      return null;
    }

    const identity = getUserIdentityData(user);
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

    if (pendingEmail) {
      payload.pendingEmail = pendingEmail;
      cachePayload.pendingEmail = pendingEmail;
    }

    await window.firebase.firestore().collection("users").doc(user.uid).set(payload, { merge: true });
    return mergeUserDocCache(user.uid, cachePayload);
  }

  async function changeAccountPassword(event, auth) {
    event.preventDefault();

    const user = auth.currentUser;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const currentPassword = form.elements.currentPassword?.value || "";
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

    if (!passwordLinked && !user.email) {
      setPasswordMessage("Dieses Konto hat keine E-Mail-Adresse, für die ein Passwort-Login aktiviert werden kann.", false);
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
        const credential = window.firebase.auth.EmailAuthProvider.credential(user.email, newPassword);
        await user.linkWithCredential(credential);
        await user.reload();

        if (auth.currentUser && !auth.currentUser.emailVerified) {
          await auth.currentUser.sendEmailVerification({
            url: getLoginRedirectUrl()
          });
          verificationSent = true;
        }

        updateAccountProfile(auth.currentUser);
        updateGoogleProviderStatus(auth.currentUser);
        await saveIdentitySnapshot(auth.currentUser, null);
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
      }

      await user.linkWithPopup(provider);
      await user.reload();
      updateAccountProfile(auth.currentUser);
      updateGoogleProviderStatus(auth.currentUser);
      await saveIdentitySnapshot(auth.currentUser, null);
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
      await saveIdentitySnapshot(auth.currentUser, null);
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
    const payload = {
      email: user.email || "",
      displayName: user.displayName || "",
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

  async function initLinkRequest(auth, userData) {
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

    if (!controls.form.dataset.listenerAttached) {
      controls.form.dataset.listenerAttached = "true";
      controls.form.addEventListener("submit", (event) => submitLinkRequest(event, auth, db));
    }

    await loadLinkRequest(auth, db, userData);
  }

  function getLinkRequestControls() {
    const form = document.querySelector("[data-link-request-form]");

    return {
      form,
      firstName: form?.querySelector('[name="firstName"]'),
      lastName: form?.querySelector('[name="lastName"]'),
      birthDate: form?.querySelector('[name="birthDate"]'),
      dlrgBranch: form?.querySelector('[name="dlrgBranch"]'),
      firstCompetition: form?.querySelector('[name="firstCompetition"]'),
      lastCompetition: form?.querySelector('[name="lastCompetition"]'),
      submitButton: form?.querySelector('button[type="submit"]')
    };
  }

  function setLinkRequestControlsDisabled(isDisabled) {
    const controls = getLinkRequestControls();

    if (!controls.form) {
      return;
    }

    controls.form.querySelectorAll("input, button").forEach((control) => {
      control.disabled = isDisabled;
    });
  }

  async function loadLinkRequest(auth, db, userData) {
    const controls = getLinkRequestControls();
    const user = auth.currentUser;

    if (!controls.form || !user) {
      return;
    }

    setLinkRequestControlsDisabled(true);

    try {
      const data = userData || await loadCurrentUserData(user) || {};
      const request = data.personLinkRequest || null;

      if (request) {
        await syncProfileDetailsFromLinkRequest(user, data);
        controls.firstName.value = request.firstName || "";
        controls.lastName.value = request.lastName || "";
        controls.birthDate.value = request.birthDate || "";
        controls.dlrgBranch.value = request.dlrgBranch || "";
        controls.firstCompetition.value = request.firstCompetition || "";
        controls.lastCompetition.value = request.lastCompetition || "";
        setLinkRequestMessage(
          request.status === "rejected"
            ? "Letzter Antrag wurde abgelehnt. Du kannst die Angaben prüfen und erneut absenden."
            : "Letzter Antrag ist gespeichert.",
          true
        );
      }
    } catch (error) {
      setLinkRequestMessage(translateFirestoreError(error), false);
    } finally {
      setLinkRequestControlsDisabled(false);
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

    const details = {
      firstName: controls.firstName.value.trim(),
      lastName: controls.lastName.value.trim(),
      birthDate: controls.birthDate.value,
      dlrgBranch: controls.dlrgBranch.value.trim(),
      firstCompetition: controls.firstCompetition.value.trim(),
      lastCompetition: controls.lastCompetition.value.trim(),
      accountEmail: user.email || "",
      accountName: getAccountName(user),
      accountUid: user.uid
    };

    if (!details.firstName || !details.lastName || !details.birthDate || !details.dlrgBranch) {
      setLinkRequestMessage("Bitte fülle Vorname, Nachname, Geburtsdatum und DLRG-Gliederung aus.", false);
      return;
    }

    const fieldValue = window.firebase.firestore.FieldValue;

    try {
      setLinkRequestControlsDisabled(true);
      setLoading(controls.submitButton, true, "Antrag speichern...");

      const requestCacheData = {
        ...details,
        status: "requested"
      };
      const userCacheData = {
        dlrgBranch: details.dlrgBranch,
        birthDate: details.birthDate,
        personLinkStatus: "requested",
        personLinkRequest: requestCacheData
      };

      await db.collection("users").doc(user.uid).set({
        dlrgBranch: details.dlrgBranch,
        birthDate: details.birthDate,
        profileDetailsUpdatedAt: fieldValue.serverTimestamp(),
        personLinkStatus: "requested",
        personLinkRequest: {
          ...requestCacheData,
          requestedAt: fieldValue.serverTimestamp(),
          updatedAt: fieldValue.serverTimestamp()
        },
        updatedAt: fieldValue.serverTimestamp()
      }, { merge: true });

      updateLinkStatusUi(mergeUserDocCache(user.uid, userCacheData));
      setLinkRequestMessage("Antrag gespeichert. Er ist jetzt im Adminbereich sichtbar.", true);
    } catch (error) {
      setLinkRequestMessage(translateFirestoreError(error), false);
    } finally {
      setLoading(controls.submitButton, false);
      setLinkRequestControlsDisabled(false);
    }
  }
})();
