(() => {
  const backgrounds = [
    ["auth-pool.jpg?v=20261102-start", 1.5],
    ["auth-rescue.jpg", 3500 / 2262],
    ["auth-competition.jpg", 3500 / 2368],
  ];
  const [file, ratio] = backgrounds[Math.floor(Math.random() * backgrounds.length)];
  const image = new URL(`../img/${file}`, document.currentScript.src);
  document.documentElement.style.setProperty("--login-background-image", `url("${image.href}")`);
  document.documentElement.style.setProperty("--login-background-ratio", String(ratio));
})();
