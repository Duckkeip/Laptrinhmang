const mongoose = require('mongoose');

async function connectDB(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log(`Da ket noi MongoDB: ${mongoose.connection.name}`);
  return mongoose.connection;
}

module.exports = { connectDB };
