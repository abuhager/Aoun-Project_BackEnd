// scripts/seed.js
// Destructive demo seed. It only runs after explicit environment safeguards.
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

dotenv.config();

const User = require('../models/User');
const SafeHub = require('../models/SafeHub');
const Item = require('../models/Item');
const DonationRequest = require('../models/DonationRequest');
const DonationOffer = require('../models/DonationOffer');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const Rating = require('../models/Rating');
const Report = require('../models/Report');
const SystemSettings = require('../models/SystemSettings');
const AdminLog = require('../models/AdminLog');

const COLLECTION_MODELS = [
  Message,
  Conversation,
  Notification,
  Rating,
  Report,
  DonationOffer,
  DonationRequest,
  Item,
  SafeHub,
  AdminLog,
  User,
  SystemSettings,
];

const getSeedConfig = (env = process.env) => ({
  nodeEnv: env.NODE_ENV ?? 'development',
  destructiveOptIn: env.ALLOW_DESTRUCTIVE_SEED,
  mongoUri: env.MONGO_URI,
  targetDb: env.SEED_TARGET_DB,
  demoPassword: env.SEED_DEMO_PASSWORD,
  bcryptRounds: Number.parseInt(env.BCRYPT_ROUNDS ?? '12', 10),
});

const assertSafeSeedEnvironment = (env = process.env) => {
  const config = getSeedConfig(env);

  if (config.nodeEnv === 'production') {
    throw new Error('رفض تشغيل seed على NODE_ENV=production.');
  }
  if (config.destructiveOptIn !== 'true') {
    throw new Error('اضبط ALLOW_DESTRUCTIVE_SEED=true لتأكيد حذف بيانات قاعدة التطوير.');
  }
  if (!config.mongoUri) {
    throw new Error('MONGO_URI مطلوب صراحةً؛ لا توجد قاعدة افتراضية للـseed.');
  }
  if (!config.targetDb) {
    throw new Error('SEED_TARGET_DB مطلوب لتأكيد اسم قاعدة البيانات المستهدفة.');
  }
  if (!config.demoPassword || config.demoPassword.length < 12) {
    throw new Error('SEED_DEMO_PASSWORD يجب أن يحتوي 12 محرفاً على الأقل.');
  }
  if (!Number.isInteger(config.bcryptRounds)
      || config.bcryptRounds < 10
      || config.bcryptRounds > 15) {
    throw new Error('BCRYPT_ROUNDS يجب أن يكون رقماً صحيحاً بين 10 و15.');
  }

  return config;
};

const createOne = async (Model, payload, session) => {
  const [document] = await Model.create([payload], { session });
  return document;
};

