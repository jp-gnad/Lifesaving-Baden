(function () {
  "use strict";

  const persistencePromises = new WeakMap();
  const pendingReloads = new WeakMap();
  const pendingContexts = new WeakMap();
  const transientCodes = new Set(["network-request-failed", "unavailable", "deadline-exceeded", "aborted", "internal"]);

  function isTransientError(error) {
    return transientCodes.has(String(error?.code || "").replace(/^(auth|firestore)\//, ""));
  }

  async function withRetry(operation, shouldRetry = isTransientError) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        if (attempt >= 2 || !shouldRetry(error)) throw error;
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
      persistencePromises.set(auth, auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL).then(() => true).catch((error) => {
        console.warn("Dauerhafte Firebase-Anmeldung konnte nicht aktiviert werden.", error);
        return false;
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

  async function hasVerifiedAccess(user) {
    if (!user || user.emailVerified) return Boolean(user);
    const providers = user.providerData || [];
    if (!providers.some((provider) => provider.providerId === "google.com")) return false;
    if (!providers.some((provider) => provider.providerId === "password")) return true;
    try {
      const token = await user.getIdTokenResult();
      return token.signInProvider === "google.com";
    } catch {
      return false;
    }
  }

  function newAccountData(user) {
    return {
      uid: user.uid, email: user.email || "", firstName: "", lastName: "", displayName: "",
      emailVerified: Boolean(user.emailVerified),
      providerIds: (user.providerData || []).map((provider) => provider.providerId),
      role: "standard", keepPersonalDataUntilRevoked: true, privateProfile: false, publicProfile: true,
      accountSetupRequired: true,
    };
  }

  async function createAccountDocument(user, ref) {
    const timestamp = window.firebase.firestore.FieldValue.serverTimestamp;
    const data = newAccountData(user);
    // Recheck inside the transaction so another tab's role/profile is never overwritten.
    return window.firebase.firestore().runTransaction(async (transaction) => {
      requireCurrentUser(user);
      const snapshot = await transaction.get(ref);
      requireCurrentUser(user);
      if (snapshot.exists) return snapshot.data() || {};
      transaction.set(ref, { ...data, createdAt: timestamp(), updatedAt: timestamp(), lastSignInAt: timestamp() });
      return data;
    });
  }

  async function saveAccountName(user, details, { onlyIfMissing = false } = {}) {
    requireCurrentUser(user);
    const name = normalizeNameDetails(details);
    if ((!name.firstName || !name.lastName) && !onlyIfMissing) {
      throw { code: "app/name-required" };
    }
    if (!name.firstName && !name.lastName) return null;
    const claims = onlyIfMissing ? (await user.getIdTokenResult()).claims || {} : {};
    requireCurrentUser(user);
    const db = window.firebase.firestore();
    const ref = db.collection("users").doc(user.uid);
    const timestamp = window.firebase.firestore.FieldValue.serverTimestamp;
    const saved = await db.runTransaction(async (transaction) => {
      requireCurrentUser(user);
      const snapshot = await transaction.get(ref);
      requireCurrentUser(user);
      // Claim-only admins retain their existing bootstrap path; owners cannot create admin profiles.
      if (!snapshot.exists && onlyIfMissing && isAdminAccount({}, claims)) return null;
      const data = snapshot.exists ? snapshot.data() || {} : newAccountData(user);
      // Provider data only seeds an empty profile. Never replace a chosen account name.
      if (onlyIfMissing && (data.firstName || data.lastName || data.displayName)) return data;
      const payload = { ...name, loginNameCaptured: Boolean(name.firstName && name.lastName), updatedAt: timestamp() };
      if (snapshot.exists) transaction.update(ref, payload);
      else transaction.set(ref, { ...data, ...payload, createdAt: timestamp(), lastSignInAt: timestamp() });
      return { ...data, ...payload };
    });
    requireCurrentUser(user);
    return saved;
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
        const userData = snapshot.exists ? snapshot.data() || {}
          : isAdminAccount({}, token.claims) ? {} : await createAccountDocument(user, ref);
        requireCurrentUser(user);
        return { userData, claims: token.claims || {} };
      }).finally(() => pendingContexts.delete(user));
      pendingContexts.set(user, pending);
    }
    return pendingContexts.get(user);
  }

  const rootUrl = new URL("../../", document.currentScript.src);
  const memberHomeUrl = new URL("app.html", rootUrl);

  function getLoginRedirectUrl() {
    return new URL("login.html", rootUrl).href;
  }

  function getVerificationRedirectUrl() {
    const target = new URL(getLoginRedirectUrl());
    target.searchParams.set("verified", "1");
    return target.href;
  }

  function requiresAccountSetup(data, claims = {}) {
    return data?.accountSetupRequired === true && !isAdminAccount(data, claims);
  }

  function redirectToAccountSetup() {
    window.location.replace(new URL("link-request.html", rootUrl).href);
  }

  function redirectToApp({ replace = false } = {}) {
    if (replace) window.location.replace(memberHomeUrl.href);
    else window.location.href = memberHomeUrl.href;
  }

  function redirectToLogin(reason) {
    const target = new URL(getLoginRedirectUrl());
    if (reason) target.searchParams.set(reason, "1");
    window.location.replace(target.href);
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
      "auth/network-request-failed": "Die Verbindung für die Anmeldung ist fehlgeschlagen oder hat zu lange gedauert. Bitte versuche es erneut.",
      "app/google-library-unavailable": "Die Google-Anmeldung konnte nicht geladen werden. Bitte versuche es über den Google-Button erneut.",
      "app/google-credential-missing": "Google hat keinen Anmeldenachweis zurückgegeben. Bitte versuche es erneut.",
      "app/google-session-missing": "Die Google-Anmeldung ist in dieser Web-App noch nicht angekommen. Bitte versuche es erneut.",
      "app/google-handoff-unavailable": "Die Google-Anmeldung ist abgelaufen oder konnte nach dem Seitenwechsel nicht fortgesetzt werden. Bitte starte sie erneut.",
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
      "app/name-required": "Bitte gib Vorname und Nachname ein.",
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
    const sourceName = normalizeNamePart(data?.displayName ?? user?.displayName);

    if (storedFirstName || storedLastName) {
      return normalizeNameDetails({
        firstName: storedFirstName,
        lastName: storedLastName,
        displayName: sourceName
      });
    }

    return normalizeNameDetails({
      ...splitDisplayNameIntoNameParts(sourceName),
      displayName: sourceName
    });
  }

  function getDefaultAccountRole() {
    return getAccountRole({}, {});
  }

  function getAccountRole(data, claims) {
    const isAdmin = isAdminAccount(data, claims);
    const roles = [normalizeRole(data?.role), normalizeRole(claims?.role)];
    const isOrganizer = isAdmin || roles.includes("organizer")
      || claims?.organizer === true || claims?.isOrganizer === true;
    const isTrainer = isOrganizer || roles.includes("trainer");
    const isAthlete = isTrainer || roles.includes("athlete")
      || claims?.kader === true || claims?.isKaderAthlete === true
      || data?.kader === true || data?.isKaderAthlete === true;
    const value = isAdmin ? "admin" : isOrganizer ? "organizer" : isTrainer ? "trainer" : isAthlete ? "athlete" : "standard";
    const labels = { admin: "Admin", organizer: "Organisator", trainer: "Trainer", athlete: "Sportler", standard: "Standard" };
    return { value, isAdmin, isOrganizer, isTrainer, isAthlete, label: labels[value] };
  }

  function normalizeRole(value) {
    const role = String(value || "").trim().toLowerCase();
    return ({ organisator: "organizer", "kader-sportler": "athlete", kadersportler: "athlete", kader: "athlete", sportler: "standard" })[role] || role;
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
    isTransientError, withRetry, loadUserContext, saveAccountName,
    normalizeNamePart, formatFullName, splitDisplayNameIntoNameParts, normalizeNameDetails, getNameDetailsFromData,
    getDefaultAccountRole, getAccountRole, normalizeRole, hasRole, isAdminAccount,
    getLoginRedirectUrl, getVerificationRedirectUrl, redirectToApp, redirectToLogin, requiresAccountSetup, redirectToAccountSetup,
    setMessage, setLoading, translateAuthError, initPasswordVisibilityToggles,
  });
})();
