(function () {
  const page = document.body.dataset.page;
  const appUrl = "app.html";
  const loginUrl = "login.html";
  const accountLinkRecipient = "jpg.gnad@web.de";

  function getVerificationRedirectUrl() {
    return new URL("login.html?verified=1", window.location.href).href;
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
      "auth/invalid-credential": "E-Mail oder Passwort stimmt nicht.",
      "auth/invalid-email": "Bitte gib eine gültige E-Mail-Adresse ein.",
      "auth/network-request-failed": "Firebase ist gerade nicht erreichbar.",
      "auth/operation-not-allowed": "Dieser Login-Anbieter ist in Firebase noch nicht aktiviert.",
      "auth/popup-blocked": "Das Google-Popup wurde vom Browser blockiert.",
      "auth/popup-closed-by-user": "Google-Login wurde abgebrochen.",
      "auth/requires-recent-login": "Bitte melde dich neu an und versuche es direkt danach erneut.",
      "auth/too-many-requests": "Zu viele Versuche. Bitte später erneut probieren.",
      "auth/unauthorized-domain": "Diese Domain ist in Firebase noch nicht freigegeben.",
      "auth/user-disabled": "Dieses Konto wurde deaktiviert.",
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

  function disableAuthControls() {
    document
      .querySelectorAll('[data-auth-form] button, [data-google-login], [data-resend-verification]')
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

  if (page === "app" || page === "settings") {
    if (window.location.protocol === "file:" || !window.isFirebaseConfigured || !window.firebase?.auth) {
      redirectToLogin();
      return;
    }

    initAppPage(initFirebase());
  }

  function initLoginPage(auth, googleProvider) {
    const params = new URLSearchParams(window.location.search);
    const loginForm = document.querySelector('[data-auth-form="login"]');
    const registerForm = document.querySelector('[data-auth-form="register"]');
    const googleButton = document.querySelector("[data-google-login]");
    const resendButton = document.querySelector("[data-resend-verification]");

    if (params.has("verified")) {
      setMessage("login", "E-Mail bestätigt. Du kannst dich jetzt einloggen.", true);
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
        setLoading(button, true, "Einloggen...");
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

        await user.updateProfile({ displayName: name });
        await user.sendEmailVerification({
          url: getVerificationRedirectUrl()
        });

        showTab("login");
        showResendButton(true);
        setMessage(
          "login",
          "Konto erstellt. Bitte bestätige deine E-Mail-Adresse und logge dich danach ein.",
          true
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
        await auth.signInWithPopup(googleProvider);
        redirectToApp();
      } catch (error) {
        setMessage("login", translateAuthError(error));
      } finally {
        setLoading(googleButton, false);
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

  function initAppPage(auth) {
    const userName = document.querySelector("[data-user-name]");
    const userEmail = document.querySelector("[data-user-email]");
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

      if (userEmail) {
        userEmail.textContent = auth.currentUser.email || "Keine E-Mail geladen.";
      }

      updateAccountProfile(auth.currentUser);

      if (settingsLoadedForUser !== auth.currentUser.uid) {
        settingsLoadedForUser = auth.currentUser.uid;
        await initUserSettings(auth);
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
        controls.firstName.value = request.firstName || "";
        controls.lastName.value = request.lastName || "";
        controls.birthDate.value = request.birthDate || "";
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
      accountEmail: user.email || "",
      accountName: getAccountName(user),
      accountUid: user.uid
    };

    if (!details.firstName || !details.lastName || !details.birthDate) {
      setLinkRequestMessage("Bitte fülle Vorname, Nachname und Geburtsdatum aus.", false);
      return;
    }

    const fieldValue = window.firebase.firestore.FieldValue;

    try {
      setLinkRequestControlsDisabled(true);
      setLoading(controls.submitButton, true, "Antrag speichern...");

      await db.collection("users").doc(user.uid).set({
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
      `E-Mail des Kontos: ${details.accountEmail}`,
      `Kontoname: ${details.accountName}`,
      `Firebase UID: ${details.accountUid}`,
      "",
      "Bitte prüfe meine Identität und ordne die passende Person zu."
    ].join("\n");

    return `mailto:${accountLinkRecipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
})();
