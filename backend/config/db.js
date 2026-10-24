const mongoose = require('mongoose');
const config = require('./index');

mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);
mongoose.set('bufferCommands', false);

async function connectDB() {
  if (!config.mongoUri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(config.mongoUri, {
    dbName: config.mongoDbName,
    serverSelectionTimeoutMS: 15000,
  });
  console.log(`[db] Connected to MongoDB database "${config.mongoDbName}"`);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes().catch((e) => {
    console.warn(`[db] Index sync failed for ${m.modelName}: ${e.message}`);
  })));
}

const isDbReady = () => mongoose.connection.readyState === 1;

module.exports = { connectDB, isDbReady };
