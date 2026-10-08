// T-0262: what the hosted sandbox is really doing, read from its own health checks. The page reports unavailable status
// when they do not answer (the free API sleeps when idle). Text only: nothing from the API becomes HTML.
(() => {
  const el = document.getElementById('system-status');
  if (!el) return;
  const read = (url) =>
    fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(15000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  Promise.all([read('https://stood-api.onrender.com/health'), read('https://stood-yard-api.onrender.com/health')]).then(
    ([stood, yard]) => {
      const paypal = Array.isArray(stood?.providers) ? stood.providers.find((p) => p?.provider === 'paypal') : null;
      if (!paypal) {
        el.dataset.state = 'unavailable';
        el.textContent = 'Live status unavailable. The hosted sandbox did not answer; it may be waking up.';
        return;
      }
      const parts = [
        paypal.mode === 'live' && paypal.simulated === false && paypal.ready === true
          ? 'PayPal sandbox connected'
          : 'PayPal simulated',
        stood.paymentReady === true ? 'sandbox payments on' : 'sandbox payments not ready',
      ];
      if (yard?.capabilities) parts.push(yard.capabilities.board === true ? 'Yard Board live' : 'Yard Board off');
      el.dataset.state = 'live';
      el.textContent = `Live status: ${parts.join(' · ')}. PayPal sandbox only; no real money.`;
    },
  );
})();
