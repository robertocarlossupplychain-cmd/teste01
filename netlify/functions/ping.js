const { getDb } = require('../../src/lib/mongodb');

exports.handler = async (event) => {
  let dbStatus = 'not tested';
  let dbError = null;

  try {
    const db = await getDb();
    const collections = await db.listCollections().toArray();
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'failed';
    dbError = err.message;
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        error: dbError
      },
      env: {
        has_mongo_uri: !!process.env.MONGODB_URI,
        has_jwt_secret: !!process.env.JWT_SECRET,
        node_version: process.version
      }
    })
  };
};
