/**
 * Parser de documentos de importação por fornecedor (Fortlev APS/XML, NF-e, PDF).
 */
(function () {
  const SUPPLIER_BRANDS = {
    fortlev: "FORTLEV",
  };

  function parseBrazilianMoney(str) {
    if (str == null) return 0;
    let s = String(str)
      .replace(/R\$\s*/gi, "")
      .trim();
    if (!s) return 0;
    if (s.includes(",") && s.includes(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.includes(",")) {
      s = s.replace(",", ".");
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  function inferCategory(name) {
    const n = (name || "").toUpperCase();
    if (/JOELHO|T[EÊ]|LUVA|REDU|CURVA|CAP|ADAPTAD|UNI[AÃ]O|CRUZETA|REGISTRO/i.test(n)) {
      return "Conexões";
    }
    if (/V[AÁ]LVULA|TORNEIRA|REGIST/i.test(n)) {
      return "Hidráulica";
    }
    if (/CAIXA|RESERVAT|CISTERNA/i.test(n)) {
      return "Reservatórios";
    }
    if (/ANEL|ACESS|KIT|PARAFUS|SUPORTE|ABRA/i.test(n)) {
      return "Ferragens";
    }
    if (/TUBO|CANO|ESGOTO|SOLD|GALVANIZADO/i.test(n)) {
      return "Tubos";
    }
    if (/CIMENTO|PORTLAND/i.test(n)) {
      return "Cimentos";
    }
    if (/AREIA|BRITA|AGREGADO|P[EÉ]/i.test(n)) {
      return "Agregados";
    }
    if (/TIJOLO|BLOCO|CERA|TELHA/i.test(n)) {
      return "Tijolos";
    }
    if (/TINTA|VERNIZ|ESMALTE|MASSA|PRIMER|FUNDO/i.test(n)) {
      return "Tintas";
    }
    return "Geral";
  }

  function normalizeProduct(raw, supplierKey) {
    const brand = SUPPLIER_BRANDS[supplierKey] || raw.brand || "Fornecedor";
    const name = (raw.name || "").replace(/\s+/g, " ").trim();
    const costPrice = Number(raw.costPrice) || 0;
    const quantity = Math.max(0, parseInt(raw.quantity, 10) || 0);
    return {
      sku: String(raw.sku || "").trim(),
      name: name || `Produto ${raw.sku}`,
      description: name,
      quantity,
      unit: raw.unit || "UN",
      costPrice,
      brand,
      manufacturer: brand,
      supplier: brand,
      category: raw.category || inferCategory(name),
      existing: false,
      margin: 30,
      sellPrice: costPrice ? parseFloat((costPrice * 1.3).toFixed(2)) : 0,
      itemNumber: raw.itemNumber || null,
    };
  }

  function extractApsGlyphs(xmlDoc) {
    const glyphs = xmlDoc.querySelectorAll("Glyphs");
    const items = [];
    glyphs.forEach((g) => {
      const textEl = g.querySelector("Text");
      if (!textEl) return;
      const text = textEl.textContent.trim();
      if (!text) return;
      const transform = g.getAttribute("RenderTransform") || "";
      const nums = transform.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
      if (!nums || nums.length < 2) return;
      const x = parseFloat(nums[nums.length - 2]);
      const y = parseFloat(nums[nums.length - 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      items.push({ text, x, y });
    });
    return items;
  }

  const HEADER_NOISE =
    /CNPJ|VIA AXIAL|POLO PETRO|^\(\d{2}\)\s*\d|Descrição|U\.M\.|^\d{5}-\d{3}$|^\d+[,.]?\d*\s*KG|^\d+[,.]?\d*\s*CDM/i;

  /** XML Fortlev exportado do PDF (formato APS com Glyphs). */
  function parseFortlevApsXml(xmlString, supplierKey = "fortlev") {
    const doc = new DOMParser().parseFromString(xmlString, "text/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("Arquivo XML inválido ou corrompido.");
    }

    const items = extractApsGlyphs(doc);
    if (!items.length) {
      throw new Error("Nenhum texto encontrado no XML.");
    }

    const rowAnchors = items.filter(
      (i) => i.x >= 35 && i.x <= 75 && /^\d{6}$/.test(i.text),
    );

    const products = [];
    const seenSkus = new Set();

    for (const rowAnchor of rowAnchors) {
      const rowY = rowAnchor.y;
      const skuEl = items.find(
        (i) =>
          i.x >= 70 &&
          i.x <= 110 &&
          /^\d{8}$/.test(i.text) &&
          Math.abs(i.y - rowY) <= 1.5,
      );
      if (!skuEl || seenSkus.has(skuEl.text)) continue;
      seenSkus.add(skuEl.text);

      const sameRow = items.filter((i) => Math.abs(i.y - rowY) <= 1.5);

      const nameCandidates = items.filter(
        (i) =>
          i.x >= 130 &&
          i.x <= 155 &&
          Math.abs(i.y - rowY) <= 12 &&
          !/^UN$/i.test(i.text) &&
          !/^0$/.test(i.text) &&
          !/^\d+\s*\/\s*\d+\s*UN$/i.test(i.text) &&
          !/^R\$/i.test(i.text) &&
          !/^\d+[,.]?\d*\s*%/.test(i.text) &&
          !HEADER_NOISE.test(i.text),
      );

      const atRowLine = nameCandidates.find((i) => Math.abs(i.y - rowY) <= 1.5);
      const aboveLine = nameCandidates
        .filter((i) => i.y < rowY - 1)
        .sort((a, b) => b.y - a.y)[0];
      const belowFortlev = nameCandidates
        .filter((i) => i.y > rowY + 1 && /^FORTLEV$/i.test(i.text))
        .sort((a, b) => a.y - b.y)[0];
      const belowLine =
        belowFortlev ||
        nameCandidates
          .filter((i) => i.y > rowY + 1)
          .sort((a, b) => a.y - b.y)[0];

      const nameLines = [aboveLine, atRowLine, belowLine]
        .filter(Boolean)
        .map((i) => i.text);

      let quantity = 1;
      const qtyEl =
        sameRow.find((i) => /\d+\s*\/\s*\d+\s*UN/i.test(i.text)) ||
        items.find(
          (i) =>
            Math.abs(i.y - rowY) <= 2 &&
            i.x >= 300 &&
            i.x <= 360 &&
            /\d+\s*\/\s*\d+\s*UN/i.test(i.text),
        );
      if (qtyEl) {
        const m = qtyEl.text.match(/(\d+)\s*UN/i);
        if (m) quantity = parseInt(m[1], 10);
      }

      let costPrice = 0;
      const priceEl = sameRow.find(
        (i) =>
          i.x >= 400 &&
          i.x <= 520 &&
          /^R\$\s*[\d.,]+$/i.test(i.text.trim()),
      );
      if (priceEl) {
        costPrice = parseBrazilianMoney(priceEl.text);
      }

      const name = nameLines.join(" ").replace(/\s+/g, " ").trim();

      products.push(
        normalizeProduct(
          {
            sku: skuEl.text,
            name,
            quantity,
            costPrice,
            itemNumber: rowAnchor.text,
          },
          supplierKey,
        ),
      );
    }

    products.sort((a, b) => {
      if (a.itemNumber && b.itemNumber) {
        return a.itemNumber.localeCompare(b.itemNumber);
      }
      return 0;
    });

    return products;
  }

  /** NF-e padrão (nfeProc / NFe). */
  function parseNfeXml(xmlString, supplierKey = "fortlev") {
    const doc = new DOMParser().parseFromString(xmlString, "text/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("Arquivo XML inválido ou corrompido.");
    }

    const getText = (el, tag) => {
      const node = el.getElementsByTagName(tag)[0];
      return node ? node.textContent.trim() : "";
    };

    let supplierName = "";
    const emit = doc.getElementsByTagName("emit")[0];
    if (emit) {
      supplierName =
        getText(emit, "xFant") || getText(emit, "xNome") || "";
    }

    const dets = doc.getElementsByTagName("det");
    const products = [];

    for (let i = 0; i < dets.length; i++) {
      const det = dets[i];
      const prod = det.getElementsByTagName("prod")[0];
      if (!prod) continue;

      const sku = getText(prod, "cProd");
      const name = getText(prod, "xProd");
      const unit = getText(prod, "uCom") || "UN";
      const quantity = parseFloat(getText(prod, "qCom")) || 0;
      const costPrice = parseFloat(getText(prod, "vUnCom")) || 0;

      if (!sku && !name) continue;

      products.push(
        normalizeProduct(
          {
            sku,
            name,
            quantity: Math.round(quantity) || quantity,
            unit,
            costPrice,
            brand: supplierName || SUPPLIER_BRANDS[supplierKey],
          },
          supplierKey,
        ),
      );
    }

    return products;
  }

  function parseFortlevPdfText(text, supplierKey = "fortlev") {
    const products = [];
    const seenSkus = new Set();
    const lines = text
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const skuMatch = line.match(/\b(\d{8})\b/);
      if (!skuMatch) continue;

      const sku = skuMatch[1];
      if (seenSkus.has(sku)) continue;

      const block = [line];
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        if (/\b\d{8}\b/.test(lines[j]) && lines[j] !== line) break;
        if (/^(total|valor|subtotal|icms|ipi|frete)/i.test(lines[j])) break;
        block.push(lines[j]);
      }

      const blockText = block.join(" ");

      let quantity = 1;
      const qtyMatch = blockText.match(/(?:0\s*\/\s*)?(\d+)\s*UN\b/i);
      if (qtyMatch) quantity = parseInt(qtyMatch[1], 10);

      let costPrice = 0;
      const prices = [...blockText.matchAll(/R\$\s*([\d.,]+)/gi)];
      if (prices.length) {
        costPrice = parseBrazilianMoney(prices[0][1]);
      }

      let name = blockText
        .replace(/\b\d{8}\b/g, "")
        .replace(/R\$\s*[\d.,]+/gi, "")
        .replace(/(?:0\s*\/\s*)?\d+\s*UN/gi, "")
        .replace(/\b\d{6}\b/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (name.length < 3) {
        const nameParts = [];
        for (let j = i; j < Math.min(i + 5, lines.length); j++) {
          const ln = lines[j];
          if (/\b\d{8}\b/.test(ln) && j > i) break;
          if (/total|icms|valor/i.test(ln)) break;
          if (!/R\$|UN\b|\d{6,}/.test(ln) || j === i) {
            nameParts.push(ln.replace(/\b\d{8}\b/, "").trim());
          }
        }
        name = nameParts.join(" ").replace(/\s+/g, " ").trim();
      }

      if (!name) name = `Produto ${sku}`;

      seenSkus.add(sku);
      products.push(
        normalizeProduct({ sku, name, quantity, costPrice }, supplierKey),
      );
    }

    return products;
  }

  function detectXmlFormat(xmlString) {
    const head = xmlString.slice(0, 2000).toUpperCase();
    if (head.includes("<NFE") || head.includes("NFEPROC")) return "nfe";
    if (head.includes("<APS") || head.includes("<GLYPHS")) return "aps";
    return "unknown";
  }

  function parseXmlContent(xmlString, supplierKey = "fortlev") {
    const format = detectXmlFormat(xmlString);
    if (format === "nfe") {
      const products = parseNfeXml(xmlString, supplierKey);
      if (products.length) return products;
    }
    if (format === "aps" || format === "unknown") {
      const products = parseFortlevApsXml(xmlString, supplierKey);
      if (products.length) return products;
    }
    if (format === "unknown") {
      const nfe = parseNfeXml(xmlString, supplierKey);
      if (nfe.length) return nfe;
    }
    throw new Error(
      "Não foi possível identificar produtos no XML. Verifique se o arquivo é uma nota Fortlev ou NF-e.",
    );
  }

  async function parsePdfFile(file, supplierKey = "fortlev") {
    if (typeof pdfjsLib === "undefined") {
      throw new Error("Leitor de PDF não disponível.");
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let allText = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const textContent = await page.getTextContent();
      allText += textContent.items.map((item) => item.str).join("\n") + "\n";
    }
    const products = parseFortlevPdfText(allText, supplierKey);
    if (!products.length) {
      throw new Error(
        "Nenhum produto identificado no PDF. Use o XML exportado pelo fornecedor se disponível.",
      );
    }
    return products;
  }

  async function parseImportFile(file, supplierKey = "fortlev") {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "xml") {
      const text = await file.text();
      return parseXmlContent(text, supplierKey);
    }
    if (ext === "pdf") {
      return parsePdfFile(file, supplierKey);
    }
    throw new Error(
      "Formato não suportado. Envie um arquivo PDF ou XML da nota do fornecedor.",
    );
  }

  const api = {
    parseBrazilianMoney,
    inferCategory,
    parseFortlevApsXml,
    parseNfeXml,
    parseFortlevPdfText,
    parseXmlContent,
    parsePdfFile,
    parseImportFile,
  };

  if (typeof BuildFlow !== "undefined") {
    Object.assign(BuildFlow, api);
  }
  window.ImportParser = api;
})();
