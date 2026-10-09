// GitHub Pages has no custom headers: the worker supplies COOP/COEP for this site.
window.xemuIsolationReady = (async () => {
  if (!isSecureContext || !('serviceWorker' in navigator)) return crossOriginIsolated;
  const reload = () => {
    if (crossOriginIsolated) return;
    const key = 'xemu-isolation-reload';
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', reload);
  const registration = navigator.serviceWorker.register(new URL('./coi-serviceworker.js', location.href), {scope: './', updateViaCache: 'none'});
  // Servers already supplying headers can boot while the update check runs.
  // A blocked registration must not hold their startup open.
  if (crossOriginIsolated) {
    registration.catch(error => console.error('Service worker update failed', error));
    return true;
  }
  try {
    await registration;
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) reload();
    return crossOriginIsolated;
  } catch (error) {
    console.error('Browser isolation setup failed', error);
    return false;
  }
})();
if (crossOriginIsolated) sessionStorage.removeItem('xemu-isolation-reload');
