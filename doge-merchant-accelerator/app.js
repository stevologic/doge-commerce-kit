const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const whole = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0
});

const fields = {
  audience: document.querySelector("#audience"),
  conversion: document.querySelector("#conversion"),
  aov: document.querySelector("#aov"),
  dogeShare: document.querySelector("#dogeShare"),
  repeatRate: document.querySelector("#repeatRate")
};

const outputs = {
  orders: document.querySelector("#orders"),
  dogeOrders: document.querySelector("#dogeOrders"),
  dogeVolume: document.querySelector("#dogeVolume"),
  repeatOrders: document.querySelector("#repeatOrders")
};

function numberValue(input) {
  return Number.parseFloat(input.value) || 0;
}

function calculate() {
  const audience = numberValue(fields.audience);
  const conversion = numberValue(fields.conversion) / 100;
  const aov = numberValue(fields.aov);
  const dogeShare = numberValue(fields.dogeShare) / 100;
  const repeatRate = numberValue(fields.repeatRate) / 100;

  const orders = Math.max(0, audience * conversion);
  const dogeOrders = orders * dogeShare;
  const dogeVolume = dogeOrders * aov;
  const repeatOrders = dogeOrders * repeatRate;

  outputs.orders.textContent = whole.format(orders);
  outputs.dogeOrders.textContent = whole.format(dogeOrders);
  outputs.dogeVolume.textContent = money.format(dogeVolume);
  outputs.repeatOrders.textContent = whole.format(repeatOrders);
}

Object.values(fields).forEach((field) => {
  field.addEventListener("input", calculate);
});

const merchantName = document.querySelector("#merchantName");
const merchantOffer = document.querySelector("#merchantOffer");
const merchantLink = document.querySelector("#merchantLink");
const badgePreview = document.querySelector("#badgePreview");
const badgeCode = document.querySelector("#badgeCode");
const copyBadge = document.querySelector("#copyBadge");

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderBadge() {
  const name = merchantName.value.trim() || "Merchant";
  const offer = merchantOffer.value.trim() || "DOGE accepted here";
  const link = merchantLink.value.trim() || "#";

  badgePreview.innerHTML = `
    <span>DOGE accepted</span>
    <strong>${escapeHtml(name)}</strong>
    <small>${escapeHtml(offer)}</small>
  `;

  badgeCode.value = `<a href="${escapeHtml(link)}" style="display:grid;gap:6px;max-width:280px;padding:18px;border:2px solid #c89b22;border-radius:8px;background:#fffaf0;color:#17191f;text-decoration:none;font-family:system-ui,sans-serif"><span style="color:#16835d;font-weight:900;text-transform:uppercase">DOGE accepted</span><strong style="font-size:1.2rem">${escapeHtml(name)}</strong><small style="color:#626975;font-weight:800">${escapeHtml(offer)}</small></a>`;
}

[merchantName, merchantOffer, merchantLink].forEach((field) => {
  field.addEventListener("input", renderBadge);
});

copyBadge.addEventListener("click", async () => {
  await navigator.clipboard.writeText(badgeCode.value);
  copyBadge.textContent = "Copied";
  setTimeout(() => {
    copyBadge.textContent = "Copy badge HTML";
  }, 1400);
});

document.querySelectorAll(".copy").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.querySelector(`#${button.dataset.copy}`);
    await navigator.clipboard.writeText(target.textContent.trim());
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1400);
  });
});

calculate();
renderBadge();

