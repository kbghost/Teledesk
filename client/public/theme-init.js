// Applique le thème blanc par défaut avant le premier rendu (évite le flash). Fichier externe : le CSP interdit les scripts inline.
try {
  var t = localStorage.getItem('theme') || 'light';
  var dark = t === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch (e) { document.documentElement.dataset.theme = 'light'; }

