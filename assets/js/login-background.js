(() => {
  const backgrounds = [
    ["auth-pool", 2048 / 1365],
    ["auth-rescue", 3500 / 2262],
    ["auth-competition", 3500 / 2368],
  ];
  const [file, ratio] = backgrounds[Math.floor(Math.random() * backgrounds.length)];
  const small = window.matchMedia("(max-width: 700px)").matches ? "-small" : "";
  const image = new URL(`../img/${file}${small}.webp`, document.currentScript.src);
  document.documentElement.style.setProperty("--login-background-image", `url("${image.href}")`);
  document.documentElement.style.setProperty("--login-background-ratio", String(ratio));
})();
