const { getDb } = require('../../src/lib/mongodb');
const { verifyToken } = require('../../src/lib/auth');

exports.handler = async (event, context) => {
  const user = verifyToken(event);
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ message: 'Não autorizado' }) };
  }

  try {
    const db = await getDb();
    
    // Buscar notificações já descartadas/lidas
    const dismissedCol = db.collection('dismissed_notifications');
    const dismissedNotifications = await dismissedCol.find({}).toArray();
    const dismissedKeys = new Set(dismissedNotifications.map((item) => item.notificationKey));
    
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
    const allProducts = await productsCol.find({}).toArray();
    const totalProducts = allProducts.length;

    const parseDate = (value) => {
      if (!value) return null;
      if (value instanceof Date) return value;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };

    const lowStockProducts = allProducts.filter((product) => {
      const minStock = Number(product.minStock ?? 20);
      const quantity = Number(product.quantity ?? 0);
      return (
        (product.status && /baixo/i.test(product.status)) ||
        quantity <= minStock
      );
    });

    const overstockProducts = allProducts.filter((product) => {
      const maxStock = Number(product.maxStock || 0);
      const quantity = Number(product.quantity ?? 0);
      return maxStock > 0 && quantity >= maxStock;
    });

    const entriesLast24h = allProducts.filter((product) => {
      const createdAt = parseDate(product.createdAt);
      return createdAt && createdAt >= new Date(Date.now() - 24 * 60 * 60 * 1000);
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

    const reservedAlertDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pendingSales = await db.collection('sales')
      .find({ status: 'RESERVED', createdAt: { $lte: reservedAlertDeadline } })
      .toArray();

    const recentMovements = await db.collection('movimentacoes_estoque')
      .find({ timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } })
      .project({ sku: 1 })
      .toArray();
    const activeMovementSkus = new Set(
      recentMovements.map((movement) => movement.sku).filter(Boolean),
    );

    const idleStockProducts = activeMovementSkus.size
      ? await productsCol
          .find({
            quantity: { $gt: 0 },
            sku: { $nin: Array.from(activeMovementSkus) },
          })
          .limit(10)
          .toArray()
      : [];

    const soonDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const nearExpiryProducts = allProducts.filter((product) => {
      const value = product.expiryDate || product.validade || product.expirationDate;
      const parsed = parseDate(value);
      return (
        parsed &&
        parsed >= today &&
        parsed <= soonDate &&
        Boolean(product.perishable || value)
      );
    });

    const recentStockMovements = await db.collection('movimentacoes_estoque')
      .find({ timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } })
      .sort({ timestamp: -1 })
      .toArray();

    // Função auxiliar para gerar a chave de notificação (mesma lógica do frontend)
    const getNotificationKey = (notification) => {
      return `${notification.title || ''}||${notification.description || ''}`;
    };

    const notifications = [];
    
    // 1. Produtos em baixa
    if (lowStockProducts.length) {
      notifications.push({
        title: 'Produtos em baixa',
        description: `${lowStockProducts.length} produto(s) no limite mínimo de estoque`,
        href: '/pages/estoque.html',
        count: lowStockProducts.length,
        items: lowStockProducts.slice(0, 5).map((product) => ({
          name: product.name,
          sku: product.sku,
          quantity: Number(product.quantity || 0),
          minStock: Number(product.minStock || 0),
          maxStock: Number(product.maxStock || 0),
          perishable: Boolean(product.perishable),
          expiryDate: product.expiryDate || product.validade || product.expirationDate || null,
        })),
      });
    }
    
    // 2. Estoque parado/inativo
    if (idleStockProducts.length) {
      notifications.push({
        title: 'Estoque parado/inativo',
        description: `${idleStockProducts.length} produto(s) sem movimento nos últimos 7 dias`,
        href: '/pages/auditoria-estoque.html',
        count: idleStockProducts.length,
        items: idleStockProducts.slice(0, 5).map((product) => ({
          name: product.name,
          sku: product.sku,
          quantity: Number(product.quantity || 0),
          minStock: Number(product.minStock || 0),
          maxStock: Number(product.maxStock || 0),
          perishable: Boolean(product.perishable),
          expiryDate: product.expiryDate || product.validade || product.expirationDate || null,
        })),
      });
    }
    
    // 3. Vendas paradas há mais de 24h
    if (pendingSales.length) {
      notifications.push({
        title: 'Vendas paradas há mais de 24h',
        description: `${pendingSales.length} venda(s) reservada(s) aguardando conclusão`,
        href: '/pages/historico-vendas.html',
        count: pendingSales.length,
      });
    }

    // Filtrar notificações já descartadas
    const activeNotifications = notifications.filter((item) => !dismissedKeys.has(getNotificationKey(item)));

    const lowStockCount = lowStockProducts.length;

    return {
      statusCode: 200,
      body: JSON.stringify({
        revenue,
        salesCount,
        lowStockCount,
        totalProducts,
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
