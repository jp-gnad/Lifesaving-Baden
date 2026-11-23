(function () {
  "use strict";
  const photoSelectors = ["[data-account-photo-small]", "[data-account-photo-large]"];
  const initialsSelectors = ["[data-account-initials-small]", "[data-account-initials-large]"];

  function render(snapshot = cache.read()) {
    photoSelectors.forEach((selector, group) => {
      const initials = document.querySelectorAll(initialsSelectors[group]);
      document.querySelectorAll(selector).forEach((photo, index) => {
        const source = snapshot?.image || "";
        if (source && photo.getAttribute("src") !== source) photo.src = source;
        else if (!source) photo.removeAttribute("src");
        photo.hidden = !source;
        photo.classList.toggle("is-hidden", !source);
        if (initials[index]) {
          initials[index].textContent = snapshot?.initials || "?";
          initials[index].hidden = Boolean(source);
          initials[index].classList.toggle("is-hidden", Boolean(source));
        }
      });
    });
    document.querySelectorAll("[data-account-avatar-preview]").forEach((preview) => { preview.hidden = !snapshot; });
    document.body.classList.toggle("account-avatar-ready", Boolean(snapshot));
  }

  function decodeImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const timer = window.setTimeout(() => { image.src = ""; reject(new Error("Avatar timed out")); }, 8_000);
      image.onload = () => {
        window.clearTimeout(timer);
        (image.decode ? image.decode() : Promise.resolve()).then(() => resolve(source), reject);
      };
      image.onerror = (error) => { window.clearTimeout(timer); reject(error); };
      image.src = source;
    });
  }

  async function loadImage(source) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(source, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
      if (!response.ok) throw new Error("Avatar unavailable");
      const blob = await response.blob();
      if (blob.size > 250_000 || !/^image\/(png|jpeg|webp|gif|avif)$/i.test(blob.type)) throw new Error("Avatar format unavailable");
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return await decodeImage(data);
    } catch {
      // Hosts without CORS still get the browser's ordinary image cache.
      return await decodeImage(source);
    } finally {
      window.clearTimeout(timer);
    }
  }

  const cache = window.LifesavingAccountAvatarCache.create({ getStorage: () => window.sessionStorage, loadImage, onChange: render });
  function setUser(user, initials) {
    if (window.firebase?.apps?.length && window.firebase.auth().currentUser?.uid !== user?.uid) return Promise.resolve(cache.read());
    if (!initials) {
      const parts = String(user?.displayName || user?.email || "?").trim().split(/\s+/);
      initials = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0].slice(0, 2);
    }
    return cache.sync(user, initials.toUpperCase());
  }
  window.LifesavingAccountAvatar = Object.freeze({ setUser, clear: cache.clear, render, snapshot: cache.read });
  cache.restore();
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    cache.restore();
    if (window.firebase?.apps?.length) setUser(window.firebase.auth().currentUser);
  });
})();
