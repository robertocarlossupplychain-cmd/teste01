const { getDb } = require('../../src/lib/mongodb');
const { verifyToken } = require('../../src/lib/auth');

exports.handler = async (event, context) => {
  const user = verifyToken(event);
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ message: 'Não autorizado' }) };
  }

  try {
    const db = await getDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    // PARALELIZAR TODAS AS CONSULTAS PARA MÁXIMA VELOCIDADE
    const [
      dismissedNotifications,
      dailySales,
      productsColStats,
      lowStockProducts,
      overstockProducts,
      entriesLast24h,
      recentSales,
      recentProducts,
      pendingSales,
      recentMovements,
      idleStockProducts,
      nearExpiryProducts,
      recentStockMovements
    ] = await Promise.all([
      // 1. Notificações dispensadas
      db.collection('dismissed_notifications').find({}, { projection: { notificationKey: 1, _id: 0 } }).toArray(),
      
      // 2. Vendas do dia
      db.collection('sales').find(
        { createdAt: { $gte: today }, status: 'FINALIZED' },
        { projection: { total: 1, items: 1, _id: 0 } }
      ).toArray(),
      
      // 3. Estatísticas de produtos (count)
      db.collection('products').countDocuments(),
      
      // 4. Produtos com estoque baixo
      db.collection('products').find({
        $expr: {
          $lte: [
            { $ifNull: ['$quantity', 0] },
            { $ifNull: ['$minStock', 20] }
          ]
        }
      }, {
        projection: { name: 1, sku: 1, quantity: 1, minStock: 1, maxStock: 1, perishable: 1, expiryDate: 1, validade: 1, expirationDate: 1 }
      }).toArray(),
      
      // 5. Produtos com excesso de estoque
      db.collection('products').find({
        $expr: {
          $and: [
            { $gt: ['$maxStock', 0] },
            { $gte: [{ $ifNull: ['$quantity', 0] }, '$maxStock'] }
          ]
        }
      }).toArray(),
      
      // 6. Entradas nas últimas 24h
      db.collection('products').find(
        { createdAt: { $gte: oneDayAgo } },
        { projection: { _id: 1 } }
      ).toArray(),
      
      // 7. Vendas recentes (últimas 10)
      db.collection('sales')
        .find({}, { projection: { _id: 1, saleNumber: 1, total: 1, status: 1, createdAt: 1, items: 1 } })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray(),
      
      // 8. Produtos recentes (últimos 10)
      db.collection('products')
        .find({}, { projection: { _id: 1, name: 1, sku: 1, quantity: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray(),
      
      // 9. Vendas pendentes (reservadas há mais de 24h)
      db.collection('sales').find(
        { status: 'RESERVED', createdAt: { $lte: oneDayAgo } },
        { projection: { _id: 1, saleNumber: 1, createdAt: 1 } }
      ).toArray(),
      
      // 10. Movimentações recentes (últimos 7 dias) - apenas sku
      db.collection('movimentacoes_estoque')
        .find({ timestamp: { $gte: sevenDaysAgo } }, { projection: { sku: 1, _id: 0 } })
        .toArray(),
      
      // 11. Produtos parados (sem movimento nos últimos 7 dias)
      (async () => {
        const movements = await db.collection('movimentacoes_estoque')
          .find({ timestamp: { $gte: sevenDaysAgo } }, { projection: { sku: 1, _id: 0 } })
          .toArray();
        const activeSkus = new Set(movements.map(m => m.sku).filter(Boolean));
        
        return db.collection('products').find(
          { 
            quantity: { $gt: 0 }, 
            sku: { $nin: Array.from(activeSkus) } 
          },
          { 
            projection: { name: 1, sku: 1, quantity: 1, minStock: 1, maxStock: 1, perishable: 1, expiryDate: 1, validade: 1, expirationDate: 1 } 
          }
        ).limit(10).toArray();
      })(),
      
      // 12. Produtos próximos ao vencimento (próximos 14 dias)
      db.collection('products').find({
        $or: [
          { expiryDate: { $gte: today, $lte: fourteenDaysFromNow } },
          { validade: { $gte: today, $lte: fourteenDaysFromNow } },
          { expirationDate: { $gte: today, $lte: fourteenDaysFromNow } }
        ]
      }, {
        projection: { name: 1, sku: 1, quantity: 1, minStock: 1, maxStock: 1, perishable: 1, expiryDate: 1, validade: 1, expirationDate: 1 }
      }).toArray(),
      
      // 13. Movimentações de estoque recentes (últimas 24h)
      db.collection('movimentacoes_estoque')
        .find({ timestamp: { $gte: oneDayAgo } })
        .sort({ timestamp: -1 })
        .toArray()
    ]);

    // Calcular faturamento e lucro
    const revenue = dailySales.reduce((acc, sale) => acc + (Number(sale.total) || 0), 0);
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

    // Preparar notificações
    const dismissedKeys = new Set(dismissedNotifications.map(item => item.notificationKey));
    
    const notifications = [];
    if (lowStockProducts.length) {
      notifications.push({
        title: 'Produtos em baixa',
        description: `${lowStockProducts.length} produto(s) no limite mínimo de estoque`,
        href: '/pages/estoque.html',
        count: lowStockProducts.length,
        items: lowStockProducts.slice(0, 5)
      });
    }
    if (idleStockProducts.length) {
      notifications.push({
        title: 'Estoque parado/inativo',
        description: `${idleStockProducts.length} produto(s) sem movimento nos últimos 7 dias`,
        href: '/pages/auditoria-estoque.html',
        count: idleStockProducts.length,
        items: idleStockProducts.slice(0, 5)
      });
    }
    if (pendingSales.length) {
      notifications.push({
        title: 'Vendas paradas há mais de 24h',
        description: `${pendingSales.length} venda(s) reservada(s) aguardando conclusão`,
        href: '/pages/historico-vendas.html',
        count: pendingSales.length
      });
    }

    const activeNotifications = notifications.filter(item => !dismissedKeys.has(
      `${item.title}||${item.description}`
    ));

    return {
      statusCode: 200,
      body: JSON.stringify({
        revenue,
        salesCount: dailySales.length,
        lowStockCount: lowStockProducts.length,
        totalProducts: productsColStats,
        estimatedProfit,
        recentSales,
        recentProducts,
        notifications: activeNotifications,
      }),
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
