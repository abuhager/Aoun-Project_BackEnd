// server.js — entry point فقط
require('dotenv').config();

const app             = require('./app');
const connectDB       = require('./config/db');
const { startCronJobs } = require('./jobs/cronJobs');

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
    startCronJobs();
  });
});