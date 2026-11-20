(() => {
  const backgrounds = [
    ["auth-pool.jpg", 2048 / 1365],
    ["auth-rescue.webp", 3500 / 2262, "auth-rescue-small.webp"],
    ["auth-competition.jpg", 3500 / 2368],
  ];
  const [file, ratio, smallFile] = backgrounds[Math.floor(Math.random() * backgrounds.length)];
  const filename = smallFile && window.matchMedia("(max-width: 700px)").matches ? smallFile : file;
  const image = new URL(`../img/${filename}`, document.currentScript.src);
  document.documentElement.style.setProperty("--login-background-image", `url("${image.href}")`);
  document.documentElement.style.setProperty("--login-background-ratio", String(ratio));
})();
