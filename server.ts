require('dotenv').config();

const http = require('http');
const mongoose = require('mongoose');

const { validateEnvironment } = require('./config/env');
const { connectRedis, closeRedis } = require('./middlewares/rateLimiter');

const runtime: {
  app: import('express').Express | null;
  server: import('http').Server | null;
  io: import('socket.io').Server | null;
} = {
  app: null,
  server: null,
  io: null,
};

let shutdownPromise: Promise<void> | null = null;
let processHandlersRegistered = false;

const closeResources = async () => {
  const { stopCronJobs } = require('./jobs/cronJobs');
  await stopCronJobs();

  if (runtime.io) {
    const { resetIO } = require('./socket');
    await new Promise<void>((resolve) => runtime.io.close(() => resolve()));
    runtime.io = null;
    resetIO();
  } else if (runtime.server?.listening) {
    await new Promise<void>((resolve, reject) => {
      runtime.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  runtime.server = null;
  runtime.app = null;

  await closeRedis();

  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(false);
  }
};

const gracefulShutdown = (signal, exitCode = 0) => {
  if (shutdownPromise) return shutdownPromise;

  console.log(`[Shutdown] بدء الإغلاق الآمن بسبب ${signal}`);
  const forceTimer = setTimeout(() => {
    console.error('[Shutdown] تجاوز مهلة الإغلاق الآمن');
    process.exit(1);
  }, 15_000);
  forceTimer.unref();

  shutdownPromise = closeResources()
    .then(() => {
      clearTimeout(forceTimer);
      process.exitCode = exitCode;
      console.log('[Shutdown] أُغلقت الموارد بنجاح');
    })
    .catch((error) => {
      clearTimeout(forceTimer);
      process.exitCode = 1;
      console.error('[Shutdown] فشل إغلاق أحد الموارد:', error);
    });

  return shutdownPromise;
};

const shutdownAndExit = async (signal, exitCode) => {
  await gracefulShutdown(signal, exitCode);
  process.exit(process.exitCode ?? exitCode);
};

const registerProcessHandlers = () => {
  if (processHandlersRegistered) return;
  processHandlersRegistered = true;

  process.once('SIGTERM', () => void shutdownAndExit('SIGTERM', 0));
  process.once('SIGINT', () => void shutdownAndExit('SIGINT', 0));
  process.once('uncaughtException', (error) => {
    console.error('[uncaughtException] خطأ غير معالج:', error);
    void shutdownAndExit('uncaughtException', 1);
  });
  process.once('unhandledRejection', (reason) => {
    console.error('[unhandledRejection] رفض Promise غير معالج:', reason);
    void shutdownAndExit('unhandledRejection', 1);
  });
};

const startServer = async () => {
  const { port, nodeEnv } = validateEnvironment();
  const app = require('./app');
  const connectDB = require('./config/db');
  const { initCronJobs } = require('./jobs/cronJobs');
  const { initSocket } = require('./socket');

  runtime.app = app;
  runtime.server = http.createServer(app);
  runtime.io = initSocket(runtime.server);
  app.set('io', runtime.io);

  await connectRedis();
  await connectDB();

  await new Promise<void>((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(port, () => {
      runtime.server.off('error', reject);
      resolve();
    });
  });

  console.log(`[Startup] الخادم يعمل على المنفذ ${port} — البيئة: ${nodeEnv}`);

  try {
    await initCronJobs();
    console.log('[Startup] تمت تهيئة Cron Jobs');
  } catch (error) {
    console.error('[Startup] فشلت تهيئة Cron Jobs والخادم مستمر:', error);
  }

  return { ...runtime };
};

if (require.main === module) {
  registerProcessHandlers();
  startServer().catch(async (error) => {
    console.error('[Startup] فشل تشغيل الخادم:', error);
    await shutdownAndExit('STARTUP_FAILURE', 1);
  });
}

module.exports = {
  closeResources,
  gracefulShutdown,
  registerProcessHandlers,
  runtime,
  shutdownAndExit,
  startServer,
};
