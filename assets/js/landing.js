(function () {
  "use strict";
  const { initFirebase, hasVerifiedAccess, isCurrentUser, redirectToApp, redirectToLogin, getLoginRedirectUrl } = window.LifesavingAuth;
  const launch = document.documentElement.classList;
  const standalone = launch.contains("app-launching");
  const reveal = async (current) => {
    if (window.LifesavingAppLaunch) await window.LifesavingAppLaunch.ready(current);
    else launch.remove("app-launching");
  };
  if (!window.isFirebaseConfigured || !window.firebase?.auth) {
    if (standalone) window.LifesavingAppLaunch?.fail();
    else reveal();
    return;
  }
  try {
    const auth = initFirebase();
    auth.onAuthStateChanged(async (user) => {
      window.LifesavingAppLaunch?.hold();
      try {
        const verified = await hasVerifiedAccess(user);
        if (user && !isCurrentUser(user)) return;
        if (verified && standalone) {
          const member = new URL("app.html", getLoginRedirectUrl());
          member.searchParams.set("appLaunch", "1");
          window.location.replace(member.href);
        } else if (verified) redirectToApp();
        else if (user) redirectToLogin("needsVerification");
        else await reveal(() => !auth.currentUser);
      } catch { window.LifesavingAppLaunch?.fail(); if (!standalone) await reveal(); }
    }, () => { window.LifesavingAppLaunch?.fail(); if (!standalone) reveal(); });
  } catch { window.LifesavingAppLaunch?.fail(); if (!standalone) reveal(); }
})();
