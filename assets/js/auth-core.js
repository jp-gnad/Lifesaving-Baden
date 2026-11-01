(function () {
  "use strict";

  const persistencePromises = new WeakMap();
  const pendingReloads = new WeakMap();
  const pendingContexts = new WeakMap();
  const registrationNames = new Map();
  const transientCodes = new Set(["network-request-failed", "unavailable", "deadline-exceeded", "aborted", "internal"]);

  function isTransientError(error) {
    return transientCodes.has(String(error?.code || "").replace(/^(auth|firestore)\//, ""));
  }

  async function withRetry(operation) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        if (attempt >= 2 || !isTransientError(error)) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)));
      }
    }
  }

  function initFirebase() {
    if (!window.firebase.apps.length) window.firebase.initializeApp(window.firebaseConfig);
    return window.firebase.auth();
  }

  function ensureLocalAuthPersistence(auth) {
    if (!persistencePromises.has(auth)) {
      persistencePromises.set(auth, auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL).catch((error) => {
        console.warn("Dauerhafte Firebase-Anmeldung konnte nicht aktiviert werden.", error);
      }));
    }
    return persistencePromises.get(auth);
  }

  function isCurrentUser(user) {
    return Boolean(user && initFirebase().currentUser?.uid === user.uid);
  }

  function requireCurrentUser(user) {
    if (!isCurrentUser(user)) {
      const error = new Error("Die Anmeldung hat sich geändert. Bitte melde dich erneut an.");
      error.code = "auth/user-mismatch";
      throw error;
    }
  }

  function reloadUser(user) {
    if (!pendingReloads.has(user)) {
      const pending = withRetry(async () => {
        requireCurrentUser(user);
        await user.reload();
        requireCurrentUser(user);
        return initFirebase().currentUser;
      }).finally(() => pendingReloads.delete(user));
      pendingReloads.set(user, pending);
    }
    return pendingReloads.get(user);
  }

  function hasVerifiedAccess(user) {
    return Boolean(user && (user.emailVerified || user.providerData?.some((provider) => provider.providerId === "google.com")));
  }

  function rememberRegistrationName(uid, details) {
    registrationNames.set(uid, details);
    try {
      window.sessionStorage?.setItem(`lifesaving-baden:registration:${uid}`, JSON.stringify(details));
    } catch { /* The in-memory copy still works when storage is blocked. */ }
  }

  function readRegistrationName(uid) {
    if (registrationNames.has(uid)) return registrationNames.get(uid);
    try {
      return JSON.parse(window.sessionStorage?.getItem(`lifesaving-baden:registration:${uid}`) || "null");
    } catch { return null; }
  }

  function clearRegistrationName(uid) {
    registrationNames.delete(uid);
    try { window.sessionStorage?.removeItem(`lifesaving-baden:registration:${uid}`); } catch { /* Storage may be blocked. */ }
  }

  async function createAccountDocument(user, ref) {
    const name = normalizeNameDetails(readRegistrationName(user.uid) || splitDisplayNameIntoNameParts(user.displayName));
    const timestamp = window.firebase.firestore.FieldValue.serverTimestamp;
    const data = {
      uid: user.uid, email: user.email || "", ...name,
      emailVerified: Boolean(user.emailVerified),
      providerIds: (user.providerData || []).map((provider) => provider.providerId),
      role: "sportler", keepPersonalDataUntilRevoked: true, privateProfile: false, publicProfile: true,
    };
    // Recheck inside the transaction so another tab's role/profile is never overwritten.
    return window.firebase.firestore().runTransaction(async (transaction) => {
      requireCurrentUser(user);
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) return snapshot.data() || {};
      transaction.set(ref, { ...data, createdAt: timestamp(), updatedAt: timestamp(), lastSignInAt: timestamp() });
      return data;
    });
  }

  function loadUserContext(user) {
    if (!pendingContexts.has(user)) {
      const pending = withRetry(async (attempt) => {
        requireCurrentUser(user);
        const ref = window.firebase.firestore().collection("users").doc(user.uid);
        const snapshotPromise = ref.get({ source: "server" }).catch(async (error) => {
          if (attempt !== 2 || !isTransientError(error)) throw error;
          const cached = await ref.get();
          if (!cached.exists) throw error;
          return cached;
        });
        const [snapshot, token] = await Promise.all([snapshotPromise, user.getIdTokenResult(attempt === 0)]);
        requireCurrentUser(user);
        const userData = snapshot.exists ? snapshot.data() || {} : await createAccountDocument(user, ref);
        requireCurrentUser(user);
        clearRegistrationName(user.uid);
        return { userData, claims: token.claims || {} };
      }).finally(() => pendingContexts.delete(user));
      pendingContexts.set(user, pending);
    }
    return pendingContexts.get(user);
  }

  const rootUrl = new URL("../../", document.currentScript.src);

  function getSafeReturnUrl(value, fallback = new URL("app.html", rootUrl)) {
    try {
      const target = new URL(value || fallback.href, window.location.href);
      const loginPaths = [new URL("login.html", rootUrl).pathname, new URL("timer/login.html", rootUrl).pathname];
      if (target.origin === window.location.origin && !loginPaths.includes(target.pathname)) return target;
    } catch { /* Invalid targets use the member home. */ }
    return fallback;
  }

  function getLoginRedirectUrl() {
    const target = new URL("login.html", rootUrl);
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    if (returnTo) target.searchParams.set("returnTo", getSafeReturnUrl(returnTo).href);
    return target.href;
  }

  function getVerificationRedirectUrl() {
    const target = new URL(getLoginRedirectUrl());
    target.searchParams.set("verified", "1");
    return target.href;
  }

  function redirectToApp() {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    window.location.href = getSafeReturnUrl(returnTo).href;
  }

  function redirectToLogin(reason) {
    const target = new URL(getLoginRedirectUrl());
    if (window.location.pathname !== target.pathname) {
      target.searchParams.set("returnTo", getSafeReturnUrl(window.location.href).href);
    }
    if (reason) target.searchParams.set(reason, "1");
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
      "auth/popup-closed-by-user": "Das Google-Fenster wurde geschlossen, bevor die Anmeldung in dieser App angekommen ist. Bitte versuche es erneut.",
      "auth/cancelled-popup-request": "Eine andere Google-Anmeldung wurde geöffnet. Bitte verwende nur ein Anmeldefenster.",
      "auth/web-storage-unsupported": "Der Anmeldespeicher ist in dieser Web-App nicht verfügbar. Bitte teste die Anmeldung im Browser.",
      "auth/operation-not-supported-in-this-environment": "Die Google-Anmeldung wird in diesem App-Fenster nicht unterstützt. Bitte teste sie im Browser.",
      "auth/user-token-expired": "Die gespeicherte Sitzung ist abgelaufen. Bitte melde dich erneut an.",
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

    return messages[error?.code] || "Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.";
  }

  function normalizeNamePart(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function formatFullName(firstName, lastName) {
    return [normalizeNamePart(firstName), normalizeNamePart(lastName)]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  function splitDisplayNameIntoNameParts(displayName) {
    const normalizedName = normalizeNamePart(displayName);

    if (!normalizedName) {
      return {
        firstName: "",
        lastName: ""
      };
    }

    const parts = normalizedName.split(" ");

    if (parts.length === 1) {
      return {
        firstName: parts[0],
        lastName: ""
      };
    }

    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(" ")
    };
  }

  function normalizeNameDetails(details = {}) {
    const firstName = normalizeNamePart(details.firstName);
    const lastName = normalizeNamePart(details.lastName);
    const displayName = firstName && lastName
      ? formatFullName(firstName, lastName)
      : normalizeNamePart(details.displayName) || formatFullName(firstName, lastName);

    return {
      firstName,
      lastName,
      displayName
    };
  }

  function getNameDetailsFromData(data = {}, user = null) {
    const storedFirstName = normalizeNamePart(data?.firstName);
    const storedLastName = normalizeNamePart(data?.lastName);

    if (storedFirstName || storedLastName) {
      return normalizeNameDetails({
        firstName: storedFirstName,
        lastName: storedLastName,
        displayName: data?.displayName || user?.displayName || ""
      });
    }

    const sourceName = normalizeNamePart(data?.displayName || user?.displayName || "");

    return normalizeNameDetails({
      ...splitDisplayNameIntoNameParts(sourceName),
      displayName: sourceName
    });
  }

  function getDefaultAccountRole() {
    return {
      isAdmin: false,
      isOrganizer: false,
      isKaderAthlete: false,
      hasKaderAccess: false,
      label: "Sportler"
    };
  }

  function getAccountRole(data, claims) {
    const isAdmin = isAdminAccount(data, claims);
    const isOrganizer = isAdmin || isOrganizerAccount(data, claims);
    const isKaderRole = isKaderAthleteAccount(data, claims);
    const isKaderAthlete = !isOrganizer && isKaderRole;
    const hasKaderAccess = isAdmin || isOrganizer || isKaderRole;

    return {
      isAdmin,
      isOrganizer,
      isKaderAthlete,
      hasKaderAccess,
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
      || claims?.kader === true
      || claims?.isKaderAthlete === true
      || data?.kader === true
      || data?.isKaderAthlete === true
    );
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

  window.LifesavingAuth = Object.freeze({
    initFirebase, ensureLocalAuthPersistence, isCurrentUser, requireCurrentUser, reloadUser, hasVerifiedAccess,
    isTransientError, withRetry, loadUserContext, rememberRegistrationName,
    normalizeNamePart, formatFullName, splitDisplayNameIntoNameParts, normalizeNameDetails, getNameDetailsFromData,
    getDefaultAccountRole, getAccountRole, normalizeRole, hasRole, isAdminAccount, isOrganizerAccount, isKaderAthleteAccount,
    getSafeReturnUrl, getLoginRedirectUrl, getVerificationRedirectUrl, redirectToApp, redirectToLogin,
    setMessage, setLoading, translateAuthError, initPasswordVisibilityToggles,
  });
})();
