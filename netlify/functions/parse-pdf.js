const pdfParse = require('pdf-parse');
const pdfjsLib = require('pdfjs-dist');

// Caminho para o worker do PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = require('pdfjs-dist/build/pdf.worker.min.mjs');

exports.handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        // Get PDF from base64 or file upload
        let pdfData;
        
        if (event.isBase64Encoded) {
            pdfData = Buffer.from(event.body, 'base64');
        } else {
            // If it's a form-data upload
            const body = JSON.parse(event.body);
            if (body.pdf) {
                pdfData = Buffer.from(body.pdf, 'base64');
            } else {
                throw new Error('No PDF data provided');
            }
        }

        // Parse PDF with pdf-parse for text extraction
        const pdfText = await pdfParse(pdfData);
        
        // Extract products from table
        const products = extractProductsFromPDFText(pdfText.text);
        
        return {
            statusCode: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify({
                success: true,
                products: products,
                total: products.length
            })
        };
        
    } catch (error) {
        console.error('Error parsing PDF:', error);
        return {
            statusCode: 500,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify({ 
                success: false,
                error: error.message 
            })
        };
    }
};

// Função para extrair produtos do texto do PDF (especializada na nota Fortlev)
function extractProductsFromPDFText(text) {
    const products = [];
    
    // Dividir o texto em linhas
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    let tableStarted = false;
    let tableEnded = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Detectar o início da tabela (procura por "Item" ou "Produto")
        if (!tableStarted && (line.includes('Item') || line.includes('Produto') || line.includes('Descrição'))) {
            tableStarted = true;
            continue;
        }
        
        // Detectar o fim da tabela (procura por total ou outros dados)
        if (tableStarted && (line.includes('Total') || line.includes('Valor Total') || line.includes('IPI Total'))) {
            tableEnded = true;
            break;
        }
        
        if (tableStarted && !tableEnded) {
            const product = parseProductLine(line, lines, i);
            if (product) {
                // Verificar se o produto não é duplicado (evita linhas de cabeçalho repetidas)
                const existing = products.find(p => p.sku === product.sku);
                if (!existing && product.sku && product.name) {
                    products.push(product);
                }
            }
        }
    }
    
    return products;
}

// Função para parsear uma linha da tabela de produto
function parseProductLine(line, allLines, currentIndex) {
    try {
        // Expressão regular para capturar as colunas da tabela da nota Fortlev
        // Formato: Item | Produto (SKU) | Descrição | U.M. | Emb. | Qtde. (0/XX) | Preço Unitário | ...
        
        // Primeiro tentar capturar SKU (número com 6-9 dígitos)
        const skuMatch = line.match(/\b(\d{6,9})\b/);
        
        if (!skuMatch) {
            // Tentar pegar SKU na linha anterior ou seguinte (quebrada)
            if (currentIndex > 0) {
                const prevLine = allLines[currentIndex - 1];
                const prevSku = prevLine.match(/\b(\d{6,9})\b/);
                if (prevSku) {
                    return parseProductLine(prevLine + ' ' + line, allLines, currentIndex);
                }
            }
            return null;
        }
        
        const sku = skuMatch[1];
        
        // Capturar quantidade (padrão: 0/XX UN ou XX UN)
        let quantity = 0;
        const qtyMatch = line.match(/(?:0\/)?(\d+)\s*UN/i);
        if (qtyMatch) {
            quantity = parseInt(qtyMatch[1]);
        } else {
            const simpleQtyMatch = line.match(/\b(\d+)\s*UN\b/i);
            if (simpleQtyMatch) {
                quantity = parseInt(simpleQtyMatch[1]);
            }
        }
        
        // Capturar preço unitário (formato R$ XX,XX)
        let costPrice = 0;
        const priceMatch = line.match(/R\$\s*([\d.,]+)/);
        if (priceMatch) {
            costPrice = parseFloat(priceMatch[1].replace('.', '').replace(',', '.'));
        }
        
        // Montar nome do produto (pegar texto entre o item/sku e a quantidade)
        let name = '';
        
        // Primeiro limpar a linha de SKU e quantidades
        let namePart = line.replace(sku, '').replace(/(?:0\/)?\d+\s*UN/i, '').replace(/R\$\s*[\d.,]+/g, '');
        
        // Remover cabeçalhos e números de item
        namePart = namePart.replace(/^\d+\s*/, '').replace(/Item\s*/i, '').trim();
        
        // Se o nome ficar muito curto, tentar concatenar com a linha anterior
        if (namePart.length < 10 && currentIndex > 0) {
            namePart = (allLines[currentIndex - 1] + ' ' + namePart).trim();
        }
        
        // Limpar e formatar o nome
        name = namePart.replace(/\s+/g, ' ').trim();
        
        // Se não encontrarmos nome, pular
        if (name.length < 3) {
            return null;
        }
        
        // Determinar categoria com base no nome
        let category = 'Tubos';
        if (name.includes('JOELHO') || name.includes('TE') || name.includes('LUVA') || name.includes('CURVA') || name.includes('CAPA')) {
            category = 'Conexões';
        } else if (name.includes('VÁLVULA') || name.includes('REGISTRO')) {
            category = 'Hidráulica';
        } else if (name.includes('ANEL') || name.includes('ACESSÓRIO')) {
            category = 'Acessórios';
        }
        
        return {
            sku: sku,
            name: name,
            description: name,
            quantity: quantity || 1,
            unit: 'UN',
            costPrice: costPrice || 0,
            brand: 'FORTLEV',
            manufacturer: 'FORTLEV',
            supplier: 'FORTLEV',
            category: category,
            existing: false,
            margin: 30,
            sellPrice: costPrice ? parseFloat((costPrice * 1.3).toFixed(2)) : 0
        };
        
    } catch (e) {
        console.error('Error parsing product line:', e);
        return null;
    }
}
