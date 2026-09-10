const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/scot_sales_db';

  try {
    console.log(`Connecting to MongoDB at: ${uri}...`);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 3000
    });
    console.log('✅ Connected to MongoDB successfully!');
    return { type: 'standalone', uri };
  } catch (err) {
    console.warn('⚠️ Could not connect to local standalone MongoDB server (' + err.message + ').');
    console.log('🔄 Launching automatic Embedded In-Memory MongoDB engine for zero-setup development...');
    
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create();
      const memoryUri = mongod.getUri();
      await mongoose.connect(memoryUri);
      console.log(`✅ Connected to Embedded In-Memory MongoDB successfully at: ${memoryUri}`);
      return { type: 'memory', uri: memoryUri, mongod };
    } catch (memErr) {
      console.error('❌ Failed to launch Embedded MongoDB:', memErr.message);
      throw memErr;
    }
  }
}

module.exports = connectDB;
