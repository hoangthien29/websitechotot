const dns = require('node:dns');
const mongoose = require('mongoose');

const configureDnsServers = () => {
  const dnsServers = process.env.MONGODB_DNS_SERVERS
    ?.split(',')
    .map((server) => server.trim())
    .filter(Boolean);

  if (dnsServers?.length) {
    dns.setServers(dnsServers);
  }
};

const connectDatabase = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
      throw new Error(
        'MONGODB_URI chưa được cấu hình. Hãy thêm biến này vào file .env.',
      );
    }

    configureDnsServers();

    const connection = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log('MongoDB connected successfully');

    return connection;
  } catch (error) {
    console.error(`MongoDB connection failed (${error?.name || 'UnknownError'})`);
    throw error;
  }
};

module.exports = connectDatabase;
