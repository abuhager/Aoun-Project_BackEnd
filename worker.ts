import 'dotenv/config';
import mongoose from 'mongoose';
import { validateEnvironment } from './config/env.js';
import connectDB from './config/db.js';
import { startOutboxWorker, stopOutboxWorker } from './jobs/outboxWorker.js';

let shutdownPromise: Promise<void> | null = null;

const shutdown = (signal: string, exitCode = 0) => {
  if (shutdownPromise) return shutdownPromise;
  console.log(`[Outbox] بدء الإغلاق الآمن بسبب ${signal}`);
  shutdownPromise = stopOutboxWorker()
    .then(() => mongoose.connection.close(false))
    .then(() => {
      process.exitCode = exitCode;
    });
  return shutdownPromise;
};

const startWorker = async () => {
  validateEnvironment();
  await connectDB();
  const { workerId } = await startOutboxWorker();
  console.log(`[Outbox] العامل جاهز: ${workerId}`);
};

const shutdownAndExit = async (signal: string, exitCode: number): Promise<never> => {
  await shutdown(signal, exitCode);
  process.exit(process.exitCode ?? exitCode);
};

process.once('SIGTERM', () => void shutdownAndExit('SIGTERM', 0));
process.once('SIGINT', () => void shutdownAndExit('SIGINT', 0));
process.once('uncaughtException', (error) => {
  console.error('[Outbox] uncaughtException:', error);
  void shutdownAndExit('uncaughtException', 1);
});
process.once('unhandledRejection', (reason) => {
  console.error('[Outbox] unhandledRejection:', reason);
  void shutdownAndExit('unhandledRejection', 1);
});

startWorker().catch(async (error) => {
  console.error('[Outbox] فشل بدء العامل:', error);
  await shutdownAndExit('STARTUP_FAILURE', 1);
});

export { shutdown, startWorker };
