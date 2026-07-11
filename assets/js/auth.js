(function () {
  const page = document.body.dataset.page;
  const appUrl = "app.html";
  const loginUrl = "login.html";

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
      "auth/invalid-email": "Bitte gib eine gueltige E-Mail-Adresse ein.",
      "auth/network-request-failed": "Firebase ist gerade nicht erreichbar.",
      "auth/operation-not-allowed": "Dieser Login-Anbieter ist in Firebase noch nicht aktiviert.",
      "auth/popup-blocked": "Das Google-Popup wurde vom Browser blockiert.",
      "auth/popup-closed-by-user": "Google-Login wurde abgebrochen.",
      "auth/too-many-requests": "Zu viele Versuche. Bitte spaeter erneut probieren.",
      "auth/unauthorized-domain": "Diese Domain ist in Firebase noch nicht freigegeben.",
      "auth/user-disabled": "Dieses Konto wurde deaktiviert.",
      "auth/user-not-found": "E-Mail oder Passwort stimmt nicht.",
      "auth/weak-password": "Das Passwort muss mindestens 6 Zeichen haben.",
      "auth/wrong-password": "E-Mail oder Passwort stimmt nicht."
    };

    return messages[error.code] || "Der Login ist fehlgeschlagen. Bitte pruefe die Eingaben.";
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
        "Bitte oeffne die Seite ueber GitHub Pages oder einen lokalen HTTP-Server, nicht per Doppelklick als Datei."
      );
      disableAuthControls();
      return false;
    }

    if (!window.isFirebaseConfigured) {
      setMessage(
        "login",
        "Firebase ist noch nicht konfiguriert. Pruefe assets/js/firebase-config.js."
      );
      disableAuthControls();
      return false;
    }

    if (!window.firebase || !window.firebase.auth) {
      setMessage(
        "login",
        "Firebase konnte nicht geladen werden. Pruefe Internetverbindung, Browser-Blocker oder die Firebase-Skripte."
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

  if (page === "app") {
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
      setMessage("login", "E-Mail bestaetigt. Du kannst dich jetzt einloggen.", true);
    }

    if (params.has("needsVerification")) {
      setMessage("login", "Bitte bestaetige zuerst deine E-Mail-Adresse.");
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
      setMessage("login", "Bitte bestaetige deine E-Mail-Adresse, bevor du fortfaehrst.");
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
          setMessage("login", "Bitte bestaetige deine E-Mail-Adresse, bevor du fortfaehrst.");
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
          "Konto erstellt. Bitte bestaetige deine E-Mail-Adresse und logge dich danach ein.",
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
        setLoading(googleButton, true, "Google oeffnet...");
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
        setMessage("login", "Bestaetigungs-Mail wurde erneut gesendet.", true);
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
    const logoutButton = document.querySelector("[data-logout]");
    let settingsLoadedForUser = null;

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
        userName.textContent = auth.currentUser.displayName || "Mitglied";
      }

      if (userEmail) {
        userEmail.textContent = auth.currentUser.email || "Keine E-Mail geladen.";
      }

      if (settingsLoadedForUser !== auth.currentUser.uid) {
        settingsLoadedForUser = auth.currentUser.uid;
        await initUserSettings(auth);
      }
    });

    logoutButton.addEventListener("click", async () => {
      await auth.signOut();
      redirectToLogin();
    });
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
})();
