(function (global) {
  const limiter = global.createRateLimiter({
    fetch: global.fetch.bind(global),
    now: () => Date.now(),
    setTimeout: global.setTimeout.bind(global),
  });

  let indicatorTimer;
  let serverSyncTimer;
  let bootstrapped = false;

  function scheduleIndicator() {
    if (indicatorTimer) return;
    const raf = global.requestAnimationFrame || ((fn) => global.setTimeout(fn, 0));
    indicatorTimer = raf(() => {
      indicatorTimer = 0;
      renderIndicator();
    });
  }

  function statusLabel(item) {
    if (item.status === "limited") return "Limited";
    if (item.status === "active") return "Active";
    if (item.status === "error") return "Retry";
    if (item.remaining != null && item.limit) {
      const pct = Math.round((item.remaining / item.limit) * 100);
      return `${pct}% left`;
    }
    if (item.channel === "server" && item.lastRequestAt) return "Synced";
    return "Ready";
  }

  function statusTone(item) {
    if (item.status === "limited" || item.status === "error") return "warn";
    if (item.status === "active") return "busy";
    if (item.remaining != null && item.limit && item.remaining / item.limit < 0.2) return "warn";
    return "ok";
  }

  function renderIndicator() {
    const root = global.document?.getElementById("rateLimitStatus");
    if (!root) return;
    const items = limiter.getState();
    root.innerHTML = items
      .map(
        (item) => `
          <button type="button" class="rate-pill tone-${statusTone(item)}" data-source="${item.key}" title="${item.label} API usage (${item.channel})">
            <span class="rate-pill-dot" aria-hidden="true"></span>
            <span class="rate-pill-label">${item.label}</span>
            <span class="rate-pill-state">${statusLabel(item)}</span>
          </button>
        `,
      )
      .join("");
    root.setAttribute(
      "aria-label",
      `API rate status: ${items.map((item) => `${item.label} ${statusLabel(item)}`).join(", ")}`,
    );
  }

  function onStateChange() {
    scheduleIndicator();
  }

  async function syncServerRates() {
    try {
      const response = await global.fetch("/api/rate-status/", { cache: "no-store" });
      if (!response.ok) return;
      limiter.ingestServerState(await response.json());
    } catch {
      /* server sync is best-effort */
    }
  }

  async function probeClientProviders() {
    const probes = [
      ["blockchair", "https://api.blockchair.com/dogecoin/stats"],
      ["blockcypher", "https://api.blockcypher.com/v1/doge/main"],
    ];
    for (const [sourceKey, url] of probes) {
      try {
        await limiter.fetch(url, { cache: "no-store" }, { source: sourceKey, channel: "client" });
      } catch {
        /* best-effort client probe */
      }
    }
  }

  function startServerSync() {
    syncServerRates().then(() => probeClientProviders());
    if (serverSyncTimer) global.clearInterval(serverSyncTimer);
    serverSyncTimer = global.setInterval(() => {
      syncServerRates().then(() => probeClientProviders());
    }, 30000);
  }

  function bootstrap() {
    if (bootstrapped) return;
    bootstrapped = true;
    renderIndicator();
    limiter.subscribe(onStateChange);
    startServerSync();
  }

  global.dogeRateLimit = {
    fetch: limiter.fetch,
    getState: limiter.getState,
    subscribe: limiter.subscribe,
    renderIndicator,
    ingestServerState: limiter.ingestServerState,
    syncServerRates,
    probeClientProviders,
    parseHeaders: limiter.parseHeaders,
    detectSource: limiter.detectSource,
    waitForSlot: limiter.waitForSlot,
    setChannel: limiter.setChannel,
    bootstrap,
    SOURCES: limiter.SOURCES,
  };
  global.dogeLimitedFetch = limiter.fetch;
})(typeof window !== "undefined" ? window : globalThis);