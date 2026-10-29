import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

mongoose.set('strictQuery', true);

export async function connectDb(uri = env.MONGODB_URI) {
  console.log('Connecting to MongoDB...');
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log('✓ MongoDB connected');
    logger.info('mongodb connected');
  } catch (err) {
    console.error('MongoDB connection failed.');
    console.error('Please make sure MongoDB is running locally (mongod) and MONGODB_URI is correct:', uri);
    throw err;
  }
}
export async function disconnectDb() {
  await mongoose.disconnect();
}
