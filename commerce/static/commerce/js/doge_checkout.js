(function () {
  "use strict";

  const CHANNEL = "doge-checkout";
  const VERSION = 1;
  const script = document.currentScript || Array.from(document.scripts).find((item) => /doge_checkout\.js(?:\?|$)/.test(item.src));
  const scriptUrl = new URL(script?.src || "/static/commerce/js/doge_checkout.js", document.baseURI);
  const defaultEmbedUrl = new URL("/checkout/embed/", scriptUrl.origin).href;
  const hostStyleUrl = new URL("/static/commerce/css/doge_checkout_host.css", scriptUrl.origin);
  hostStyleUrl.search = scriptUrl.search;

  function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function instanceId(element) {
    const siblings = Array.from(document.querySelectorAll("doge-checkout"));
    const position = Math.max(0, siblings.indexOf(element));
    const seed = [
      location.origin,
      location.pathname,
      element.id || "",
      element.getAttribute("order-id") || "",
      element.getAttribute("address") || "",
      element.getAttribute("offer") || "",
      element.getAttribute("usd") || "",
      element.getAttribute("memo") || "",
      position,
    ].join("|");
    return `doge-${stableHash(seed)}`;
  }

  function flatConfig(element) {
    return {
      merchant: element.getAttribute("merchant") || "DOGE Merchant",
      address: element.getAttribute("address") || "",
      offer: element.getAttribute("offer") || "DOGE order",
      usd: element.getAttribute("usd") || "",
      memo: element.getAttribute("memo") || "Website DOGE order",
      orderId: element.getAttribute("order-id") || "",
      confirmations: element.getAttribute("confirmations") || "1",
      quoteMinutes: element.getAttribute("quote-minutes") || "10",
      buttonText: element.getAttribute("button-text") || "Continue with DOGE",
      returnUrl: element.getAttribute("return-url") || "",
      accent: element.getAttribute("accent") || "#f4bd2a",
    };
  }

  function applyConfigAttributes(element, config = {}) {
    const merchant = config.merchant && typeof config.merchant === "object" ? config.merchant : {};
    const order = config.order && typeof config.order === "object" ? config.order : {};
    const payment = config.payment && typeof config.payment === "object" ? config.payment : {};
    const behavior = config.behavior && typeof config.behavior === "object" ? config.behavior : {};
    const appearance = config.appearance && typeof config.appearance === "object" ? config.appearance : {};
    const values = {
      merchant: merchant.name || config.merchant,
      address: merchant.address || config.address || config.wallet,
      offer: order.description || config.offer || config.item,
      usd: order.usd ?? config.usd ?? config.amount,
      memo: order.memo || config.memo,
      "order-id": order.id || config.orderId || config.order_id,
      confirmations: payment.minConfirmations ?? config.minConfirmations ?? config.confirmations,
      "quote-minutes": payment.quoteMinutes ?? config.quoteMinutes,
      "button-text": config.buttonText || config.button,
      "return-url": behavior.returnUrl || config.returnUrl || config.return_url,
      accent: appearance.accent || config.accent,
      "embed-url": config.embedUrl,
    };
    Object.entries(values).forEach(([name, value]) => {
      if (value == null || value === "") return;
      element.setAttribute(name, String(value));
    });
  }

  class DogeCheckoutElement extends HTMLElement {
    static get observedAttributes() {
      return [
        "merchant", "address", "offer", "usd", "memo", "order-id", "confirmations",
        "quote-minutes", "button-text", "return-url", "accent", "embed-url",
      ];
    }

    constructor() {
      super();
      this.instanceId = "";
      this.frame = null;
      this.frameOrigin = "";
      this.lastState = Object.freeze({ stage: 0, status: "loading" });
      this.renderQueued = false;
      this.messageHandler = this.handleMessage.bind(this);
      this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
      if (!this.instanceId) this.instanceId = instanceId(this);
      window.addEventListener("message", this.messageHandler);
      this.queueRender();
    }

    disconnectedCallback() {
      window.removeEventListener("message", this.messageHandler);
    }

    attributeChangedCallback(_name, oldValue, newValue) {
      if (oldValue !== newValue && this.isConnected && Number(this.lastState.stage || 0) < 2) this.queueRender();
    }

    queueRender() {
      if (this.renderQueued) return;
      this.renderQueued = true;
      queueMicrotask(() => {
        this.renderQueued = false;
        if (this.isConnected) this.render();
      });
    }

    render() {
      const embedUrl = new URL(this.getAttribute("embed-url") || defaultEmbedUrl, scriptUrl.href);
      if (!/^https?:$/.test(embedUrl.protocol)) throw new Error("DOGE checkout embed URL must use HTTP or HTTPS.");
      const hash = new URLSearchParams({
        config: JSON.stringify(flatConfig(this)),
        instance: this.instanceId,
      });
      embedUrl.hash = hash.toString();
      this.frameOrigin = embedUrl.origin;
      this.shadowRoot.innerHTML = `
        <link rel="stylesheet" href="${hostStyleUrl.href}">
        <iframe
          title="Dogecoin checkout for ${String(this.getAttribute("merchant") || "merchant").replace(/[\"<>]/g, "")}"
          width="440"
          height="320"
          loading="eager"
          scrolling="no"
          sandbox="allow-scripts allow-same-origin allow-popups allow-top-navigation-by-user-activation"
          allow="clipboard-write"
          referrerpolicy="no-referrer"
        ></iframe>`;
      this.frame = this.shadowRoot.querySelector("iframe");
      this.frame.src = embedUrl.href;
    }

    handleMessage(event) {
      if (!this.frame || event.source !== this.frame.contentWindow || event.origin !== this.frameOrigin) return;
      const message = event.data;
      if (!message || message.channel !== CHANNEL || message.version !== VERSION || message.instanceId !== this.instanceId) return;
      if (message.type === "resize") {
        const height = Math.min(1100, Math.max(260, Math.ceil(Number(message.payload?.height) || 320)));
        this.frame.height = String(height);
        this.frame.style.height = `${height}px`;
        return;
      }
      if (message.type !== "event" || !/^[a-z]+$/.test(message.name || "")) return;
      if (message.name === "state" || message.payload?.state) {
        this.lastState = Object.freeze({ ...(message.payload?.state || message.payload || {}) });
      }
      const detail = Object.freeze({
        ...(message.payload || {}),
        version: VERSION,
        instanceId: this.instanceId,
        advisory: true,
      });
      this.dispatchEvent(new CustomEvent(`dogecheckout:${message.name}`, { detail, bubbles: true }));
    }

    postCommand(name, payload = {}) {
      if (!this.frame?.contentWindow || !this.frameOrigin) return false;
      this.frame.contentWindow.postMessage({
        channel: CHANNEL,
        version: VERSION,
        instanceId: this.instanceId,
        type: "command",
        name,
        payload,
      }, this.frameOrigin);
      return true;
    }

    configure(config) {
      if (Number(this.lastState.stage || 0) >= 2) {
        throw new Error("DOGE checkout configuration is frozen after payment starts. Restart or mount a new checkout.");
      }
      applyConfigAttributes(this, config);
      return this;
    }

    update(config) {
      return this.configure(config);
    }

    restart() {
      this.lastState = Object.freeze({ stage: 1, status: "loading" });
      this.postCommand("restart");
      return this;
    }

    refresh() {
      this.postCommand("refresh");
      return this;
    }

    getState() {
      this.postCommand("state");
      return { ...this.lastState };
    }

    on(name, callback, options) {
      const eventName = `dogecheckout:${String(name).replace(/^dogecheckout:/, "")}`;
      this.addEventListener(eventName, callback, options);
      return () => this.removeEventListener(eventName, callback, options);
    }

    destroy() {
      this.remove();
    }
  }

  if (!customElements.get("doge-checkout")) customElements.define("doge-checkout", DogeCheckoutElement);

  window.DogeCheckout = Object.freeze({
    version: VERSION,
    mount(target, config) {
      const host = typeof target === "string" ? document.querySelector(target) : target;
      if (!(host instanceof Element)) throw new Error("Choose an element where DOGE checkout can be mounted.");
      const checkout = document.createElement("doge-checkout");
      applyConfigAttributes(checkout, config);
      host.replaceChildren(checkout);
      return checkout;
    },
  });
})();
