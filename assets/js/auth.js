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
    });

    logoutButton.addEventListener("click", async () => {
      await auth.signOut();
      redirectToLogin();
    });
  }
})();