const seedDatabase = async (env = process.env) => {
  const config = assertSafeSeedEnvironment(env);
  let session;

  try {
    console.log('⏳ جاري الاتصال بقاعدة بيانات التطوير...');
    await mongoose.connect(config.mongoUri);

    const connectedDb = mongoose.connection.name;
    if (connectedDb !== config.targetDb) {
      throw new Error(
        `رفض الحذف: قاعدة الاتصال الحالية "${connectedDb}" لا تطابق SEED_TARGET_DB="${config.targetDb}".`
      );
    }

    session = await mongoose.startSession();
    session.startTransaction();

    console.log(`🧹 حذف بيانات قاعدة التطوير المؤكدة: ${connectedDb}`);
    for (const Model of COLLECTION_MODELS) {
      await Model.deleteMany({}, { session });
    }

    const settings = await createOne(SystemSettings, {
      _id: 'global',
      defaultUserQuota: 2,
      studentQuota: 5,
      level2Quota: 4,
      maxBookingsPerUser: 3,
      maxActiveRequestsPerMonth: 2,
      categories: ['كتب', 'إلكترونيات', 'أثاث', 'ملابس', 'أخرى'],
      universityEmailDomains: [
        '@student.ju.edu.jo',
        '@ju.edu.jo',
        '@stu.yarmouk.edu.jo',
        '@yarmouk.edu.jo',
        '@std-zuj.edu.jo',
        '@zuj.edu.jo',
        '@psut.edu.jo',
      ],
      reportReasons: ['لم يُسلّم الغرض', 'معلومات مضللة', 'سلوك غير لائق', 'أخرى'],
    }, session);

    const hashedPassword = await bcrypt.hash(config.demoPassword, config.bcryptRounds);

    const admin = await createOne(User, {
      name: 'مسؤول النظام التجريبي',
      email: 'admin@seed.aoun.local',
      password: hashedPassword,
      role: 'super_admin',
      isVerified: true,
      phone: '+962790000001',
      phoneVerified: true,
      trustLevel: 2,
      trustScore: 100,
    }, session);

    const donor = await createOne(User, {
      name: 'المتبرع التجريبي',
      email: 'donor@seed.aoun.local',
      password: hashedPassword,
      role: 'user',
      isVerified: true,
      phone: '+962790000002',
      phoneVerified: true,
      trustLevel: 2,
      trustScore: 85,
      totalDonations: 1,
    }, session);

    const requester = await createOne(User, {
      name: 'المستلمة التجريبية',
      email: 'seed.student@student.ju.edu.jo',
      password: hashedPassword,
      role: 'user',
      isVerified: true,
      phone: '+962790000003',
      phoneVerified: true,
      isVerifiedStudent: true,
      trustLevel: 2,
      trustScore: 70,
      quota: settings.studentQuota,
    }, session);

    const hubAmman = await createOne(SafeHub, {
      name: 'مركز عمان الآمن - العبدلي',
      address: 'شارع الملك حسين، بجانب الهيئة المستقلة',
      city: 'عمان',
      coordinates: { lat: 31.9631, lng: 35.9052 },
      isActive: true,
      createdBy: admin._id,
      workingHours: '9:00 ص — 6:00 م',
    }, session);

    const hubIrbid = await createOne(SafeHub, {
      name: 'مركز إربد الآمن - قرب جامعة اليرموك',
      address: 'شارع الجامعة، مجمع الرشيد',
      city: 'إربد',
      coordinates: { lat: 32.5514, lng: 35.8514 },
      isActive: true,
      createdBy: admin._id,
    }, session);

    const request = await createOne(DonationRequest, {
      requester: requester._id,
      title: 'بحاجة إلى كتاب فيزياء 101 للجامعة',
      category: 'كتب',
      urgency: 'high',
      description: 'طلب تجريبي لفحص دورة طلبات التبرع والعروض.',
      location: 'عمان',
      status: 'active',
      month: new Date().toISOString().slice(0, 7),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }, session);

    await createOne(DonationOffer, {
      request: request._id,
      donor: donor._id,
      safeHub: hubAmman._id,
      condition: 'مستعمل ممتاز',
      description: 'عرض تجريبي مرتبط بطلب التبرع.',
      status: 'pending',
    }, session);

    const availableItem = await createOne(Item, {
      title: 'شاحن حاسوب محمول HP أصلي',
      description: 'غرض تجريبي متاح للحجز.',
      category: 'إلكترونيات',
      location: 'عمان',
      condition: 'مستعمل جيد',
      safeHub: hubAmman._id,
      donor: donor._id,
      status: 'متاح',
    }, session);

    const deliveredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deliveredItem = await createOne(Item, {
      title: 'طاولة دراسة خشبية',
      description: 'غرض تجريبي اكتملت دورة تسليمه.',
      category: 'أثاث',
      location: 'إربد',
      condition: 'مستعمل ممتاز',
      safeHub: hubIrbid._id,
      donor: donor._id,
      bookedBy: requester._id,
      bookedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      status: 'تم التسليم',
      recipientConfirmed: true,
      donorConfirmed: true,
      recipientConfirmedAt: deliveredAt,
      donorConfirmedAt: deliveredAt,
      deliveredAt,
      isRated: true,
    }, session);

    const lastMessageAt = new Date(Date.now() - 30 * 60 * 1000);
    const conversation = await createOne(Conversation, {
      item: deliveredItem._id,
      owner: donor._id,
      requester: requester._id,
      participants: [donor._id, requester._id],
      lastMessage: 'شكراً لك، تم الاستلام بنجاح.',
      lastMessageAt,
    }, session);

    await Message.create([
      {
        conversation: conversation._id,
        sender: requester._id,
        clientMessageId: 'seed-requester-1',
        text: 'مرحباً، هل الطاولة سهلة النقل؟',
        read: true,
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
      {
        conversation: conversation._id,
        sender: donor._id,
        clientMessageId: 'seed-donor-1',
        text: 'نعم، ويمكن نقلها بسيارة عادية.',
        read: true,
        createdAt: new Date(Date.now() - 45 * 60 * 1000),
      },
      {
        conversation: conversation._id,
        sender: requester._id,
        clientMessageId: 'seed-requester-2',
        text: 'شكراً لك، تم الاستلام بنجاح.',
        read: true,
        createdAt: lastMessageAt,
      },
    ], { session });

    const trustDelta = 5;
    await createOne(Rating, {
      item: deliveredItem._id,
      rater: requester._id,
      ratee: donor._id,
      score: 9,
      comment: 'تقييم تجريبي بعد اكتمال التسليم.',
      isHandoverConfirmed: true,
      trustDelta,
    }, session);
    await User.updateOne({ _id: donor._id }, { $inc: { trustScore: trustDelta } }, { session });

    await createOne(Report, {
      reporter: requester._id,
      reportedUser: donor._id,
      relatedItem: availableItem._id,
      reason: 'معلومات مضللة',
      details: 'بلاغ تجريبي لفحص دورة المراجعة الإدارية.',
      status: 'pending',
    }, session);

    await createOne(AdminLog, {
      adminId: admin._id,
      action: 'HUB_MANAGE',
      targetId: hubAmman._id,
      targetModel: 'SafeHub',
      targetName: hubAmman.name,
      adminNote: 'إنشاء بيانات التطوير التجريبية.',
    }, session);

    await createOne(Notification, {
      user: donor._id,
      type: 'request_new_offer',
      title: 'طلب تبرع تجريبي جديد',
      body: 'يوجد طلب تجريبي متوافق مع أحد التصنيفات.',
      actionUrl: '/donation-requests',
    }, session);

    await session.commitTransaction();
    console.log('🎉 اكتمل إنشاء بيانات التطوير بأمان.');
  } catch (error) {
    if (session?.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await session?.endSession();
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
};

if (require.main === module) {
  seedDatabase().catch((error) => {
    console.error('❌ فشل seed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { assertSafeSeedEnvironment, getSeedConfig, seedDatabase };
