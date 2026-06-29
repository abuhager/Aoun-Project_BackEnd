// scripts/seed.js — النسخة المصلحة بتشفير الباسورد آمن
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs'); // 🔥 استيراد مكتبة التشفير

// تحميل متغيرات البيئة
dotenv.config();

// استيراد الموديلات
const User = require('../models/User');
const SafeHub = require('../models/SafeHub');
const Item = require('../models/Item');
const DonationRequest = require('../models/DonationRequest');
const DonationOffer = require('../models/DonationOffer');
const Conversation = require('../models/Conversation');
const Notification = require('../models/Notification');
const Rating = require('../models/Rating');
const Report = require('../models/Report');
const SystemSettings = require('../models/SystemSettings');
const AdminLog = require('../models/AdminLog');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:20017/aoun_db';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

const seedDatabase = async () => {
  try {
    console.log('⏳ جاري الاتصال بقاعدة البيانات...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ تم الاتصال بنجاح.');

    // 1. تنظيف قاعدة البيانات القديمة لتجنب تعارض الفهارس الفريدة
    console.log('🧹 جاري تنظيف البيانات القديمة...');
    await Promise.all([
      User.deleteMany({}),
      SafeHub.deleteMany({}),
      Item.deleteMany({}),
      DonationRequest.deleteMany({}),
      DonationOffer.deleteMany({}),
      Conversation.deleteMany({}),
      Notification.deleteMany({}),
      Rating.deleteMany({}),
      Report.deleteMany({}),
      SystemSettings.deleteMany({}),
      AdminLog.deleteMany({})
    ]);

    // 2. إدخال إعدادات النظام الأساسية
    console.log('⚙️ إدخال إعدادات النظام...');
    const settings = await SystemSettings.create({
      _id: 'global',
      defaultQuota: 2,
      level2Quota: 4,
      maxBookingsPerUser: 3,
      maxActiveRequestsPerMonth: 2,
      categories: ['كتب', 'إلكترونيات', 'أثاث', 'ملابس', 'أخرى'],
      universityEmailDomains: [
        '@student.ju.edu.jo',   '@ju.edu.jo',
        '@std-zuj.edu.jo',      '@stu.yarmouk.edu.jo', // 🔥 نطاق جامعة الزيتونة مدمج وثابت
        '@yarmouk.edu.jo',     '@psut.edu.jo',
      ],
      reportReasons: ['لم يُسلّم الغرض', 'معلومات مضللة', 'سلوك غير لائق', 'أخرى']
    });

    // 3. تشفير الرقم السري للمستخدمين التجريبيين
    console.log('🔐 جاري تشفير كلمة المرور الافتراضية...');
    const rawPassword = '1870547aA';
    const hashedPassword = await bcrypt.hash(rawPassword, BCRYPT_ROUNDS); // 🔥 تشفير حقيقي يطابق الباكيند

    console.log('👤 إنشاء مستخدمين تجريبيين مفعّلين...');
    const admin = await User.create({
      name: 'أحمد المسؤول',
      email: 'admin@aoun.jo',
      password: hashedPassword, // الحفظ بالهاش المشفر
      role: 'admin',
      isVerified: true,
      phone: '+962790000001',
      phoneVerified: true,
      trustLevel: 4,
      trustScore: 100
    });

    const donor = await User.create({
      name: 'عمر المتبرع',
      email: 'donor@gmail.com',
      password: hashedPassword,
      role: 'user',
      isVerified: true,
      phone: '+962790000002',
      phoneVerified: true,
      trustLevel: 2,
      trustScore: 85,
      totalDonations: 5
    });

    const requester = await User.create({
      name: 'سارة المستلمة',
      email: 'sara@student.ju.edu.jo',
      password: hashedPassword,
      role: 'user',
      isVerified: true,
      phone: '+962790000003',
      phoneVerified: true,
      isVerifiedStudent: true,
      trustLevel: 1,
      trustScore: 70
    });

    // 4. إنشاء المراكز الآمنة (SafeHubs)
    console.log('📍 إنشاء المراكز الآمنة...');
    const hubAmman = await SafeHub.create({
      name: 'مركز عمان الآمن - العبدلي',
      address: 'شارع الملك حسين، بجانب الهيئة المستقلة',
      city: 'عمان',
      coordinates: { lat: 31.9631, lng: 35.9052 },
      isActive: true,
      createdBy: admin._id,
      workingHours: '9:00 ص — 6:00 م'
    });

    const hubIrbid = await SafeHub.create({
      name: 'مركز إربد الآمن - قُرب جامعة اليرموك',
      address: 'شارع الجامعة، مجمع الرشيد',
      city: 'إربد',
      coordinates: { lat: 32.5514, lng: 35.8514 },
      isActive: true,
      createdBy: admin._id
    });

    // 5. إنشاء طلب تبرع (Donation Request)
    console.log('📝 إنشاء طلبات التبرع...');
    const request1 = await DonationRequest.create({
      requester: requester._id,
      title: 'بحاجة إلى كتاب فيزياء 101 للجامعة',
      category: 'كتب',
      urgency: 'high',
      description: 'أنا طالبة في الجامعة الأردنية وأحتاج هذا الكتاب لغايات الدراسة الحالية.',
      location: 'عمان',
      status: 'active',
      month: new Date().toISOString().substring(0, 7),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    // 6. إنشاء عرض تبرع مبني على الطلب (Donation Offer)
    console.log('🤝 إنشاء عروض التبرع...');
    const offer1 = await DonationOffer.create({
      request: request1._id,
      donor: donor._id,
      safeHub: hubAmman._id,
      condition: 'مستعمل ممتاز',
      description: 'لدي نسخة نظيفة جداً من كتاب الفيزياء 101 وسأقوم بتسليمها للمركز غداً.',
      status: 'pending'
    });

    // 7. إنشاء غرض متاح عام (Item)
    console.log('📦 إنشاء الأغراض المتاحة...');
    const item1 = await Item.create({
      title: 'شاحن حاسوب محمول HP أصلي',
      description: 'شاحن مستعمل يعمل بكفاءة ممتازة، بقوة 65 واط.',
      category: 'إلكترونيات',
      location: 'عمان',
      condition: 'مستعمل جيد',
      safeHub: hubAmman._id,
      donor: donor._id,
      status: 'متاح',
      waitlist: []
    });

    const item2 = await Item.create({
      title: 'طاولة دراسة خشبية',
      description: 'طاولة صغيرة مناسبة لطلاب الشقق المفروشة.',
      category: 'أثاث',
      location: 'إربد',
      condition: 'مستعمل ممتاز',
      safeHub: hubIrbid._id,
      donor: donor._id,
      bookedBy: requester._id,
      bookedAt: new Date(),
      status: 'محجوز'
    });

    // 8. إنشاء محادثة (Conversation)
    console.log('💬 إنشاء المحادثات والرسائل...');
    await Conversation.create({
      item: item2._id,
      participants: [donor._id, requester._id],
      messages: [
        {
          sender: requester._id,
          text: 'مرحباً، هل الطاولة تفك وتتركب بسهولة؟',
          createdAt: new Date(Date.now() - 3600000),
          read: true
        },
        {
          sender: donor._id,
          text: 'أهلاً وسهلاً، نعم الطاولة خفيفة ويمكن نقلها بالسيارة العادية بسهولة.',
          createdAt: new Date(Date.now() - 1800000),
          read: false
        }
      ],
      lastActivity: new Date()
    });

    // 9. إنشاء تقييم افتراضي
    console.log('⭐ إنشاء التقييمات...');
    await Rating.create({
      item: item2._id,
      rater: requester._id,
      ratee: donor._id,
      score: 9,
      comment: 'المتبرع متعاون جداً وجزاه الله خيراً',
      isHandoverConfirmed: true,
      trustDelta: 5
    });

    // 10. إنشاء بلاغ تجريبي
    console.log('🚩 إنشاء بلاغات الشكاوى...');
    await Report.create({
      reporter: requester._id,
      reportedUser: donor._id,
      relatedItem: item1._id,
      reason: 'معلومات مضللة',
      details: 'لقد ذكرت هذا البلاغ كنموذج فحص للنظام فقط لضمان عمل الفهارس المركبة.',
      status: 'pending'
    });

    // 11. سجلات المشرفين (Admin Logs)
    console.log('🛡️ إنشاء سجلات الرقابة...');
    await AdminLog.create({
      adminId: admin._id,
      action: 'HUB_MANAGE',
      targetModel: 'User',
      targetName: 'تحديث مراكز الدعم الافتراضية للبلد',
      adminNote: 'تم تهيئة النظام وبدء العمل بالـ SafeHubs الجديدة'
    });

    // 12. إشعارات (Notifications)
    console.log('🔔 إرسال الإشعارات الافتراضية...');
    await Notification.create({
      user: donor._id,
      type: 'request_new_offer',
      title: 'عرض جديد مطلوب',
      body: 'هناك طلب متوافق مع تصنيفاتك المفضلة، تفقد قائمة الطلبات الحالية.'
    });

    console.log('--------------------------------------------------');
    console.log('🎉 تم ملء قاعدة البيانات بالباسوردات المشفرة بنجاح!');
    console.log('--------------------------------------------------');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ حدث خطأ أثناء عملية السيرش (Seeding):', error);
    process.exit(1);
  }
};

seedDatabase();