const inputs = {
  reach: document.getElementById("reach"),
  conversion: document.getElementById("conversion"),
  aov: document.getElementById("aov"),
  discount: document.getElementById("discount"),
};

const outputs = {
  orders: document.getElementById("orders"),
  gross: document.getElementById("gross"),
  cost: document.getElementById("cost"),
};

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function updateCalculator() {
  const reach = Number(inputs.reach.value) || 0;
  const conversion = (Number(inputs.conversion.value) || 0) / 100;
  const aov = Number(inputs.aov.value) || 0;
  const discount = (Number(inputs.discount.value) || 0) / 100;

  const orders = Math.round(reach * conversion);
  const gross = orders * aov;
  const cost = gross * discount;

  outputs.orders.textContent = String(orders);
  outputs.gross.textContent = formatCurrency(gross);
  outputs.cost.textContent = formatCurrency(cost);
}

Object.values(inputs).forEach((input) => {
  input.addEventListener("input", updateCalculator);
});

updateCalculator();

const copyButton = document.getElementById("copyButton");
const pitch = document.getElementById("pitch");
const copyStatus = document.getElementById("copyStatus");

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(pitch.value.trim());
    copyStatus.textContent = "Merchant pitch copied.";
  } catch (error) {
    copyStatus.textContent = "Clipboard access failed. Copy manually.";
  }
});
