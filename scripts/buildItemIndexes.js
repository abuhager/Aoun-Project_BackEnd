require('dotenv').config();
const mongoose = require('mongoose');
const Item     = require('../models/Item');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('جارٍ بناء فهارس Item...');
  await Item.syncIndexes();
  console.log('تم بناء الفهارس بنجاح');
  process.exit(0);
})();
