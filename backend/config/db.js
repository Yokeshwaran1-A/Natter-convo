const mongoose = require('mongoose');

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI is not set in the environment');
  }

  const hasExplicitDbName = /^mongodb(\+srv)?:\/\/[^/]+\/[^?]+/.test(mongoUri);

  if (!hasExplicitDbName) {
    console.warn(
      'MongoDB URI does not include a database name. Example: mongodb+srv://user:pass@cluster.mongodb.net/chatapp'
    );
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection failed.');
    console.error('Check MONGO_URI, Atlas IP access, DB username/password, and network access.');
    throw err;
  }
};

module.exports = connectDB;
