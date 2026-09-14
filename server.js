require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');

const connectDatabase = require('./backend/config/database');
const {
  getPort,
  validateEnvironment,
} = require('./backend/config/environment');
const {
  closeSessionStore,
  waitForSessionStore,
} = require('./backend/config/session');

const SHUTDOWN_TIMEOUT_MS = 10000;

let server;
let isShuttingDown = false;

const closeHttpServer = () =>
  new Promise((resolve, reject) => {
    if (!server || !server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const closeDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('MongoDB connection closed successfully');
  }
};

const shutdown = async (signal) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`${signal} received. Shutting down gracefully...`);
  const fallbackTimer = setTimeout(() => {
    server?.closeAllConnections?.();
    console.error('Graceful shutdown vượt quá thời gian cho phép.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  fallbackTimer.unref();

  try {
    await closeHttpServer();
    await closeSessionStore();
    await closeDatabase();
    clearTimeout(fallbackTimer);
    console.log('NTT Marketplace stopped successfully');
    process.exitCode = 0;
  } catch (error) {
    clearTimeout(fallbackTimer);
    console.error('Error while shutting down:', error.message);
    process.exitCode = 1;
  }
};

const handleServerError = async (error) => {
  const port = getPort();

  if (error.code === 'EADDRINUSE') {
    console.error(`Không thể khởi động: cổng ${port} đang được sử dụng.`);
  } else {
    console.error('Không thể khởi động NTT Marketplace:', error.message);
  }

  process.exitCode = 1;

  try {
    await closeSessionStore();
    await closeDatabase();
  } catch (closeError) {
    console.error('Không thể đóng kết nối MongoDB:', closeError.message);
  }
};

const startServer = async () => {
  let runtimeConfig;

  try {
    runtimeConfig = validateEnvironment();
  } catch (error) {
    console.error(`Cấu hình môi trường không hợp lệ: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    await connectDatabase();

    // Khởi tạo app sau khi cấu hình DNS và kết nối MongoDB thành công.
    // Việc này ngăn connect-mongo tra cứu SRV bằng DNS mặc định quá sớm.
    const app = require("./backend/app"); 
    await waitForSessionStore();

    server = app.listen(runtimeConfig.port, () => {
      console.log(
        `NTT Marketplace đang chạy tại http://localhost:${runtimeConfig.port}`,
      );
    });

    server.on('error', handleServerError);
  } catch (error) {
    if (isShuttingDown) {
      return;
    }

    console.error(
      'Không thể khởi động NTT Marketplace vì kết nối MongoDB không thành công.',
    );
    process.exitCode = 1;
  }
};

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

if (require.main === module) {
  void startServer();
}

module.exports = {
  closeDatabase,
  closeHttpServer,
  shutdown,
  startServer,
};
