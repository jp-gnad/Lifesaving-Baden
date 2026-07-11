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

  function initLoginPage(auth, googleProvider) {
    const params = new URLSearchParams(window.location.search);
    const loginForm = document.querySelector('[data-auth-form="login"]');
    const registerForm = document.querySelector('[data-auth-form="register"]');
    const googleButton = document.querySelector("[data-google-login]");
    const resendButton = document.querySelector("[data-resend-verification]");
    const resetPasswordButton = document.querySelector("[data-reset-password]");

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
      fillAccountManagementForms(auth.currentUser);
      updateGoogleProviderStatus(auth.currentUser);

      if (settingsLoadedForUser !== auth.currentUser.uid) {
        settingsLoadedForUser = auth.currentUser.uid;
        await initAccountManagement(auth);
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
  }

  async function saveProfileDetails(event, auth) {
    event.preventDefault();

    const user = auth.currentUser;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const displayName = form.elements.displayName.value.trim();
    const email = form.elements.email.value.trim();

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
      await saveIdentitySnapshot(auth.currentUser, emailChanged ? email : null);

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

  async function saveIdentitySnapshot(user, pendingEmail) {
    if (!window.firebase.firestore) {
      return;
    }

    const payload = {
      email: user.email || "",
      displayName: user.displayName || "",
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    };

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
