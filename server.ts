import 'dotenv/config';
import http from 'http';
import mongoose from 'mongoose';
import { validateEnvironment } from './config/env.js';
import { connectRedis, closeRedis } from './middlewares/rateLimiter.js';
import app from './app.js';
import connectDB from './config/db.js';
import { initCronJobs, stopCronJobs } from './jobs/cronJobs.js';
import { initSocket, resetIO } from './socket/index.js';

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
  await stopCronJobs();

  const activeIo = runtime.io;
  const activeServer = runtime.server;
  if (activeIo) {
    await new Promise<void>((resolve) => activeIo.close(() => resolve()));
    runtime.io = null;
    resetIO();
  } else if (activeServer?.listening) {
    await new Promise<void>((resolve, reject) => {
      activeServer.close((error) => (error ? reject(error) : resolve()));
    });
  }

  runtime.server = null;
  runtime.app = null;

  await closeRedis();

  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(false);
  }
};

const gracefulShutdown = (signal: string, exitCode = 0): Promise<void> => {
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

const shutdownAndExit = async (signal: string, exitCode: number): Promise<never> => {
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
  const server = http.createServer(app);
  const io = initSocket(server);
  runtime.app = app;
  runtime.server = server;
  runtime.io = io;
  app.set('io', io);

  await connectRedis();
  await connectDB();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
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

const isDirectExecution = /(?:^|[\\/])server\.(?:ts|js)$/.test(process.argv[1] ?? '');
if (isDirectExecution) {
  registerProcessHandlers();
  startServer().catch(async (error) => {
    console.error('[Startup] فشل تشغيل الخادم:', error);
    await shutdownAndExit('STARTUP_FAILURE', 1);
  });
}

export { closeResources, gracefulShutdown, registerProcessHandlers, runtime, shutdownAndExit, startServer };
export default {
  closeResources,
  gracefulShutdown,
  registerProcessHandlers,
  runtime,
  shutdownAndExit,
  startServer,
};
