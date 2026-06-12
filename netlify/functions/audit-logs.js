const { getDb } = require('../../src/lib/mongodb');
const { verifyToken } = require('../../src/lib/auth');

exports.handler = async (event, context) => {
    const user = verifyToken(event);
    if (!user) {
        return {
            statusCode: 401,
            body: JSON.stringify({ message: 'Não autorizado' })
        };
    }

    try {
        const db = await getDb();
        const logs = db.collection('logs');
        
        const { action, entity, start, end, page = 1, limit = 100 } = event.queryStringParameters || {};
        let query = {};

        if (action) query.action = action;
        if (entity) query.entity = entity;
        if (start && end) {
            query.timestamp = {
                $gte: new Date(start),
                $lte: new Date(end)
            };
        }

        const pageNum = Math.max(1, parseInt(page, 10));
        const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
        const skip = (pageNum - 1) * limitNum;

        // Executar count e find em paralelo
        const [totalCount, data] = await Promise.all([
            logs.countDocuments(query),
            logs.find(query).sort({ timestamp: -1 }).skip(skip).limit(limitNum).toArray()
        ]);
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                logs: data,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: totalCount,
                    totalPages: Math.ceil(totalCount / limitNum)
                }
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
