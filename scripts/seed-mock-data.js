require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Item = require("../models/Item");
const DonationRequest = require("../models/DonationRequest");
const DonationOffer = require("../models/DonationOffer");
const SafeHub = require("../models/SafeHub");

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!uri) {
  throw new Error("ضع MONGODB_URI أو MONGO_URI في ملف .env");
}

async function main() {
  if (process.env.ALLOW_MOCK_RESET !== "true") {
    throw new Error(
      "للحماية: أضف ALLOW_MOCK_RESET=true عند التشغيل"
    );
  }

  await mongoose.connect(uri);

  await Promise.all([
    User.deleteMany({}),
    Item.deleteMany({}),
    DonationRequest.deleteMany({}),
    DonationOffer.deleteMany({}),
    SafeHub.deleteMany({}),
  ]);

  const password = await bcrypt.hash("AounDemo2026!", 12);

  const [admin, student, donor, donor2] = await User.create([
    {
      name: "مشرف عون",
      email: "mock.admin@aoun.test",
      password,
      phone: "+962790000001",
      role: "super_admin",
      isVerified: true,
      phoneVerified: true,
      trustLevel: 2,
      quota: 2,
    },
    {
      name: "سارة الطالبة",
      email: "mock.student@aoun.test",
      password,
      phone: "+962790000002",
      role: "user",
      isVerified: true,
      phoneVerified: true,
      isVerifiedStudent: true,
      trustLevel: 2,
      quota: 2,
    },
    {
      name: "عمر المتبرع",
      email: "mock.donor@aoun.test",
      password,
      phone: "+962790000003",
      role: "user",
      isVerified: true,
      phoneVerified: true,
      trustLevel: 2,
      quota: 2,
    },
    {
      name: "ليان المتبرعة",
      email: "mock.donor2@aoun.test",
      password,
      phone: "+962790000004",
      role: "user",
      isVerified: true,
      phoneVerified: true,
      trustLevel: 2,
      quota: 2,
    },
  ]);

  const [amman, irbid] = await SafeHub.create([
    {
      name: "مركز عمان الآمن - العبدلي",
      address: "شارع الملك حسين، بجانب الهيئة المستقلة",
      city: "عمان",
      workingHours: "9:00 ص — 6:00 م",
      isActive: true,
    },
    {
      name: "مركز إربد الآمن - جامعة اليرموك",
      address: "شارع الجامعة، مجمع الرشيد",
      city: "إربد",
      workingHours: "9:00 ص — 5:00 م",
      isActive: true,
    },
  ]);

  const itemSeed = Array.from({ length: 14 }, (_, i) => ({
    title:
      i === 0
        ? "حاسوب محمول للاستخدام الجامعي"
        : i === 1
          ? "كرسي مكتب مريح"
          : `غرض تجريبي ${i + 1}`,

    description: "غرض تجريبي لاختبارات التصفح والتبرع.",

    category: i % 2 === 0 ? "كهربائيات" : "اثاث",

    location: i % 2 === 0 ? "عمان" : "إربد",

    condition:
      i % 3 === 0
        ? "مستعمل جيد"
        : "مستعمل ممتاز",

    imageUrl:
      i % 2 === 0
        ? "https://res.cloudinary.com/dlzmxuup1/image/upload/v1787393628/aoun-items/dgp4xhz6sduvoivrdp1a.png"
        : "https://res.cloudinary.com/dlzmxuup1/image/upload/v1787842031/aoun-items/f68e2v13cj6y4iccz7qs.jpg",

    // كل أغراض التصفح للمتبرع الثاني.
    // متبرع دورة QA04 يجب أن يبدأ بصفر أغراض نشطة.
    donor: donor2._id,

    safeHub: i % 2 === 0
      ? amman._id
      : irbid._id,
  }));

  const items = await Item.create(itemSeed);

  // لا ننشئ طلبًا أو عرضًا مسبقًا.
  // اختبارات QA04 تنشئ الطلب والعرض بنفسها.
  console.log(
    JSON.stringify(
      {
        users: {
          admin: admin.email,
          student: student.email,
          donor: donor.email,
          donor2: donor2.email,
        },
        password: "AounDemo2026!",
        itemIds: items.map((item) => item._id),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });