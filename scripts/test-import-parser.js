const fs = require("fs");
const path = require("path");

const xml = fs.readFileSync(
  path.join(__dirname, "../modelo_importacao/modelo.xml"),
  "utf8",
);

const HEADER_NOISE =
  /CNPJ|VIA AXIAL|POLO PETRO|^\(\d{2}\)\s*\d|Descrição|U\.M\.|^\d{5}-\d{3}$|^\d+[,.]?\d*\s*KG|^\d+[,.]?\d*\s*CDM/i;

const re =
  /<Glyphs[^>]*RenderTransform="([^"]+)"[^>]*>[\s\S]*?<Text>([^<]*)<\/Text>/g;
const items = [];
let m;
while ((m = re.exec(xml)) !== null) {
  const nums = m[1].match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!nums || nums.length < 2) continue;
  const x = parseFloat(nums[nums.length - 2]);
  const y = parseFloat(nums[nums.length - 1]);
  const text = m[2].trim();
  if (text) items.push({ text, x, y });
}

const rowAnchors = items.filter(
  (i) => i.x >= 35 && i.x <= 75 && /^\d{6}$/.test(i.text),
);
const products = [];
const seen = new Set();

for (const rowAnchor of rowAnchors) {
  const rowY = rowAnchor.y;
  const skuEl = items.find(
    (i) =>
      i.x >= 70 &&
      i.x <= 110 &&
      /^\d{8}$/.test(i.text) &&
      Math.abs(i.y - rowY) <= 1.5,
  );
  if (!skuEl || seen.has(skuEl.text)) continue;
  seen.add(skuEl.text);

  const sameRow = items.filter((i) => Math.abs(i.y - rowY) <= 1.5);
  const nameLines = items
    .filter(
      (i) =>
        i.x >= 130 &&
        i.x <= 155 &&
        Math.abs(i.y - rowY) <= 10 &&
        !/^UN$/i.test(i.text) &&
        !HEADER_NOISE.test(i.text) &&
        !/^\d+\s*\/\s*\d+\s*UN$/i.test(i.text) &&
        !/^R\$/i.test(i.text),
    )
    .sort((a, b) => a.y - b.y)
    .map((i) => i.text)
    .slice(0, 4);

  let qty = 1;
  const qtyEl = sameRow.find((i) => /\d+\s*\/\s*\d+\s*UN/i.test(i.text));
  if (qtyEl) {
    const qm = qtyEl.text.match(/(\d+)\s*UN/i);
    if (qm) qty = parseInt(qm[1], 10);
  }

  let price = 0;
  const priceEl = sameRow.find(
    (i) => i.x >= 400 && i.x <= 520 && /^R\$/.test(i.text),
  );
  if (priceEl) {
    let s = priceEl.text.replace(/R\$\s*/i, "").trim();
    if (s.includes(",") && s.includes("."))
      s = s.replace(/\./g, "").replace(",", ".");
    else if (s.includes(",")) s = s.replace(",", ".");
    price = parseFloat(s);
  }

  products.push({
    item: rowAnchor.text,
    sku: skuEl.text,
    name: nameLines.join(" "),
    qty,
    price,
  });
}

products.sort((a, b) => a.item.localeCompare(b.item));
console.log("Products found:", products.length);
products.forEach((p) =>
  console.log(`${p.item} | ${p.sku} | qtd ${p.qty} | R$ ${p.price} | ${p.name}`),
);
