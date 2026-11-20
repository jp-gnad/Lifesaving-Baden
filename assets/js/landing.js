(function () {
  "use strict";
  const { initFirebase, hasVerifiedAccess, isCurrentUser, redirectToApp, redirectToLogin } = window.LifesavingAuth;
  const launch = document.documentElement.classList;
  const standalone = launch.contains("app-launching");
  const reveal = () => launch.remove("app-launching");
  if (!window.isFirebaseConfigured || !window.firebase?.auth) { reveal(); return; }
  try {
    initFirebase().onAuthStateChanged(async (user) => {
      try {
        const verified = await hasVerifiedAccess(user);
        if (user && !isCurrentUser(user)) return;
        if (verified) redirectToApp({ replace: standalone });
        else if (user) redirectToLogin("needsVerification");
        else reveal();
      } catch { reveal(); }
    }, reveal);
  } catch { reveal(); }
})();
