// scripts/seed.js
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
require('dotenv').config();

const User    = require('../models/User');
const Item    = require('../models/Item');
const SafeHub = require('../models/SafeHub');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('✅ MongoDB متصل');

  // ─── نظّف كل شيء ───────────────────────────────────────────
  await Promise.all([
    User.deleteMany({}),
    Item.deleteMany({}),
    SafeHub.deleteMany({}),
  ]);
  console.log('🗑️  تم حذف البيانات القديمة');

  // ─── 1. SafeHubs ────────────────────────────────────────────
  const hubs = await SafeHub.create([
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
      isActive:     false, // غير نشط — للتيست
    },
  ]);
  console.log(`🏪 تم إضافة ${hubs.length} مراكز`);

  // ─── 2. Users ────────────────────────────────────────────────
  const password = await bcrypt.hash('Test@1234', 10);

  const users = await User.create([
    {
      name:               'أحمد المتبرع',
      email:              'donor@test.com',
      password,
      role:               'user',
      quota:              5,
      trustScore:         85,
      isVerifiedStudent:  true,
      phone:              '0791234567',
    },
    {
      name:               'سارة المستلمة',
      email:              'receiver@test.com',
      password,
      role:               'user',
      quota:              3,
      trustScore:         70,
      isVerifiedStudent:  true,
      phone:              '0797654321',
    },
    {
      name:               'مريم المستخدمة',
      email:              'user@test.com',
      password,
      role:               'user',
      quota:              5,
      trustScore:         60,
      isVerifiedStudent:  false,
      phone:              '0799999999',
    },
    {
      name:               'Admin النظام',
      email:              'admin@test.com',
      password,
      role:               'admin',
      quota:              99,
      trustScore:         100,
      isVerifiedStudent:  false,
      phone:              '0790000000',
    },
  ]);
  console.log(`👥 تم إضافة ${users.length} مستخدمين`);

  const [donor, receiver, , ] = users;

  // ─── 3. Items ────────────────────────────────────────────────
  const items = await Item.create([
    // متاح
    {
      title:       'لابتوب ديل Core i5',
      description: 'لابتوب مستعمل بحالة ممتازة، الرام 8GB والهارد 256GB SSD',
      category:    'إلكترونيات',
      location:    'الزرقاء',
      condition:   'مستعمل ممتاز',
      status:      'متاح',
      imageUrl:    'https://placehold.co/400x300?text=Laptop',
      donor:       donor._id,
      safeHub:     hubs[0]._id,
    },
    {
      title:       'كتب جامعية — هندسة برمجيات',
      description: 'مجموعة كتب سنة ثانية، حالة جيدة جداً',
      category:    'كتب',
      location:    'عمان',
      condition:   'مستعمل جيد',
      status:      'متاح',
      imageUrl:    'https://placehold.co/400x300?text=Books',
      donor:       donor._id,
      safeHub:     hubs[1]._id,
    },
    {
      title:       'كرسي مكتب مريح',
      description: 'كرسي مكتب بظهر طويل، مستعمل سنة واحدة فقط',
      category:    'أثاث',
      location:    'إربد',
      condition:   'مستعمل ممتاز',
      status:      'متاح',
      imageUrl:    'https://placehold.co/400x300?text=Chair',
      donor:       donor._id,
      safeHub:     hubs[2]._id,
    },
    // محجوز
    {
      title:       'هاتف سامسونج A52',
      description: 'هاتف بحالة جيدة، بطارية تدوم يوم كامل',
      category:    'إلكترونيات',
      location:    'الزرقاء',
      condition:   'مستعمل جيد',
      status:      'محجوز',
      imageUrl:    'https://placehold.co/400x300?text=Phone',
      donor:       donor._id,
      bookedBy:    receiver._id,
      bookedAt:    new Date(),
      deliveryOtp: '4821',
      safeHub:     hubs[0]._id,
    },
    // تم التسليم
    {
      title:       'طابعة HP LaserJet',
      description: 'طابعة ليزر بحالة جيدة، تحتاج كارتريج جديد',
      category:    'إلكترونيات',
      location:    'عمان',
      condition:   'مستعمل جيد',
      status:      'تم التسليم',
      imageUrl:    'https://placehold.co/400x300?text=Printer',
      donor:       donor._id,
      bookedBy:    receiver._id,
      bookedAt:    new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      isRated:     false,
      safeHub:     hubs[1]._id,
    },
    // جديد
    {
      title:       'ملابس شتوية للأطفال',
      description: 'ملابس نظيفة مقاس 8-10 سنوات',
      category:    'ملابس',
      location:    'الزرقاء',
      condition:   'جديد',
      status:      'متاح',
      imageUrl:    'https://placehold.co/400x300?text=Clothes',
      donor:       receiver._id, // المستلمة تتبرع أيضاً
      safeHub:     hubs[0]._id,
    },
  ]);
  console.log(`📦 تم إضافة ${items.length} أغراض`);

  // ─── ملخص ───────────────────────────────────────────────────
  console.log('\n══════════════════════════════');
  console.log('🎉 Seed تم بنجاح!');
  console.log('══════════════════════════════');
  console.log('📧 Accounts:');
  console.log('   donor@test.com    | Test@1234 | متبرع');
  console.log('   receiver@test.com | Test@1234 | مستلم');
  console.log('   user@test.com     | Test@1234 | مستخدم عادي');
  console.log('   admin@test.com    | Test@1234 | أدمن');
  console.log('══════════════════════════════\n');

  mongoose.disconnect();
});