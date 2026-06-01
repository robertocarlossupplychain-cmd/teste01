const { MongoClient } = require('mongodb');
try {
  require('dotenv').config();
} catch (e) {
  // Ignore error if dotenv is not available (production)
}

let client;
let clientPromise;

async function getDb() {
  const uri = process.env.MONGODB_URI;
  
  if (!uri) {
    console.error('Error: MONGODB_URI is not defined');
    throw new Error('Please add your Mongo URI to environment variables');
  }

  if (!clientPromise) {
    client = new MongoClient(uri, { 
      family: 4,
      serverSelectionTimeoutMS: 15000, // Aumentado para produção
      connectTimeoutMS: 15000,
      heartbeatFrequencyMS: 10000
    });
    clientPromise = client.connect();
  }

  try {
    const connection = await clientPromise;
    return connection.db();
  } catch (error) {
    clientPromise = null; // Reset on failure
    throw error;
  }
}

module.exports = { getDb };
