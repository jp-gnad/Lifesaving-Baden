(function () {
  const page = document.body.dataset.page;
  const appUrl = "app.html";
  const loginUrl = "login.html";
  const accountLinkRecipient = "jpg.gnad@web.de";

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

      if (auth.currentUser?.emailVerified) {
        redirectToApp();
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

        if (!auth.currentUser?.emailVerified) {
          showResendButton(true);
          setMessage("login", "Bitte bestätige deine E-Mail-Adresse, bevor du fortfährst.");
          return;
        }

        redirectToApp();
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
        await ensureUserDocument(user);
        redirectToApp();
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

    if (!menuItems.length) {
      return;
    }

    function setActiveItem(hash) {
      const activeHash = hash || menuItems[0].getAttribute("href");

      menuItems.forEach((item) => {
        item.classList.toggle("is-active", item.getAttribute("href") === activeHash);
      });
    }

    menuItems.forEach((item) => {
      item.addEventListener("click", () => setActiveItem(item.getAttribute("href")));
    });

    setActiveItem(window.location.hash);
    window.addEventListener("hashchange", () => setActiveItem(window.location.hash));
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

      if (!auth.currentUser?.emailVerified) {
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
        await ensureUserDocument(auth.currentUser);
        settingsLoadedForUser = auth.currentUser.uid;
        await initAccountManagement(auth);
        await initUserSettings(auth);
        await initLinkStatus(auth);
        await initAdminStatus(auth);
        await initLinkRequest(auth);
      }
    });

    logoutButtons.forEach((button) => button.addEventListener("click", async () => {
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
      return false;
    }

    const db = window.firebase.firestore();
    const fieldValue = window.firebase.firestore.FieldValue;
    const userDoc = db.collection("users").doc(user.uid);

    try {
      const snapshot = await userDoc.get();
      const basePayload = {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        emailVerified: Boolean(user.emailVerified),
        providerIds: getProviderIds(user),
        updatedAt: fieldValue.serverTimestamp()
      };

      if (!snapshot.exists) {
        await userDoc.set({
          ...basePayload,
          role: "sportler",
          keepPersonalDataUntilRevoked: true,
          privateProfile: false,
          publicProfile: true,
          createdAt: fieldValue.serverTimestamp(),
          lastSignInAt: fieldValue.serverTimestamp()
        });
        return true;
      }

      const updatePayload = {
        ...basePayload,
        lastSignInAt: fieldValue.serverTimestamp()
      };
      const data = snapshot.data() || {};

      if (!Object.prototype.hasOwnProperty.call(data, "role")) {
        updatePayload.role = "sportler";
      }

      await userDoc.set(updatePayload, { merge: true });
      return true;
    } catch (error) {
      if (options.throwOnError) {
        throw error;
      }

      console.warn("Firestore-Nutzerdokument konnte nicht angelegt oder aktualisiert werden.", error);
      return false;
    }
  }

  async function initLinkStatus(auth) {
    const user = auth.currentUser;

    if (!user || !window.firebase.firestore) {
      updateLinkStatusUi(null);
      return;
    }

    try {
      const snapshot = await window.firebase.firestore().collection("users").doc(user.uid).get();
      updateLinkStatusUi(snapshot.exists ? snapshot.data() : null);
    } catch (error) {
      updateLinkStatusUi(null);
    }
  }

  function isPersonLinked(data) {
    return Boolean(
      data?.personLinkStatus === "linked"
      || data?.personLinked === true
      || data?.linkedPersonId
      || data?.personId
    );
  }

  function hasPendingLinkRequest(data) {
    return Boolean(data?.personLinkStatus === "requested" || data?.personLinkRequest);
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

    return [
      { key: "linkRequest", complete: requestSubmitted },
      { key: "linked", complete: linked },
      { key: "dlrgBranch", complete: dlrgBranchAdded },
      { key: "birthDate", complete: birthDateAdded }
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

      checklist.classList.toggle("is-hidden", completed === total);

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
    const isLinked = copy.state === "linked";
    const hasRequest = copy.state === "requested";

    document.querySelectorAll("[data-account-attention]").forEach((element) => {
      element.classList.toggle("is-hidden", isLinked);
    });

    document.querySelectorAll("[data-link-status-shell]").forEach((element) => {
      element.classList.toggle("is-hidden", isLinked);
    });

    document.querySelectorAll("[data-account-link-status]").forEach((element) => {
      const statusLabel = element.querySelector("strong");

      element.classList.toggle("is-hidden", isLinked);

      if (statusLabel) {
        statusLabel.textContent = hasRequest ? "Antrag in Prüfung" : copy.title;
      }
    });

    document.querySelectorAll("[data-link-status-action], [data-link-card-action]").forEach((element) => {
      element.textContent = copy.action;
      element.classList.toggle("is-hidden", isLinked);
    });

    document.querySelectorAll("[data-link-status-card]").forEach((element) => {
      element.classList.toggle("is-linked", isLinked);
    });

    updateText("[data-link-status-title], [data-link-card-title]", copy.title);
    updateText("[data-link-status-text], [data-link-card-text]", copy.text);
    updateAccountChecklist(data);
  }

  async function initAdminStatus(auth) {
    const user = auth.currentUser;

    if (!user) {
      updateRoleUi(getDefaultAccountRole());
      return;
    }

    try {
      const tokenResult = await user.getIdTokenResult();
      const claims = tokenResult.claims || {};
      let data = {};

      if (window.firebase.firestore) {
        const snapshot = await window.firebase.firestore().collection("users").doc(user.uid).get();
        data = snapshot.exists ? snapshot.data() : {};
      }

      updateRoleUi(getAccountRole(data, claims));
    } catch (error) {
      updateRoleUi(getDefaultAccountRole());
    }
  }

  function getDefaultAccountRole() {
    return {
      isAdmin: false,
      isOrganizer: false,
      label: "Sportler"
    };
  }

  function getAccountRole(data, claims) {
    const isAdmin = isAdminAccount(data, claims);
    const isOrganizer = isAdmin || isOrganizerAccount(data, claims);

    return {
      isAdmin,
      isOrganizer,
      label: isAdmin ? "Admin" : isOrganizer ? "Organisator" : "Sportler"
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

  function updateRoleUi(role) {
    const isAdmin = Boolean(role?.isAdmin);
    const isOrganizer = Boolean(role?.isOrganizer);

    document.querySelectorAll("[data-admin-only]").forEach((element) => {
      element.classList.toggle("is-hidden", !isAdmin);
    });

    document.querySelectorAll("[data-organizer-only]").forEach((element) => {
      element.classList.toggle("is-hidden", !isOrganizer);
    });

    document.querySelectorAll("[data-admin-badge]").forEach((element) => {
      element.classList.toggle("is-hidden", !isAdmin);
    });

    document.querySelectorAll("[data-organizer-badge]").forEach((element) => {
      element.classList.toggle("is-hidden", !isOrganizer || isAdmin);
    });

    updateText("[data-account-role]", role?.label || "Sportler");
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

  function fillAccountManagementForms(user) {
    const profileForm = document.querySelector("[data-profile-form]");

    if (!profileForm) {
      return;
    }

    profileForm.elements.displayName.value = getAccountName(user);
    profileForm.elements.email.value = user.email || "";
  }

  function updateGoogleProviderStatus(user) {
    const status = document.querySelector("[data-google-provider-status]");
    const button = document.querySelector("[data-google-link]");

    if (!status || !button) {
      return;
    }

    const googleLinked = hasProvider(user, "google.com");
    const passwordLinked = hasProvider(user, "password");

    if (googleLinked && passwordLinked) {
      status.textContent = "Dieses Konto ist mit Google und E-Mail/Passwort verbunden. Du kannst das Google-Konto wechseln, ohne das Konto zu verlieren.";
      button.textContent = "Google-Konto wechseln";
      return;
    }

    if (googleLinked) {
      status.textContent = "Dieses Konto nutzt Google als Login. Ein Wechsel wird erst angeboten, wenn zusätzlich ein Passwort-Login vorhanden ist.";
      button.textContent = "Google-Konto bestätigen";
      return;
    }

    status.textContent = "Dieses Konto ist noch nicht mit Google verbunden.";
    button.textContent = "Google-Konto verbinden";
  }

  async function initAccountManagement(auth) {
    const profileForm = document.querySelector("[data-profile-form]");
    const passwordForm = document.querySelector("[data-password-form]");
    const googleLinkButton = document.querySelector("[data-google-link]");

    if (profileForm && !profileForm.dataset.listenerAttached) {
      profileForm.dataset.listenerAttached = "true";
      profileForm.addEventListener("submit", (event) => saveProfileDetails(event, auth));
    }

    if (passwordForm && !passwordForm.dataset.listenerAttached) {
      passwordForm.dataset.listenerAttached = "true";
      passwordForm.addEventListener("submit", (event) => changeAccountPassword(event, auth));
    }

    if (googleLinkButton && !googleLinkButton.dataset.listenerAttached) {
      googleLinkButton.dataset.listenerAttached = "true";
      googleLinkButton.addEventListener("click", () => manageGoogleAccount(auth, googleLinkButton));
    }

    await loadAccountProfileDetails(auth);
  }

  function getOptionalProfileDetails(form) {
    return {
      dlrgBranch: form.elements.dlrgBranch?.value.trim() || "",
      birthDate: form.elements.birthDate?.value || ""
    };
  }

  async function loadAccountProfileDetails(auth) {
    const user = auth.currentUser;
    const profileForm = document.querySelector("[data-profile-form]");

    if (!user || !profileForm || !window.firebase.firestore) {
      return;
    }

    try {
      const snapshot = await window.firebase.firestore().collection("users").doc(user.uid).get();
      const data = snapshot.exists ? snapshot.data() : {};
      const details = await syncProfileDetailsFromLinkRequest(user, data);

      if (profileForm.elements.dlrgBranch) {
        profileForm.elements.dlrgBranch.value = details.dlrgBranch;
      }

      if (profileForm.elements.birthDate) {
        profileForm.elements.birthDate.value = details.birthDate;
      }
    } catch (error) {
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
        : request.birthDate || ""
    };
  }

  async function syncProfileDetailsFromLinkRequest(user, data) {
    const request = data.personLinkRequest || {};
    const payload = {};

    if (!hasStoredProfileField(data, "dlrgBranch") && request.dlrgBranch) {
      payload.dlrgBranch = request.dlrgBranch;
    }

    if (!hasStoredProfileField(data, "birthDate") && request.birthDate) {
      payload.birthDate = request.birthDate;
    }

    if (Object.keys(payload).length) {
      const fieldValue = window.firebase.firestore.FieldValue;

      payload.profileDetailsUpdatedAt = fieldValue.serverTimestamp();
      payload.updatedAt = fieldValue.serverTimestamp();

      await window.firebase.firestore().collection("users").doc(user.uid).set(payload, { merge: true });
      Object.assign(data, payload);
    }

    return getProfileDetailsFromData(data);
  }

  async function saveProfileDetails(event, auth) {
    event.preventDefault();

    const user = auth.currentUser;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const displayName = form.elements.displayName.value.trim();
    const email = form.elements.email.value.trim();
    const optionalProfileDetails = getOptionalProfileDetails(form);

    if (!user) {
      setProfileMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    if (!displayName || !email) {
      setProfileMessage("Bitte fülle Name und E-Mail aus.", false);
      return;
    }

    const emailChanged = email.toLowerCase() !== String(user.email || "").toLowerCase();

    try {
      setLoading(button, true, "Speichern...");

      if (displayName !== (user.displayName || "")) {
        await user.updateProfile({ displayName });
      }

      if (emailChanged) {
        await requestEmailChange(user, email);
      }

      await user.reload();
      updateAccountProfile(auth.currentUser);
      fillAccountManagementForms(auth.currentUser);
      await saveIdentitySnapshot(auth.currentUser, emailChanged ? email : null, optionalProfileDetails);
      await loadAccountProfileDetails(auth);
      await initLinkStatus(auth);

      setProfileMessage(
        emailChanged
          ? "Name gespeichert. Bitte bestätige die neue E-Mail-Adresse über die gesendete Mail."
          : "Kontodaten gespeichert.",
        true
      );
    } catch (error) {
      setProfileMessage(translateAuthError(error), false);
    } finally {
      setLoading(button, false);
    }
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
      return;
    }

    const payload = {
      email: user.email || "",
      displayName: user.displayName || "",
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    };

    if (optionalProfileDetails) {
      payload.dlrgBranch = optionalProfileDetails.dlrgBranch;
      payload.birthDate = optionalProfileDetails.birthDate;
      payload.profileDetailsUpdatedAt = window.firebase.firestore.FieldValue.serverTimestamp();
    }

    if (pendingEmail) {
      payload.pendingEmail = pendingEmail;
    }

    await window.firebase.firestore().collection("users").doc(user.uid).set(payload, { merge: true });
  }

  async function changeAccountPassword(event, auth) {
    event.preventDefault();

    const user = auth.currentUser;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const currentPassword = form.elements.currentPassword.value;
    const newPassword = form.elements.newPassword.value;
    const repeatPassword = form.elements.repeatPassword.value;

    if (!user) {
      setPasswordMessage("Bitte logge dich erneut ein.", false);
      return;
    }

    if (!hasProvider(user, "password")) {
      setPasswordMessage("Dieses Konto hat noch keinen Passwort-Login. Nutze zuerst die Passwort-vergessen-Funktion mit deiner Konto-E-Mail.", false);
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

    try {
      setLoading(button, true, "Speichern...");

      const credential = window.firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(newPassword);

      form.reset();
      setPasswordMessage("Passwort wurde geändert.", true);
    } catch (error) {
      setPasswordMessage(translateAuthError(error), false);
    } finally {
      setLoading(button, false);
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

    try {
      setLoading(button, true, "Google öffnet...");

      if (googleLinked && !passwordLinked) {
        await user.reauthenticateWithPopup(provider);
        setGoogleAccountMessage("Google-Konto wurde erneut bestätigt. Ein Wechsel ist erst sicher möglich, wenn zusätzlich ein Passwort-Login existiert.", true);
        return;
      }

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

  async function initUserSettings(auth) {
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

    await loadUserSettings(auth, db);
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

  async function loadUserSettings(auth, db) {
    const controls = getSettingsControls();
    const user = auth.currentUser;

    if (!controls.keepData || !controls.privateProfile || !user) {
      return;
    }

    setSettingsControlsDisabled(true);
    setSettingsMessage("Einstellung wird geladen...", true);

    try {
      const snapshot = await db.collection("users").doc(user.uid).get();
      const data = snapshot.exists ? snapshot.data() : {};
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
        snapshot.exists ? "Einstellung geladen." : "Noch keine Einstellung gespeichert.",
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

    setSettingsControlsDisabled(true);
    setSettingsMessage("Einstellung wird gespeichert...", true);

    try {
      await userDoc.set(payload, { merge: true });
      rememberCurrentSettings();
      setSettingsMessage("Einstellung gespeichert.", true);
    } catch (error) {
      restoreRememberedSettings();
      setSettingsMessage(translateFirestoreError(error), false);
    } finally {
      setSettingsControlsDisabled(false);
    }
  }

  async function initLinkRequest(auth) {
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

    await loadLinkRequest(auth, db);
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

  async function loadLinkRequest(auth, db) {
    const controls = getLinkRequestControls();
    const user = auth.currentUser;

    if (!controls.form || !user) {
      return;
    }

    setLinkRequestControlsDisabled(true);

    try {
      const snapshot = await db.collection("users").doc(user.uid).get();
      const data = snapshot.exists ? snapshot.data() : {};
      const request = data.personLinkRequest || null;

      if (request) {
        await syncProfileDetailsFromLinkRequest(user, data);
        controls.firstName.value = request.firstName || "";
        controls.lastName.value = request.lastName || "";
        controls.birthDate.value = request.birthDate || "";
        controls.dlrgBranch.value = request.dlrgBranch || "";
        controls.firstCompetition.value = request.firstCompetition || "";
        controls.lastCompetition.value = request.lastCompetition || "";
        setLinkRequestMessage("Letzter Antrag ist gespeichert.", true);
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

      await db.collection("users").doc(user.uid).set({
        dlrgBranch: details.dlrgBranch,
        birthDate: details.birthDate,
        profileDetailsUpdatedAt: fieldValue.serverTimestamp(),
        personLinkStatus: "requested",
        personLinkRequest: {
          ...details,
          recipientEmail: accountLinkRecipient,
          status: "requested",
          requestedAt: fieldValue.serverTimestamp(),
          updatedAt: fieldValue.serverTimestamp()
        },
        updatedAt: fieldValue.serverTimestamp()
      }, { merge: true });

      updateLinkStatusUi({
        personLinkStatus: "requested",
        personLinkRequest: details,
        dlrgBranch: details.dlrgBranch,
        birthDate: details.birthDate
      });
      setLinkRequestMessage("Antrag gespeichert. Dein E-Mail-Programm wird geöffnet.", true);
      window.location.href = buildLinkRequestMailto(details);
    } catch (error) {
      setLinkRequestMessage(translateFirestoreError(error), false);
    } finally {
      setLoading(controls.submitButton, false);
      setLinkRequestControlsDisabled(false);
    }
  }

  function buildLinkRequestMailto(details) {
    const subject = "Konto-Verknüpfung beantragt";
    const body = [
      "Hallo Jan-Philipp,",
      "",
      "ich möchte mein Lifesaving-Baden-Konto mit meiner Person in der Datenbank verknüpfen.",
      "",
      `Vorname: ${details.firstName}`,
      `Nachname: ${details.lastName}`,
      `Geburtsdatum: ${details.birthDate}`,
      `Mitglied in DLRG-Gliederung: ${details.dlrgBranch}`,
      `Erster Wettkampf: ${details.firstCompetition || "Nicht angegeben"}`,
      `Letzter Wettkampf: ${details.lastCompetition || "Nicht angegeben"}`,
      `E-Mail des Kontos: ${details.accountEmail}`,
      `Kontoname: ${details.accountName}`,
      `Firebase UID: ${details.accountUid}`,
      "",
      "Bitte prüfe meine Identität und ordne die passende Person zu."
    ].join("\n");

    return `mailto:${accountLinkRecipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
})();
