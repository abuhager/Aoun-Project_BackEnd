// scripts/seedHubs.js
const mongoose = require('mongoose');
const SafeHub  = require('../models/SafeHub');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  await SafeHub.deleteMany({}); // نظّف القديم

  await SafeHub.create([
    {
      name:         'مركز الزرقاء الرئيسي',
      address:      'شارع الملك طلال، مقابل البريد',
      city:         'الزرقاء',
      workingHours: '9:00 ص — 5:00 م',
      isActive:     true,
    },
    {
      name:         'مركز عمان الغربي',
      address:      'شارع الجامعة الأردنية',
      city:         'عمان',
      workingHours: '10:00 ص — 6:00 م',
      isActive:     true,
    },
    {
      name:         'مركز إربد',
      address:      'شارع الجامعة، بجانب مسجد النور',
      city:         'إربد',
      workingHours: '9:00 ص — 4:00 م',
      isActive:     true,
    },
    {
      name:         'مركز العقبة',
      address:      'شارع الملك حسين',
      city:         'العقبة',
      workingHours: '8:00 ص — 3:00 م',
      isActive:     false, // ✅ واحد غير نشط للتيست
    },
  ]);

  console.log('✅ تم إضافة 4 مراكز بنجاح');
  mongoose.disconnect();
});