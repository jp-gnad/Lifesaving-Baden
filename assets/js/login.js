(function () {
  "use strict";
  const loginVersion = new URL(document.currentScript.src).searchParams.get("v") || "development";
  const googleAttemptKey = "lifesaving-baden:google-login-started";

  function hasPendingGoogleReturn() {
    try {
      const started = Number(window.sessionStorage?.getItem(googleAttemptKey));
      return started > 0 && Date.now() - started < 10 * 60 * 1000;
    } catch { return false; }
  }

  function rememberGoogleAttempt(pending) {
    try {
      if (pending) window.sessionStorage?.setItem(googleAttemptKey, String(Date.now()));
      else window.sessionStorage?.removeItem(googleAttemptKey);
    } catch { /* Login remains usable when session storage is unavailable. */ }
  }
  const {
    initFirebase, ensureLocalAuthPersistence, reloadUser, isCurrentUser, hasVerifiedAccess, initPasswordVisibilityToggles,
    rememberRegistrationName, normalizeNamePart, formatFullName,
    getLoginRedirectUrl, getVerificationRedirectUrl, redirectToApp, setMessage, setLoading, translateAuthError,
  } = window.LifesavingAuth;

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

  function initLoginPage(auth, googleProvider) {
    const params = new URLSearchParams(window.location.search);
    const loginForm = document.querySelector('[data-auth-form="login"]');
    const registerForm = document.querySelector('[data-auth-form="register"]');
    const googleButton = document.querySelector("[data-google-login]");
    const resendButton = document.querySelector("[data-resend-verification]");
    const resetPasswordButton = document.querySelector("[data-reset-password]");
    const returnTo = window.LifesavingAuth.getSafeReturnUrl(params.get("returnTo"));
    if (returnTo.pathname.includes("/timer/")) {
      document.querySelector("[data-login-context]").textContent =
        "Melde dich mit deinem Lifesaving-Baden-Konto an. Danach kehrst du automatisch zum Timer zurück.";
    }
    let loginRedirectStarted = false;
    let verifiedLoginPromise = null;
    let verifiedLoginUid = null;
    let authAction = null;
    let checkingGoogleReturn = hasPendingGoogleReturn();
    const localPersistenceReady = ensureLocalAuthPersistence(auth);
    // Prepare persistence before enabling the button, so the popup opens directly in the click gesture.
    googleButton.disabled = true;
    localPersistenceReady.then(() => {
      if (!checkingGoogleReturn && !authAction && !verifiedLoginPromise) googleButton.disabled = false;
    });
    if (checkingGoogleReturn) {
      setLoading(googleButton, true, "Anmeldung prüfen...");
      setMessage("login", "Die App wurde während der Google-Anmeldung neu geladen. Deine Anmeldung wird geprüft.");
    }

    async function finishVerifiedLogin(user) {
      if (loginRedirectStarted || !isCurrentUser(user)) {
        return;
      }

      if (verifiedLoginPromise && verifiedLoginUid === user.uid) {
        return verifiedLoginPromise;
      }

      verifiedLoginUid = user.uid;
      const pending = (async () => {
        if (authAction === "google" || checkingGoogleReturn) setLoading(googleButton, true, "Anmeldung prüfen...");
        await localPersistenceReady;
        const activeUser = await reloadUser(user);
        if (!isCurrentUser(activeUser)) return;

        if (!hasVerifiedAccess(activeUser)) {
          if (!authAction) setLoading(googleButton, false);
          showResendButton(true);
          setMessage("login", "Bitte bestätige zuerst deine E-Mail-Adresse, bevor du fortfährst.");
          return;
        }

        loginRedirectStarted = true;
        rememberGoogleAttempt(false);
        redirectToApp();
      })();
      verifiedLoginPromise = pending;

      try {
        await pending;
      } finally {
        if (verifiedLoginPromise === pending) verifiedLoginPromise = null;
      }
    }

    function showLoginError(error) {
      if (loginRedirectStarted || error?.code === "auth/user-mismatch") return;
      if (!authAction) setLoading(googleButton, false);
      const code = /^(auth|app)\/[a-z0-9-]+$/.test(error?.code || "") ? error.code : "app/unknown-login-error";
      const message = code === "app/google-session-missing"
        ? "Die Google-Anmeldung ist in dieser Web-App noch nicht angekommen. Bitte versuche es erneut."
        : translateAuthError(error);
      setMessage("login", message);
      const details = document.querySelector("[data-login-error-details]");
      if (details) {
        const standalone = window.navigator?.standalone || window.matchMedia?.("(display-mode: standalone)")?.matches;
        details.hidden = false;
        details.textContent = `Anmeldecode: ${code} · Version: ${loginVersion} · ${standalone ? "Web-App" : "Browser"}`;
      }
    }

    if (params.has("verified")) {
      setMessage("login", "E-Mail bestätigt. Du kannst jetzt den Login nutzen.", true);
    }

    if (params.has("needsVerification")) {
      setMessage("login", "Bitte bestätige zuerst deine E-Mail-Adresse.");
    }

    auth.onAuthStateChanged((user) => {
      if (!user) {
        showResendButton(false);
        if (checkingGoogleReturn) {
          checkingGoogleReturn = false;
          rememberGoogleAttempt(false);
          setLoading(googleButton, false);
          showLoginError({ code: "app/google-session-missing" });
        }
        return;
      }

      // A Google popup can remain pending (or reject) after Firebase has delivered the session.
      // Only registration must finish writing the name and sending verification before resuming.
      if (authAction !== "register") finishVerifiedLogin(user).catch(showLoginError);
      checkingGoogleReturn = false;
    });

    async function resumeLoginAfterGoogleWindow() {
      if (document.visibilityState === "hidden" || loginRedirectStarted || authAction === "register") {
        return;
      }

      await localPersistenceReady;

      if (auth.currentUser) {
        await finishVerifiedLogin(auth.currentUser);
      }
    }

    window.addEventListener("pageshow", () => {
      resumeLoginAfterGoogleWindow().catch(showLoginError);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        resumeLoginAfterGoogleWindow().catch(showLoginError);
      }
    });

    loginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (authAction) return;
      authAction = "login";

      const button = loginForm.querySelector('button[type="submit"]');
      const formData = new FormData(loginForm);
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");

      try {
        setLoading(button, true, "Login...");
        await localPersistenceReady;
        const { user } = await auth.signInWithEmailAndPassword(email, password);

        await finishVerifiedLogin(user);
      } catch (error) {
        setMessage("login", translateAuthError(error));
      } finally {
        authAction = null;
        setLoading(button, false);
      }
    });

    registerForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (authAction) return;

      const button = registerForm.querySelector('button[type="submit"]');
      const formData = new FormData(registerForm);
      const firstName = normalizeNamePart(formData.get("firstName"));
      const lastName = normalizeNamePart(formData.get("lastName"));
      const displayName = formatFullName(firstName, lastName);
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");

      if (!firstName || !lastName) {
        setMessage("register", "Bitte gib Vorname und Nachname an.");
        return;
      }

      try {
        authAction = "register";
        setLoading(button, true, "Konto erstellen...");
        await localPersistenceReady;
        const { user } = await auth.createUserWithEmailAndPassword(email, password);
        rememberRegistrationName(user.uid, { firstName, lastName, displayName });
        await user.updateProfile({ displayName });

        await user.sendEmailVerification({
          url: getVerificationRedirectUrl()
        });

        showTab("login");
        showResendButton(true);
        setMessage(
          "login",
          "Konto erstellt. Bitte bestätige deine E-Mail-Adresse. Danach schließen wir die Kontokonfiguration ab.",
          true
        );
        registerForm.reset();
      } catch (error) {
        setMessage("register", translateAuthError(error));
      } finally {
        authAction = null;
        setLoading(button, false);
      }
    });

    googleButton?.addEventListener("click", async () => {
      if (authAction) return;
      authAction = "google";
      rememberGoogleAttempt(true);
      const details = document.querySelector("[data-login-error-details]");
      if (details) details.hidden = true;
      setMessage("login", "");
      try {
        setLoading(googleButton, true, "Google öffnet...");
        const { user } = await auth.signInWithPopup(googleProvider);
        await finishVerifiedLogin(user);
        if (!loginRedirectStarted && !isCurrentUser(user)) showLoginError({ code: "app/google-session-missing" });
      } catch (error) {
        // Some iOS returns report a closed popup even though Auth already holds the Google session.
        let failure = error;
        if (!loginRedirectStarted && auth.currentUser?.providerData?.some((provider) => provider.providerId === "google.com")) {
          try { await finishVerifiedLogin(auth.currentUser); } catch (sessionError) { failure = sessionError; }
        }
        showLoginError(failure);
      } finally {
        authAction = null;
        rememberGoogleAttempt(false);
        if (!loginRedirectStarted) setLoading(googleButton, false);
      }
    });

    resetPasswordButton?.addEventListener("click", async () => {
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

    resendButton?.addEventListener("click", async () => {
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


  initPasswordVisibilityToggles();
  initTabs();
  if (!canUseFirebase()) return;
  const auth = initFirebase();
  const provider = new window.firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  initLoginPage(auth, provider);
})();
