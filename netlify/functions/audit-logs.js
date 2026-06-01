const { getDb } = require('../../src/lib/mongodb');
const { verifyToken } = require('../../src/lib/auth');

exports.handler = async (event, context) => {
  const user = verifyToken(event);
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ message: 'Não autorizado' }) };
  }

  try {
    const db = await getDb();
    const logs = db.collection('logs');
    
    const { action, entity, start, end } = event.queryStringParameters || {};
    let query = {};

    if (action) query.action = action;
    if (entity) query.entity = entity;
    if (start && end) {
      query.timestamp = {
        $gte: new Date(start),
        $lte: new Date(end)
      };
    }

    const data = await logs.find(query).sort({ timestamp: -1 }).limit(100).toArray();
    
    // Se a consulta for para logs de estoque, podemos injetar informações de produtos parados
    let stagnantProducts = [];
    if (!action && !entity) {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      // Buscar produtos que não aparecem em vendas nos últimos 90 dias
      // Simplificado: buscar produtos e filtrar os que não estão em sales recentes
      const products = await db.collection('products').find({}).toArray();
      const recentSales = await db.collection('sales').find({
        createdAt: { $gte: ninetyDaysAgo }
      }).toArray();

      const soldProductIds = new Set();
      recentSales.forEach(s => s.items.forEach(i => soldProductIds.add(i.id)));

      stagnantProducts = products.filter(p => !soldProductIds.has(p._id.toString()) && (p.quantity || 0) > 0);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        logs: data,
        stagnantProducts: stagnantProducts.map(p => ({ id: p._id, name: p.name, quantity: p.quantity, price: p.price }))
      })
    };
  } catch (error) {
    console.error('Audit logs error:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ 
        message: 'Erro ao carregar logs de auditoria',
        error: error.message
      }) 
    };
  }
};
