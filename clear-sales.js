require('dotenv').config();
const { MongoClient } = require('mongodb');

async function clearSales() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Erro: variável de ambiente MONGODB_URI não está definida.');
    process.exit(1);
  }

  const client = new MongoClient(uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    family: 4
  });

  try {
    await client.connect();
    const db = client.db();
    console.log('Conectado ao MongoDB.');

    // Apaga apenas a coleção de vendas
    const salesColl = db.collection('sales');
    try {
      await salesColl.drop();
      console.log('Coleção \'sales\' removida com sucesso.');
    } catch (error) {
      if (error.codeName === 'NamespaceNotFound' || error.message.includes('ns not found')) {
        console.log('Coleção \'sales\' não existe, nada para limpar.');
      } else {
        throw error;
      }
    }

    console.log('Vendas limpas com sucesso! O banco de dados foi zerado em relação às vendas.');
    console.log('Todos os outros dados (produtos, usuários, configurações, etc.) foram mantidos.');
  } catch (error) {
    console.error('Erro ao limpar as vendas:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

clearSales();
