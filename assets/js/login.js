(function () {
  "use strict";
  const googleAttemptKey = "lifesaving-baden:google-login-started";
  // Remove only the retired support trace; keep all account and handoff storage.
  try { window.localStorage?.removeItem("lifesaving-baden:login-trace-v1"); }
  catch { /* Login remains usable when local storage is blocked. */ }
  let googleIdentityLoading = null;

  function loadGoogleIdentity() {
    const available = () => window.google?.accounts?.id;
    if (available()?.initialize && available()?.renderButton) return Promise.resolve(available());
    if (!googleIdentityLoading) {
      googleIdentityLoading = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client?hl=de";
        script.async = true;
        let settled = false;
        const finish = (failed) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          if (failed || !available()?.initialize || !available()?.renderButton) {
            script.remove();
            reject({ code: "app/google-library-unavailable" });
          } else resolve(available());
        };
        const timeout = window.setTimeout(() => finish(true), 15000);
        script.addEventListener("load", () => finish(false), { once: true });
        script.addEventListener("error", () => finish(true), { once: true });
        document.head.appendChild(script);
      }).catch((error) => {
        googleIdentityLoading = null;
        throw error;
      });
    }
    return googleIdentityLoading;
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
    initFirebase, ensureLocalAuthPersistence, reloadUser, withRetry, isCurrentUser, hasVerifiedAccess, initPasswordVisibilityToggles,
    getLoginRedirectUrl, getVerificationRedirectUrl, redirectToApp, setMessage, setLoading, translateAuthError,
  } = window.LifesavingAuth;

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
    const googleButton = document.querySelector("[data-google-login]");
    const googleIdentityButton = document.querySelector("[data-google-identity]");
    const googleIdentityAction = document.querySelector("[data-google-identity-action]");
    const resendButton = document.querySelector("[data-resend-verification]");
    const resetPasswordButton = document.querySelector("[data-reset-password]");
    const changeEmailButton = document.querySelector("[data-change-email]");
    const emailSummary = document.querySelector("[data-login-email-summary]");
    const dividerCopy = document.querySelector("[data-login-divider-copy]");
    const mobileLoginQuery = window.matchMedia?.("(max-width: 700px)");
    ["gesturestart", "gesturechange"].forEach((type) => {
      document.addEventListener(type, (event) => {
        if (mobileLoginQuery?.matches) event.preventDefault();
      }, { passive: false });
    });
    const loginTitle = document.querySelector("#auth-title");
    const emailInput = loginForm?.querySelector('input[name="email"]');
    const passwordInput = loginForm?.querySelector('input[name="password"]');
    const loginButton = loginForm?.querySelector('button[type="submit"]');
    let passwordStep = false;
    let emailSubmissionPending = false;

    function lockMobileInputs() {
      if (!mobileLoginQuery?.matches) return;
      if (emailInput) emailInput.readOnly = true;
      if (passwordInput) passwordInput.readOnly = true;
    }

    [emailInput, passwordInput].forEach((input) => {
      if (!input) return;
      input.readOnly = Boolean(mobileLoginQuery?.matches);
      input.addEventListener("pointerdown", () => { input.readOnly = false; });
      input.addEventListener("click", () => {
        input.readOnly = false;
        input.focus();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Tab" && event.key !== "Escape") input.readOnly = false;
      });
    });

    function focusMobileHeading() {
      if (!passwordStep && mobileLoginQuery?.matches) loginTitle?.focus({ preventScroll: true });
    }

    function updateEmailButton() {
      if (loginButton) loginButton.disabled = emailSubmissionPending || !String(new FormData(loginForm).get("email") || "").trim();
    }

    function updateEmailStep() {
      updateEmailButton();
      const emailStep = !passwordStep;
      loginForm?.classList.toggle("is-email-step", emailStep);
      if (emailSummary) {
        emailSummary.hidden = emailStep;
        emailSummary.textContent = emailStep ? "" : String(new FormData(loginForm).get("email") || "").trim();
      }
      if (dividerCopy) dividerCopy.hidden = !emailStep;
      if (changeEmailButton) changeEmailButton.hidden = emailStep;
      if (emailInput) emailInput.placeholder = "Deine E-Mail";
      if (passwordInput) {
        passwordInput.required = !emailStep;
        passwordInput.placeholder = "Dein Passwort";
      }
    }

    emailInput?.addEventListener("input", () => {
      if (passwordStep) {
        passwordStep = false;
        passwordInput.value = "";
        setMessage("login", "");
      }
      updateEmailStep();
    });
    changeEmailButton?.addEventListener("click", () => {
      if (authAction) return;
      passwordStep = false;
      passwordInput.value = "";
      setMessage("login", "");
      updateEmailStep();
      if (mobileLoginQuery?.matches) focusMobileHeading();
      else emailInput?.focus();
    });
    emailInput?.addEventListener("change", updateEmailButton);
    mobileLoginQuery?.addEventListener("change", () => {
      if (!mobileLoginQuery.matches) {
        if (emailInput) emailInput.readOnly = false;
        if (passwordInput) passwordInput.readOnly = false;
      }
      updateEmailStep();
    });
    updateEmailStep();
    focusMobileHeading();
    let loginRedirectStarted = false;
    let verifiedLoginPromise = null;
    let verifiedLoginUid = null;
    let authAction = null;
    let checkingGoogleReturn = hasPendingGoogleReturn();
    const standalone = window.navigator?.standalone || window.matchMedia?.("(display-mode: standalone)")?.matches;
    // Redirect needs same-origin helpers. Installed GitHub Pages apps use Google directly instead.
    const useRedirect = Boolean(standalone && window.firebaseConfig?.authDomain
      && window.location.origin === `https://${window.firebaseConfig.authDomain}`);
    const useDirectGoogle = Boolean(standalone && /\.github\.io$/.test(window.location.hostname)
      && window.googleSignInClientId && !useRedirect);
    const googleHandoff = window.LifesavingGoogleHandoff;
    let googleHandoffPending = Boolean(useDirectGoogle && googleHandoff?.read());
    let googleHandoffProcessing = false;
    let loginPageLeaving = false;
    let directGoogleReady = false;
    let directGoogleLoading = null;
    let directGoogleAttempt = false;
    let googleForegroundWaiter = null;
    let redirectResultPending = useRedirect;
    const localPersistenceReady = ensureLocalAuthPersistence(auth);
    // Prepare persistence before enabling the button, so the popup opens directly in the click gesture.
    googleButton.disabled = true;
    localPersistenceReady.then(() => {
      if (!useDirectGoogle && !checkingGoogleReturn && !authAction && !verifiedLoginPromise && !redirectResultPending) googleButton.disabled = false;
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
      setMessage("login", translateAuthError(error));
    }

    function showDirectGoogleButton() {
      if (!useDirectGoogle) return;
      googleIdentityButton.hidden = !directGoogleReady;
      googleButton.hidden = directGoogleReady;
    }

    function startDirectGoogle() {
      if (authAction || loginRedirectStarted) return;
      googleHandoff?.clear();
      // The provider owns the popup; cancellation must not leave our forms locked.
      directGoogleAttempt = true;
      rememberGoogleAttempt(true);
      setMessage("login", "Google öffnet … Bitte wähle dein Konto. Du kannst den Google-Button bei Bedarf erneut verwenden.");
    }

    function resumeGoogleForeground() {
      if (document.visibilityState !== "hidden" && googleForegroundWaiter) {
        const resume = googleForegroundWaiter;
        googleForegroundWaiter = null;
        resume();
      }
    }

    async function waitForGoogleForeground() {
      for (;;) {
        if (document.visibilityState === "hidden") {
          await new Promise((resolve) => { googleForegroundWaiter = resolve; });
        }
        // Let queued return/visibility events run before issuing the request.
        await new Promise((resolve) => {
          if (window.requestAnimationFrame) window.requestAnimationFrame(resolve);
          else window.setTimeout(resolve, 0);
        });
        if (document.visibilityState !== "hidden") {
          return;
        }
      }
    }

    async function receiveGoogleCredential(response, resuming = false) {
      if ((!resuming && !directGoogleAttempt) || authAction || loginRedirectStarted) return;
      directGoogleAttempt = false;
      googleHandoffProcessing = true;
      let navigating = false;
      authAction = "google";
      googleIdentityButton.hidden = true;
      googleButton.hidden = false;
      setLoading(googleButton, true, "Anmeldung prüfen...");
      setMessage("login", "");
      try {
        if (typeof response?.credential !== "string" || !response.credential) throw { code: "app/google-credential-missing" };
        if (!resuming && googleHandoff?.save(response.credential)) {
          googleHandoffPending = true;
          rememberGoogleAttempt(true);
          // Keep the proof in this tab's session storage, never in the URL.
          window.location.replace(window.location.href);
          navigating = true;
          return;
        }
        await localPersistenceReady;
        // Firebase validates the Google ID token.
        const credential = window.firebase.auth.GoogleAuthProvider.credential(response.credential);
        const result = await withRetry(async (attempt) => {
          if (loginPageLeaving) return null;
          if (attempt) {
            setLoading(googleButton, true, "Verbindung erneut prüfen...");
          }
          await waitForGoogleForeground();
          if (loginRedirectStarted || loginPageLeaving) return null;
          if (resuming && !googleHandoff.takeAttempt()) throw { code: "app/google-handoff-unavailable" };
          return auth.signInWithCredential(credential);
        }, (error) => !loginPageLeaving && error?.code === "auth/network-request-failed");
        if (!result) return;
        googleHandoff?.clear();
        googleHandoffPending = false;
        await finishVerifiedLogin(result.user);
      } catch (error) {
        if (!loginPageLeaving) showLoginError(error);
      } finally {
        googleHandoffProcessing = false;
        if (!navigating) {
          authAction = null;
          if (!loginPageLeaving || !googleHandoffPending) {
            googleHandoff?.clear();
            googleHandoffPending = false;
            checkingGoogleReturn = false;
            rememberGoogleAttempt(false);
            if (!loginRedirectStarted) {
              setLoading(googleButton, false);
              showDirectGoogleButton();
              if (!directGoogleReady) prepareDirectGoogle();
            }
          }
        }
      }
    }

    function resumeGoogleHandoff() {
      if (!googleHandoffPending || googleHandoffProcessing || loginRedirectStarted) return;
      const pending = googleHandoff.read();
      if (!pending) {
        googleHandoffPending = false;
        authAction = null;
        checkingGoogleReturn = false;
        rememberGoogleAttempt(false);
        showLoginError({ code: "app/google-handoff-unavailable" });
        prepareDirectGoogle();
        return;
      }
      authAction = null;
      receiveGoogleCredential({ credential: pending.token }, true);
    }

    function prepareDirectGoogle() {
      if (directGoogleReady || directGoogleLoading || loginRedirectStarted) return directGoogleLoading;
      googleButton.disabled = true;
      directGoogleLoading = (async () => {
        try {
          const identity = await loadGoogleIdentity();
          await localPersistenceReady;
          if (loginRedirectStarted) return;
          identity.initialize({
            client_id: window.googleSignInClientId,
            callback: (response) => receiveGoogleCredential(response),
            auto_select: false,
            ux_mode: "popup",
          });
          const buttonWidth = Math.min(400, googleButton.parentElement?.clientWidth || googleButton.clientWidth || 300);
          identity.renderButton(googleIdentityAction, {
            // Keep Google's actual control intact, including its iframe and keyboard handling.
            type: "standard", theme: "filled_black", size: "medium",
            text: "signin_with",
            shape: "rectangular", locale: "de", logo_alignment: "left",
            width: buttonWidth,
            click_listener: startDirectGoogle,
          });
          googleIdentityAction.style.setProperty("--google-button-width", `${buttonWidth}px`);
          // Resize only the click target so an open Google popup is never replaced.
          const fitGoogleControl = () => {
            const width = googleButton.parentElement?.clientWidth || buttonWidth;
            googleIdentityAction.style.setProperty("--google-button-scale-x", String((width + 8) / buttonWidth));
          };
          fitGoogleControl();
          if (window.ResizeObserver && googleButton.parentElement) {
            new window.ResizeObserver(fitGoogleControl).observe(googleButton.parentElement);
          } else {
            window.addEventListener("resize", fitGoogleControl);
          }
          // Focus inside Google's iframe does not propagate through :focus-within in every browser.
          window.addEventListener("blur", () => {
            window.requestAnimationFrame(() => {
              googleIdentityButton.classList.toggle("has-google-focus", googleIdentityAction.contains(document.activeElement));
            });
          });
          document.addEventListener("focusin", () => googleIdentityButton.classList.remove("has-google-focus"));
          directGoogleReady = true;
          setLoading(googleButton, false);
          showDirectGoogleButton();
        } catch (error) {
          setLoading(googleButton, false);
          showLoginError(error);
        } finally {
          directGoogleLoading = null;
        }
      })();
      return directGoogleLoading;
    }

    if (useDirectGoogle && !googleHandoffPending) prepareDirectGoogle();

    if (params.has("verified")) {
      setMessage("login", "E-Mail bestätigt. Du kannst jetzt den Login nutzen.", true);
    }

    if (params.has("needsVerification")) {
      setMessage("login", "Bitte bestätige zuerst deine E-Mail-Adresse.");
    }

    auth.onAuthStateChanged((user) => {
      if (redirectResultPending || googleHandoffPending) return;
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
          const result = await auth.getRedirectResult();
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

    if (googleHandoffPending) resumeGoogleHandoff();

    async function resumeLoginAfterGoogleWindow() {
      if (document.visibilityState === "hidden" || loginRedirectStarted || authAction === "register" || redirectResultPending || googleHandoffPending) {
        return;
      }

      await localPersistenceReady;

      if (auth.currentUser) {
        await finishVerifiedLogin(auth.currentUser);
      }
    }

    window.addEventListener("pageshow", (event) => {
      updateEmailButton();
      if (event?.persisted) lockMobileInputs();
      focusMobileHeading();
      loginPageLeaving = false;
      resumeGoogleForeground();
      if (event?.persisted) resumeGoogleHandoff();
      resumeLoginAfterGoogleWindow().catch(showLoginError);
    });
    window.addEventListener("pagehide", () => {
      lockMobileInputs();
      loginPageLeaving = true;
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        resumeGoogleForeground();
        resumeLoginAfterGoogleWindow().catch(showLoginError);
      }
    });

    loginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(loginForm);
      const email = String(formData.get("email") || "").trim();
      if (authAction || !email) return;
      directGoogleAttempt = false;
      googleHandoff?.clear();
      rememberGoogleAttempt(false);
      if (!passwordStep) {
        passwordStep = true;
        updateEmailStep();
        if (passwordInput) passwordInput.readOnly = false;
        passwordInput?.focus();
        return;
      }
      authAction = "login";

      const button = loginButton;
      emailSubmissionPending = true;
      const password = String(formData.get("password") || "");
      setMessage("login", "");

      try {
        setLoading(button, true, "Anmelden...");
        await localPersistenceReady;
        let result;
        try {
          result = await auth.signInWithEmailAndPassword(email, password);
        } catch (error) {
          if (!["auth/user-not-found", "auth/invalid-credential", "auth/invalid-login-credentials"].includes(error?.code)) throw error;
          // Email enumeration protection prevents an email-only account lookup.
          authAction = "register";
          try {
            result = await auth.createUserWithEmailAndPassword(email, password);
          } catch (registrationError) {
            if (registrationError?.code === "auth/email-already-in-use") throw { code: "auth/invalid-credential" };
            throw registrationError;
          }
          if (!isCurrentUser(result.user)) return;
          showResendButton(true);
          await result.user.sendEmailVerification({ url: getVerificationRedirectUrl() });
          passwordInput.value = "";
          passwordStep = false;
          updateEmailStep();
          setMessage("login", "Konto erstellt. Bitte bestätige deine E-Mail-Adresse über den Link in deinem Postfach. Danach kannst du dich anmelden.", true);
          return;
        }
        await finishVerifiedLogin(result.user);
      } catch (error) {
        setMessage("login", translateAuthError(error));
      } finally {
        authAction = null;
        setLoading(button, false);
        emailSubmissionPending = false;
        updateEmailButton();
      }
    });

    googleButton?.addEventListener("click", async () => {
      if (authAction || redirectResultPending) return;
      if (useDirectGoogle) {
        setMessage("login", "");
        await prepareDirectGoogle();
        return;
      }
      authAction = "google";
      let redirectStarted = false;
      rememberGoogleAttempt(true);
      setMessage("login", "");
      try {
        setLoading(googleButton, true, "Google öffnet...");
        if (useRedirect) {
          await localPersistenceReady;
          redirectStarted = true;
          await auth.signInWithRedirect(googleProvider);
          return;
        }
        const { user } = await auth.signInWithPopup(googleProvider);
        await finishVerifiedLogin(user);
        if (!loginRedirectStarted && !isCurrentUser(user)) showLoginError({ code: "app/google-session-missing" });
      } catch (error) {
        redirectStarted = false;
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
  if (!canUseFirebase()) {
    return;
  }
  const auth = initFirebase();
  const provider = new window.firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  initLoginPage(auth, provider);
})();
