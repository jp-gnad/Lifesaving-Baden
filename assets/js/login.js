(function () {
  "use strict";
  const loginVersion = new URL(document.currentScript.src).searchParams.get("v") || "development";
  const googleAttemptKey = "lifesaving-baden:google-login-started";
  const traceKey = "lifesaving-baden:login-trace-v1";
  const traceTtl = 10 * 60 * 1000;
  // This labels a page execution, never an account or a device.
  const pageLabel = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  const diagnosticLabels = Object.freeze({
    start: "Anmeldeskript gestartet", shown: "Loginseite angezeigt", restored: "Loginseite aus Verlauf wiederhergestellt",
    pagehide: "Loginseite verlassen oder ausgeblendet", visible: "App wieder sichtbar", hidden: "App ausgeblendet",
    persistence: "Sitzungsspeicher geprüft", profile: "Firebase-Konto aktualisiert",
    complete: "Anmeldung abgeschlossen; Weiterleitung gestartet", user: "Firebase-Anmeldeereignis: Sitzung vorhanden",
    guest: "Firebase-Anmeldeereignis: keine Sitzung", redirect_check: "Google-Rückgabe nach Seitenstart wird geprüft",
    redirect_result: "Google-Weiterleitung hat ein Ergebnis geliefert", redirect_empty: "Keine ausstehende Google-Rückgabe",
    google: "Google-Anmeldung gestartet", redirect: "Google-Weiterleitung gestartet",
    popup_result: "Google-Fenster hat ein Ergebnis geliefert", unavailable: "Firebase-Anmeldung nicht verfügbar",
    error: "Anmeldefehler", popup_error: "Google-Fenster meldet",
  });
  let diagnosticEvents = [];
  let diagnosticSequence = 0;
  let diagnosticTraceStorage = "noch nicht geprüft";
  const initialGoogleMarker = hasPendingGoogleReturn();
  let diagnosticAuth = null;
  let diagnosticPersistence = "wird vorbereitet";
  let diagnosticErrorCode = "keiner";
  let diagnosticGoogleMethod = "Popup";

  function safeErrorCode(error) {
    return /^(auth|app)\/[a-z0-9-]+$/.test(error?.code || "") ? error.code : "app/unknown-login-error";
  }

  function readTrace() {
    try {
      const data = JSON.parse(window.localStorage?.getItem(traceKey) || "null");
      if (!Array.isArray(data?.entries)) return [];
      return data.entries.filter((entry) => entry && Object.hasOwn(diagnosticLabels, entry.id)
        && /^[a-z0-9]{8}$/.test(entry.page) && Number.isInteger(entry.seq) && entry.seq > 0
        && Number.isFinite(entry.time) && Date.now() - entry.time >= 0 && Date.now() - entry.time < traceTtl
        && (entry.code === undefined || /^(auth|app)\/[a-z0-9-]+$/.test(entry.code)))
        .slice(-24).map(({ id, page, seq, time, code }) => ({ id, page, seq, time, ...(code ? { code } : {}) }));
    } catch { return []; }
  }

  function navigationType() {
    const type = window.performance?.getEntriesByType?.("navigation")?.[0]?.type;
    return ["navigate", "reload", "back_forward", "prerender"].includes(type) ? type : "unbekannt";
  }

  function refreshDiagnostics() {
    const output = document.querySelector("[data-login-diagnostics-output]");
    if (!output) return "";
    const standalone = window.navigator?.standalone || window.matchMedia?.("(display-mode: standalone)")?.matches;
    const text = [
      `Loginversion: ${loginVersion}`,
      `Firebase-Version: ${window.firebase?.SDK_VERSION || "unbekannt"}`,
      `Modus: ${standalone ? "Web-App" : "Browser"}`,
      `Google-Verfahren: ${diagnosticGoogleMethod}`,
      `Aktuelle Seite: ${pageLabel}`,
      `Navigationsart: ${navigationType()}`,
      `Fensteröffner: ${window.opener ? "vorhanden" : "keiner"}`,
      `Google-Startmarker bei Seitenstart: ${initialGoogleMarker ? "vorhanden" : "keiner"}`,
      `Lokaler Diagnoseverlauf: ${diagnosticTraceStorage}`,
      `Sitzungsspeicher: ${diagnosticPersistence}`,
      `Firebase-Sitzung: ${diagnosticAuth?.currentUser ? "vorhanden" : "keine"}`,
      `Letzter Fehlercode: ${diagnosticErrorCode}`,
      "Ablauf (maximal 10 Minuten):", ...diagnosticEvents.map((entry) =>
        `[Seite ${entry.page}] ${diagnosticLabels[entry.id]}${entry.code ? `: ${entry.code}` : ""}`),
    ].join("\n");
    output.textContent = text;
    return text;
  }

  function recordDiagnostic(id, code) {
    const current = { id, page: pageLabel, seq: ++diagnosticSequence, time: Date.now(), ...(code ? { code } : {}) };
    const merged = new Map([...readTrace(), ...diagnosticEvents, current]
      .filter((entry) => Date.now() - entry.time >= 0 && Date.now() - entry.time < traceTtl)
      .map((entry) => [`${entry.page}:${entry.seq}`, entry]));
    diagnosticEvents = [...merged.values()].sort((a, b) => a.time - b.time).slice(-24);
    try {
      if (!window.localStorage) throw new Error("Storage unavailable");
      const serialized = JSON.stringify({ entries: diagnosticEvents });
      window.localStorage.setItem(traceKey, serialized);
      diagnosticTraceStorage = window.localStorage.getItem(traceKey) === serialized ? "gespeichert" : "nicht verfügbar";
    } catch { diagnosticTraceStorage = "nicht verfügbar (nur aktuelle Seite)"; }
    refreshDiagnostics();
  }

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
    const standalone = window.navigator?.standalone || window.matchMedia?.("(display-mode: standalone)")?.matches;
    // Redirect sign-in needs same-origin helpers; cross-origin GitHub Pages keeps its existing popup flow.
    const useRedirect = Boolean(standalone && window.firebaseConfig?.authDomain
      && window.location.origin === `https://${window.firebaseConfig.authDomain}`);
    let redirectResultPending = useRedirect;
    diagnosticGoogleMethod = useRedirect ? "Weiterleitung auf derselben Domain" : "Popup";
    diagnosticAuth = auth;
    const localPersistenceReady = ensureLocalAuthPersistence(auth);
    // Prepare persistence before enabling the button, so the popup opens directly in the click gesture.
    googleButton.disabled = true;
    localPersistenceReady.then((persistent) => {
      diagnosticPersistence = persistent ? "dauerhaft verfügbar" : "nicht dauerhaft verfügbar";
      recordDiagnostic("persistence");
      if (!checkingGoogleReturn && !authAction && !verifiedLoginPromise && !redirectResultPending) googleButton.disabled = false;
    });
    if (checkingGoogleReturn) {
      setLoading(googleButton, true, "Anmeldung prüfen...");
      setMessage("login", useRedirect
        ? "Die Google-Anmeldung wird abgeschlossen."
        : "Die App wurde während der Google-Anmeldung neu geladen. Deine Anmeldung wird geprüft.");
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
        recordDiagnostic("profile");
        if (!isCurrentUser(activeUser)) return;

        if (!hasVerifiedAccess(activeUser)) {
          if (!authAction) setLoading(googleButton, false);
          showResendButton(true);
          setMessage("login", "Bitte bestätige zuerst deine E-Mail-Adresse, bevor du fortfährst.");
          return;
        }

        loginRedirectStarted = true;
        recordDiagnostic("complete");
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
      const code = safeErrorCode(error);
      diagnosticErrorCode = code;
      recordDiagnostic("error", code);
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
      recordDiagnostic(user ? "user" : "guest");
      if (redirectResultPending) return;
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

    if (useRedirect) {
      (async () => {
        try {
          await localPersistenceReady;
          recordDiagnostic("redirect_check");
          const result = await auth.getRedirectResult();
          recordDiagnostic(result?.user ? "redirect_result" : "redirect_empty");
          redirectResultPending = false;
          const user = result?.user || auth.currentUser;
          if (user) {
            await finishVerifiedLogin(user);
            if (!isCurrentUser(user)) showLoginError({ code: "app/google-session-missing" });
          } else if (checkingGoogleReturn) {
            showLoginError({ code: "app/google-session-missing" });
          }
        } catch (error) {
          showLoginError(error);
        } finally {
          redirectResultPending = false;
          checkingGoogleReturn = false;
          rememberGoogleAttempt(false);
          if (!loginRedirectStarted && !authAction) setLoading(googleButton, false);
        }
      })();
    }

    async function resumeLoginAfterGoogleWindow() {
      if (document.visibilityState === "hidden" || loginRedirectStarted || authAction === "register" || redirectResultPending) {
        return;
      }

      await localPersistenceReady;

      if (auth.currentUser) {
        await finishVerifiedLogin(auth.currentUser);
      }
    }

    window.addEventListener("pageshow", (event) => {
      recordDiagnostic(event?.persisted ? "restored" : "shown");
      resumeLoginAfterGoogleWindow().catch(showLoginError);
    });
    window.addEventListener("pagehide", () => recordDiagnostic("pagehide"));
    document.addEventListener("visibilitychange", () => {
      recordDiagnostic(document.visibilityState === "visible" ? "visible" : "hidden");
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
      if (authAction || redirectResultPending) return;
      authAction = "google";
      let redirectStarted = false;
      diagnosticErrorCode = "keiner";
      recordDiagnostic("google");
      rememberGoogleAttempt(true);
      const details = document.querySelector("[data-login-error-details]");
      if (details) details.hidden = true;
      setMessage("login", "");
      try {
        setLoading(googleButton, true, "Google öffnet...");
        if (useRedirect) {
          await localPersistenceReady;
          recordDiagnostic("redirect");
          redirectStarted = true;
          await auth.signInWithRedirect(googleProvider);
          return;
        }
        const { user } = await auth.signInWithPopup(googleProvider);
        recordDiagnostic("popup_result");
        await finishVerifiedLogin(user);
        if (!loginRedirectStarted && !isCurrentUser(user)) showLoginError({ code: "app/google-session-missing" });
      } catch (error) {
        redirectStarted = false;
        recordDiagnostic("popup_error", safeErrorCode(error));
        // Some iOS returns report a closed popup even though Auth already holds the Google session.
        let failure = error;
        if (!loginRedirectStarted && auth.currentUser?.providerData?.some((provider) => provider.providerId === "google.com")) {
          try { await finishVerifiedLogin(auth.currentUser); } catch (sessionError) { failure = sessionError; }
        }
        showLoginError(failure);
      } finally {
        if (!redirectStarted) {
          authAction = null;
          rememberGoogleAttempt(false);
          if (!loginRedirectStarted) setLoading(googleButton, false);
        }
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
  recordDiagnostic("start");
  document.querySelector("[data-login-diagnostics]")?.addEventListener("toggle", refreshDiagnostics);
  document.querySelector("[data-login-diagnostics-copy]")?.addEventListener("click", async () => {
    const text = refreshDiagnostics();
    const status = document.querySelector("[data-login-diagnostics-copy-status]");
    try {
      await window.navigator.clipboard.writeText(text);
      if (status) status.textContent = "Status kopiert. Du kannst ihn zur Fehleranalyse einfügen.";
    } catch {
      if (status) status.textContent = "Bitte den Statustext oben markieren und kopieren.";
    }
  });
  if (!canUseFirebase()) {
    recordDiagnostic("unavailable");
    return;
  }
  const auth = initFirebase();
  const provider = new window.firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  initLoginPage(auth, provider);
})();
