(function (global) {
  const SOURCES = {
    blockchair: {
      label: "Blockchair",
      host: "api.blockchair.com",
      perMinute: 30,
      perDay: 1440,
      minIntervalMs: 1200,
    },
    blockcypher: {
      label: "BlockCypher",
      host: "api.blockcypher.com",
      perSecond: 3,
      perHour: 200,
      minIntervalMs: 340,
    },
    coinbase: {
      label: "Coinbase",
      host: "api.exchange.coinbase.com",
      perSecond: 10,
      minIntervalMs: 110,
    },
  };

  function createRateLimiter(deps = {}) {
    const fetchFn = deps.fetch || global.fetch.bind(global);
    const now = deps.now || (() => Date.now());
    const setTimeoutFn = deps.setTimeout || global.setTimeout.bind(global);
    const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeoutFn(resolve, ms)));

    const state = {};
    const queues = {};
    const listeners = new Set();

    function createQueue() {
      return { pending: [], running: false };
    }

    Object.keys(SOURCES).forEach((key) => {
      state[key] = {
        key,
        label: SOURCES[key].label,
        status: "ready",
        used: 0,
        limit: SOURCES[key].perDay || SOURCES[key].perHour || SOURCES[key].perMinute * 60 || 100,
        remaining: null,
        resetAt: null,
        lastRequestAt: 0,
        lastError: "",
        queueDepth: 0,
        channel: key === "coinbase" ? "client" : "server",
      };
      queues[key] = createQueue();
    });

    function detectSource(url) {
      const host = String(url || "").toLowerCase();
      if (host.includes("blockchair.com")) return "blockchair";
      if (host.includes("blockcypher.com")) return "blockcypher";
      if (host.includes("exchange.coinbase.com")) return "coinbase";
      return null;
    }

    function notify() {
      listeners.forEach((listener) => {
        try {
          listener(getState());
        } catch {
          /* ignore listener errors */
        }
      });
    }

    function parseHeaders(sourceKey, response) {
      const entry = state[sourceKey];
      if (!entry || !response?.headers) return;
      const get = (name) => response.headers.get(name);
      const bcCount = get("x-bc-request-count");
      const bcLimit = get("x-bc-request-limit");
      if (bcCount && bcLimit) {
        entry.used = Number(bcCount) || entry.used;
        entry.limit = Number(bcLimit) || entry.limit;
        entry.remaining = Math.max(0, entry.limit - entry.used);
      }
      const remaining = get("x-ratelimit-remaining") || get("ratelimit-remaining");
      const limit = get("x-ratelimit-limit") || get("ratelimit-limit");
      const reset = get("x-ratelimit-reset") || get("ratelimit-reset");
      if (remaining != null) entry.remaining = Number(remaining);
      if (limit != null) entry.limit = Number(limit);
      if (reset != null) {
        const resetNum = Number(reset);
        entry.resetAt = resetNum > 1e12 ? resetNum : resetNum * 1000;
      }
      if (response.status === 429) entry.status = "limited";
      else if (entry.status === "limited" && response.ok) entry.status = "ready";
    }

    function ingestServerState(payload = {}) {
      const providers = payload.providers || payload;
      Object.entries(providers).forEach(([key, info]) => {
        if (!state[key] || !info) return;
        const entry = state[key];
        if (info.used != null) entry.used = Number(info.used) || 0;
        if (info.limit != null) entry.limit = Number(info.limit) || entry.limit;
        if (entry.limit) entry.remaining = Math.max(0, entry.limit - entry.used);
        if (info.status) entry.status = info.status;
        if (info.last_error) entry.lastError = info.last_error;
        entry.channel = "server";
        entry.lastRequestAt = Number(info.updated_at || 0) * 1000 || entry.lastRequestAt;
      });
      notify();
    }

    function backoffMs(sourceKey, attempt) {
      const base = SOURCES[sourceKey]?.minIntervalMs || 250;
      return Math.min(8000, base * (2 ** attempt));
    }

    async function waitForSlot(sourceKey) {
      const entry = state[sourceKey];
      const config = SOURCES[sourceKey];
      const waitMs = Math.max(0, config.minIntervalMs - (now() - entry.lastRequestAt));
      if (waitMs > 0) await sleep(waitMs);
    }

    async function runQueue(sourceKey) {
      const queue = queues[sourceKey];
      if (queue.running) return;
      queue.running = true;
      while (queue.pending.length) {
        await waitForSlot(sourceKey);
        const job = queue.pending.shift();
        state[sourceKey].queueDepth = queue.pending.length;
        notify();
        try {
          const result = await job.run();
          job.resolve(result);
        } catch (error) {
          job.reject(error);
        }
      }
      queue.running = false;
      state[sourceKey].queueDepth = queue.pending.length;
      notify();
    }

    function enqueue(sourceKey, runner) {
      return new Promise((resolve, reject) => {
        queues[sourceKey].pending.push({ run: runner, resolve, reject });
        state[sourceKey].queueDepth = queues[sourceKey].pending.length;
        notify();
        runQueue(sourceKey);
      });
    }

    async function limitedFetch(input, init = {}, meta = {}) {
      const url = typeof input === "string" ? input : input.url;
      const sourceKey = meta.source || detectSource(url);
      if (!sourceKey) return fetchFn(input, init);

      const entry = state[sourceKey];

      return enqueue(sourceKey, async () => {
        if (meta.channel) entry.channel = meta.channel;
        entry.status = "active";
        notify();
        let attempt = 0;
        while (attempt < 4) {
          try {
            const response = await fetchFn(input, init);
            parseHeaders(sourceKey, response);
            entry.lastRequestAt = now();
            if (response.status === 429) {
              entry.status = "limited";
              entry.lastError = "Rate limited";
              notify();
              await sleep(backoffMs(sourceKey, attempt));
              attempt += 1;
              continue;
            }
            if (!response.ok) {
              entry.status = "error";
              entry.lastError = `${entry.label} returned HTTP ${response.status}.`;
              notify();
              return response;
            }
            entry.status = "ready";
            entry.lastError = "";
            notify();
            return response;
          } catch (error) {
            entry.status = "error";
            entry.lastError = error.message || "Request failed";
            notify();
            if (attempt >= 3) throw error;
            await sleep(backoffMs(sourceKey, attempt));
            attempt += 1;
          }
        }
        entry.status = "limited";
        throw new Error(`${entry.label} rate limit exceeded. Try again shortly.`);
      });
    }

    function getState() {
      return Object.values(state).map((item) => ({ ...item }));
    }

    function subscribe(listener) {
      listeners.add(listener);
      listener(getState());
      return () => listeners.delete(listener);
    }

    function setChannel(sourceKey, channel) {
      const entry = state[sourceKey];
      if (!entry || !channel) return;
      entry.channel = channel;
      notify();
    }

    return {
      fetch: limitedFetch,
      getState,
      subscribe,
      ingestServerState,
      parseHeaders,
      detectSource,
      waitForSlot,
      setChannel,
      SOURCES,
    };
  }

  global.createRateLimiter = createRateLimiter;
})(typeof window !== "undefined" ? window : globalThis);