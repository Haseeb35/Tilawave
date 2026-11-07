// Apply the saved theme before the page paints, so it never flashes the wrong colours.
// Loaded as a file (not inline) so the Content Security Policy can block inline scripts.
try {
  const theme = localStorage.getItem("theme");
  if (theme) document.documentElement.dataset.theme = theme;
} catch {}
