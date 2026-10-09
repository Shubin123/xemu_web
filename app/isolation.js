// GitHub Pages has no custom headers: the worker supplies COOP/COEP for this site.
window.xemuIsolationReady = (async () => {
  if (crossOriginIsolated) return true;
  if (!isSecureContext || !('serviceWorker' in navigator)) return false;
  const reload = () => {
    if (crossOriginIsolated) return;
    const key = 'xemu-isolation-reload';
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', reload);
  try {
    await navigator.serviceWorker.register(new URL('./coi-serviceworker.js', location.href), {scope: './'});
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) reload();
    return crossOriginIsolated;
  } catch (error) {
    console.error('Browser isolation setup failed', error);
    return false;
  }
})();
if (crossOriginIsolated) sessionStorage.removeItem('xemu-isolation-reload');
