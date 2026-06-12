
const fs = require('fs');
const path = require('path');

// Função para determinar categoria a partir do nome do produto
function getCategoriaFromNome(nome) {
    const nomeLower = nome.toLowerCase();
    if (nomeLower.match(/joelho|t[eé]|luva|redu[çc][ãa]o|curva|cap|adapt|uni[ãa]o|bucha/)) {
        return 'Conexões';
    } else if (nomeLower.match(/v[aá]lvula|registro|torneira|pia|lavat|sif[ãa]o/)) {
        return 'Hidráulica';
    } else if (nomeLower.match(/anel|acess[ió]rio|kit|parafuso/)) {
        return 'Acessórios';
    } else if (nomeLower.match(/reservat[óo]rio|caixa|[dáá]gua/)) {
        return 'Reservatórios';
    }
    return 'Tubos';
}

function extrairProdutos(text) {
    const produtoRegex = /<produto>([\s\S]*?)<\/produto>/g;
    const produtosFromXml = [];
    
    let match;
    while ((match = produtoRegex.exec(text)) !== null) {
        const produtoXml = match[1];
        
        // Tentar várias nomenclaturas para o SKU
        let skuMatch = produtoXml.match(/<sku>(.*?)<\/sku>/);
        if (!skuMatch) skuMatch = produtoXml.match(/<codigoProduto>(.*?)<\/codigoProduto>/);
        
        const descricaoMatch = produtoXml.match(/<descricao>(.*?)<\/descricao>/);
        
        let quantidadeMatch = produtoXml.match(/<quantidade>(.*?)<\/quantidade>/);
        if (!quantidadeMatch) quantidadeMatch = produtoXml.match(/<qtde>(.*?)<\/qtde>/);
        
        const precoUnitarioMatch = produtoXml.match(/<precoUnitario>(.*?)<\/precoUnitario>/);
        
        let unidadeMedidaMatch = produtoXml.match(/<unidadeMedida>(.*?)<\/unidadeMedida>/);
        if (!unidadeMedidaMatch) unidadeMedidaMatch = produtoXml.match(/<um>(.*?)<\/um>/);
        
        const sku = skuMatch ? skuMatch[1].trim() : '';
        const descricao = descricaoMatch ? descricaoMatch[1].trim() : '';
        const quantidadeText = quantidadeMatch ? quantidadeMatch[1].trim() : '0';
        const precoUnitarioText = precoUnitarioMatch ? precoUnitarioMatch[1].trim() : '0';
        const unidadeMedida = unidadeMedidaMatch ? unidadeMedidaMatch[1].trim() : 'UN';
        
        const quantidade = parseInt(quantidadeText) || 0;
        const precoUnitario = parseFloat(precoUnitarioText.replace(',', '.')) || 0;
        
        if (sku && descricao && quantidade > 0) {
            const produto = {
                sku: sku,
                name: descricao,
                description: descricao,
                quantity: quantidade,
                unit: unidadeMedida,
                costPrice: precoUnitario,
                brand: 'FORTLEV',
                manufacturer: 'FORTLEV',
                supplier: 'FORTLEV',
                category: getCategoriaFromNome(descricao),
                existing: false,
                margin: 30,
                sellPrice: precoUnitario ? parseFloat((precoUnitario * 1.3).toFixed(2)) : 0
            };
            console.log('  → Produto:', produto.sku, '-', produto.name, '-', produto.quantity, produto.unit, '- R$', produto.costPrice);
            produtosFromXml.push(produto);
        }
    }
    return produtosFromXml;
}

async function testParse() {
    try {
        // Testar com o arquivo da nota fiscal simples
        console.log('🧪 TESTE: Arquivo test-nota-fiscal-simples.xml (nomenclatura nota fiscal)');
        const xmlPath = path.join(__dirname, 'modelo_importacao', 'test-nota-fiscal-simples.xml');
        const text = fs.readFileSync(xmlPath, 'utf8');
        const produtos = extrairProdutos(text);
        console.log('✅ Teste concluído -', produtos.length, 'produtos encontrados!');

    } catch (error) {
        console.error('❌ Erro:', error);
    }
}

testParse();
