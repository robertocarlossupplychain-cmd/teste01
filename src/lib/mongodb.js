const { MongoClient } = require('mongodb');
try {
  require('dotenv').config();
} catch (e) {
  // Ignore error if dotenv is not available (production)
}

let cachedClient = null;
let cachedDb = null;

async function getDb() {
  const uri = process.env.MONGODB_URI;
  
  if (!uri) {
    console.error('Error: MONGODB_URI is not defined');
    throw new Error('Please add your Mongo URI to environment variables');
  }

  // Retornar cache se disponível
  if (cachedClient && cachedDb) {
    return cachedDb;
  }

  // Configurar cliente com opções otimizadas
  if (!cachedClient) {
    cachedClient = new MongoClient(uri, {
      maxPoolSize: 10, // Tamanho máximo do pool de conexões
      minPoolSize: 2, // Tamanho mínimo do pool
      maxIdleTimeMS: 30000, // Fechar conexões ociosas após 30 segundos
      serverSelectionTimeoutMS: 5000, // Reduzir timeout para 5 segundos
      connectTimeoutMS: 5000,
      heartbeatFrequencyMS: 10000,
      socketTimeoutMS: 45000,
      compressors: ['zlib'], // Habilitar compressão para reduzir tamanho dos dados
      retryWrites: true,
      retryReads: true,
    });
    
    // Conectar e cachear
    await cachedClient.connect();
  }

  cachedDb = cachedClient.db();
  return cachedDb;
}

// Função para fechar a conexão (útil em ambientes serverless)
async function closeClient() {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
  }
}

module.exports = { getDb, closeClient };
