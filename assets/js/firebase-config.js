window.firebaseConfig = {
  apiKey: "AIzaSyBNUc19h-N7P-kmqGomzS6vhEpK7S6mhO4",
  authDomain: "lifesaving-baden.firebaseapp.com",
  projectId: "lifesaving-baden",
  storageBucket: "lifesaving-baden.firebasestorage.app",
  messagingSenderId: "1084669838363",
  appId: "1:1084669838363:web:8b44530d5b8f0cf88024be"
};

// Public OAuth client ID for direct Google sign-in; never put a client secret here.
window.googleSignInClientId = "1084669838363-gtpsm0uqi59u2b0j5ccmgu1l09b4209s.apps.googleusercontent.com";

const firebasePlaceholderValues = [
  "PASTE_API_KEY_HERE",
  "PASTE_PROJECT_ID.firebaseapp.com",
  "PASTE_PROJECT_ID",
  "PASTE_PROJECT_ID.firebasestorage.app",
  "PASTE_MESSAGING_SENDER_ID",
  "PASTE_APP_ID"
];

window.isFirebaseConfigured = Object.values(window.firebaseConfig).every(
  (value) => value && !firebasePlaceholderValues.includes(value)
);
