(function () {
  "use strict";
  let profile = null;
  let onAuth;
  const notify = message => window.parent.postMessage({ type: "login-fixture", message }, window.parent.location.origin);
  const user = {
    uid: "local-preview", email: "anna@example.test", emailVerified: false,
    providerData: [{ providerId: "password" }],
    async reload() {}, async getIdTokenResult() { return { claims: {} }; },
    async sendEmailVerification() {
      if (!profile?.firstName || !profile?.lastName) throw new Error("Name fehlt");
      notify(`Test bestanden: ${profile.firstName} ${profile.lastName} gespeichert, danach Bestätigungsmail angefordert (simuliert).`);
    },
  };
  const auth = {
    currentUser: document.body.dataset.fixtureMode === "resume" ? user : null,
    async setPersistence() {},
    onAuthStateChanged(callback) { onAuth = callback; queueMicrotask(() => callback(this.currentUser)); },
    async signInWithEmailAndPassword() { throw { code: "auth/invalid-credential" }; },
    async createUserWithEmailAndPassword(email) { user.email = email; this.currentUser = user; onAuth(user); return { user }; },
    async signOut() { this.currentUser = null; onAuth(null); },
    async signInWithPopup() { throw { code: "auth/popup-closed-by-user" }; },
    async sendPasswordResetEmail() { notify("Passwort-Reset simuliert; es wurde keine E-Mail verschickt."); },
  };
  const ref = { async get() { return { exists: profile !== null, data: () => profile }; } };
  const db = {
    collection: () => ({ doc: () => ref }),
    async runTransaction(operation) {
      return operation({ get: () => ref.get(), set: (_, value) => { profile = value; }, update: (_, value) => { profile = { ...profile, ...value }; } });
    },
  };
  const authFactory = () => auth;
  authFactory.Auth = { Persistence: { LOCAL: "local" } };
  authFactory.GoogleAuthProvider = class { setCustomParameters() {} };
  const firestore = () => db;
  firestore.FieldValue = { serverTimestamp: () => "local-test-timestamp" };
  window.firebase = { apps: [{}], auth: authFactory, firestore };
  window.firebaseConfig = { projectId: "demo-lifesaving-baden", authDomain: "localhost" };
  window.isFirebaseConfigured = true;
})();
