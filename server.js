// server.js — entry point فقط
require('dotenv').config();

const http              = require('http');
const app               = require('./app');
const connectDB         = require('./config/db');
const { initCronJobs }  = require('./jobs/cronJobs'); // ✅ startCronJobs → initCronJobs
const { initSocket }    = require('./socket');

const PORT   = process.env.PORT || 5000;
const server = http.createServer(app);

initSocket(server);

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
    initCronJobs(); // ✅ موجود بالفعل — الاسم صح الآن
  });
});