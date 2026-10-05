import { MongoClient, Db, Collection } from 'mongodb';
import { TransactionDoc, SubscriptionDoc } from '../types/models.js';
import { logInfo, logError } from '../services/logger.js';

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function getDb(): Promise<Db> {
  if (cachedDb) {
    return cachedDb;
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not defined');
  }

  try {
    if (!cachedClient) {
      cachedClient = new MongoClient(uri, {
        maxPoolSize: 10,
        minPoolSize: 1,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
      });
      await cachedClient.connect();
      logInfo('Connected to MongoDB Atlas cluster');
    }

    const dbName = process.env.MONGODB_DB_NAME || 'spends_tracker';
    cachedDb = cachedClient.db(dbName);
    return cachedDb;
  } catch (err) {
    logError('MongoDB connection error', err);
    throw err;
  }
}

export async function getTransactionsCollection(): Promise<Collection<TransactionDoc>> {
  const db = await getDb();
  return db.collection<TransactionDoc>('transactions');
}

export async function getSubscriptionsCollection(): Promise<Collection<SubscriptionDoc>> {
  const db = await getDb();
  return db.collection<SubscriptionDoc>('subscriptions');
}

export async function ensureIndexes(): Promise<void> {
  try {
    const txCol = await getTransactionsCollection();
    const subCol = await getSubscriptionsCollection();

    await Promise.all([
      txCol.createIndex({ date: -1 }),
      txCol.createIndex({ type: 1, date: -1 }),
      txCol.createIndex({ category: 1 }),
      txCol.createIndex({ tag: 1 }),
      txCol.createIndex({ title: 'text', rawSms: 'text' }),
      subCol.createIndex({ nextRenewalDate: 1, status: 1 }),
      subCol.createIndex({ status: 1 }),
      subCol.createIndex({ title: 1 }),
    ]);

    logInfo('MongoDB indexes verified and ready');
  } catch (err) {
    logError('Error ensuring MongoDB indexes', err);
  }
}
