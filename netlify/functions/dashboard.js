const { getDb } = require('../../src/lib/mongodb');
const { verifyToken } = require('../../src/lib/auth');

exports.handler = async (event, context) => {
  const user = verifyToken(event);
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ message: 'Não autorizado' }) };
  }

  try {
    const db = await getDb();
    
    // Início do dia de hoje
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Faturamento Diário
    const dailySales = await db.collection('sales').find({
      createdAt: { $gte: today },
      status: 'FINALIZED'
    }).toArray();
    const revenue = dailySales.reduce((acc, sale) => acc + (Number(sale.total) || 0), 0);

    // 2. Vendas Realizadas Hoje
    const salesCount = dailySales.length;

    const productsCol = db.collection('products');
    const totalProducts = await productsCol.countDocuments();

    // 3. Produtos em Baixa (status ou quantidade)
    const lowStockCount = await productsCol.countDocuments({
      $or: [
        { status: { $regex: /baixo/i } },
        { quantity: { $lt: 20 } }
      ]
    });

    // 4. Lucro estimado do dia (margem sobre vendas de hoje)
    let estimatedProfit = 0;
    for (const sale of dailySales) {
      if (sale.items && sale.items.length > 0) {
        for (const item of sale.items) {
          const qty = Number(item.qty) || 1;
          const lineTotal = Number(item.lineTotal) || (Number(item.price) || 0) * qty;
          const unitCost = Number(item.costPrice) || (Number(item.price) || 0) * 0.7;
          estimatedProfit += lineTotal - unitCost * qty;
        }
      } else {
        const saleTotal = Number(sale.total) || 0;
        estimatedProfit += saleTotal * 0.25;
      }
    }

    // 5. Vendas Recentes (Últimas 10)
    const recentSales = await db.collection('sales')
      .find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    // 6. Lançamentos Recentes no Estoque (Últimos 10)
    const recentProducts = await db.collection('products')
      .find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    return {
      statusCode: 200,
      body: JSON.stringify({
        revenue,
        salesCount,
        lowStockCount,
        totalProducts,
        estimatedProfit,
        recentSales,
        recentProducts
      })
    };
  } catch (error) {
    console.error('Dashboard function error:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ 
        message: 'Erro ao carregar dashboard',
        error: error.message
      }) 
    };
  }
};
