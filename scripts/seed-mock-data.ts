if (require.main === module) require("dotenv").config();

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Item = require("../models/Item");
const DonationRequest = require("../models/DonationRequest");
const DonationOffer = require("../models/DonationOffer");
const SafeHub = require("../models/SafeHub");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const Rating = require("../models/Rating");
const Report = require("../models/Report");
const AdminLog = require("../models/AdminLog");
const SystemSettings = require("../models/SystemSettings");
const ensureIndexes = require("../utils/ensureIndexes");

const DEMO_PASSWORD = "AounDemo2026!";

const unsplashImage = (photoId: string): string =>
  `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=1200&h=800&q=82`;

// صور عامة ثابتة للعرض التجريبي؛ كل صورة تطابق الغرض المرتبط بها.
const MOCK_IMAGES = Object.freeze({
  laptop: unsplashImage("1496181133206-80ce9b88a853"),
  chair: unsplashImage("1598300042247-d088f8ab3a91"),
  calculator: unsplashImage("1587145820266-a5951ee6f620"),
  desk: unsplashImage("1518455027359-f3f8164ba6bd"),
  printer: unsplashImage("1612815154858-60aa4c59eaa6"),
  bookshelf: unsplashImage("1521587760476-6c12a4b040da"),
  router: unsplashImage("1606904825846-647eb07f5be2"),
  foldingTable: unsplashImage("1530018607912-eff2daa1bac4"),
  keyboard: unsplashImage("1587829741301-dc798b83add3"),
  backpack: unsplashImage("1553062407-98eeb64c6a62"),
  deskLamp: unsplashImage("1507473885765-e6ed057f782c"),
  programmingBooks: unsplashImage("1532012197267-da84d127e765"),
  headphones: unsplashImage("1505740420928-5e560c06d30e"),
  sofa: unsplashImage("1555041469-a586c61ea9bc"),
  monitor: unsplashImage("1527443224154-c4a3942d3acf"),
  tablet: unsplashImage("1561154464-82e9adf32764"),
  fan: unsplashImage("1618941716939-553df3c6c278"),
  libraryBooks: unsplashImage("1524995997946-a1c2e315a42f"),
  hiddenItem: unsplashImage("1600494603989-9650cf6ddd3d"),
  offeredLaptop: unsplashImage("1517336714731-489689fd1ca8"),
});

type DatasetCollectionKey =
  | "settings"
  | "users"
  | "hubs"
  | "requests"
  | "items"
  | "offers"
  | "conversations"
  | "messages"
  | "notifications"
  | "ratings"
  | "reports"
  | "adminLogs";
type SeedModel = {
  modelName: string;
  new (record: unknown): { validate: () => Promise<void> };
  createIndexes: () => Promise<unknown>;
  insertMany: (records: readonly unknown[]) => Promise<unknown>;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const MODELS: ReadonlyArray<readonly [DatasetCollectionKey, SeedModel]> = [
  ["settings", SystemSettings],
  ["users", User],
  ["hubs", SafeHub],
  ["requests", DonationRequest],
  ["items", Item],
  ["offers", DonationOffer],
  ["conversations", Conversation],
  ["messages", Message],
  ["notifications", Notification],
  ["ratings", Rating],
  ["reports", Report],
  ["adminLogs", AdminLog],
];

const createIds = (names: readonly string[]): Record<string, import('mongoose').Types.ObjectId> =>
  Object.fromEntries(
    names.map((name: string) => [name, new mongoose.Types.ObjectId()])
  );

const toId = (value: unknown): string => String(value ?? "");

const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const monthKey = (date: Date): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

function buildMockDataset(passwordHash: string, now = new Date()) {
  const userIds = createIds([
    "admin",
    "student",
    "donor",
    "donor2",
    "ahmad",
    "noor",
    "yousef",
    "maryam",
    "khaled",
    "huda",
    "rami",
    "rana",
  ]);
  const hubIds = createIds(["amman", "irbid", "zarqa"]);
  const requestIds = createIds([
    "open",
    "withOffers",
    "fulfilled",
    "expired",
    "cancelled",
  ]);
  const specialItemIds = createIds([
    "booked",
    "deliveredRated",
    "deliveredReported",
    "deliveredDismissed",
    "hidden",
    "linkedRequest",
  ]);
  const availableItemIds = Array.from(
    { length: 14 },
    () => new mongoose.Types.ObjectId()
  );
  const offerIds = createIds([
    "pending",
    "withdrawn",
    "accepted",
    "rejected",
    "expired",
    "cancelled",
  ]);
  const conversationIds = createIds(["booked", "linked", "delivered"]);
  const reportIds = createIds(["pending", "actioned", "dismissed"]);

  const settings = [{
    _id: "global",
    defaultUserQuota: 2,
    studentQuota: 5,
    studentDefaultTrustLevel: 2,
    level2Quota: 4,
    maxBookingsPerUser: 3,
    maxActiveRequestsPerMonth: 1,
    maxActiveDonationsPerUser: 2,
    maxActiveDonationsLevel2Plus: 4,
    maxWaitlistPerItem: 10,
    bookingExpiryHours: 72,
    requestExpiryDays: 30,
    donorQuotaReward: 1,
    trustScorePerDonation: 5,
    trustScorePerRequest: 2,
    categories: ["كتب", "إلكترونيات", "أثاث", "ملابس", "أخرى"],
    locations: ["عمان", "الزرقاء", "إربد", "العقبة", "السلط", "مادبا"],
    reportReasons: [
      "لم يُسلّم الغرض",
      "معلومات مضللة",
      "سلوك غير لائق",
      "غرض مختلف عن الوصف",
      "أخرى",
    ],
    minTrustLevelForRequests: 2,
    minTrustLevelForDonating: 1,
    maxPendingOffersPerDonor: 5,
    requireHubForBooking: false,
    maintenanceMode: false,
    platformName: "عون",
    contactEmail: "aoun.help.center@gmail.com",
  }];

  const commonUser = {
    password: passwordHash,
    role: "user",
    isVerified: true,
    phoneVerified: true,
    trustLevel: 2,
    quota: 4,
  };

  const users = [
    {
      _id: userIds.admin,
      name: "مشرف عون",
      email: "mock.admin@aoun.test",
      password: passwordHash,
      phone: "+962790000001",
      role: "super_admin",
      isVerified: true,
      phoneVerified: true,
      trustLevel: 2,
      trustScore: 100,
      quota: 4,
    },
    {
      ...commonUser,
      _id: userIds.student,
      name: "سارة الطالبة",
      email: "mock.student@aoun.test",
      phone: "+962790000002",
      isVerifiedStudent: true,
      quota: 5,
      trustScore: 78,
    },
    {
      ...commonUser,
      _id: userIds.donor,
      name: "عمر المتبرع",
      email: "mock.donor@aoun.test",
      phone: "+962790000003",
      trustScore: 75,
    },
    {
      ...commonUser,
      _id: userIds.donor2,
      name: "ليان المتبرعة",
      email: "mock.donor2@aoun.test",
      phone: "+962790000004",
      trustScore: 85,
      totalDonations: 1,
      badges: ["متبرع موثوق"],
    },
    {
      ...commonUser,
      _id: userIds.ahmad,
      name: "أحمد الطالب",
      email: "demo.ahmad@aoun.test",
      phone: "+962790000005",
      isVerifiedStudent: true,
      quota: 5,
      trustScore: 76,
    },
    {
      ...commonUser,
      _id: userIds.noor,
      name: "نور الطالبة",
      email: "demo.noor@aoun.test",
      phone: "+962790000006",
      isVerifiedStudent: true,
      quota: 5,
      trustScore: 80,
    },
    {
      ...commonUser,
      _id: userIds.yousef,
      name: "يوسف المستفيد",
      email: "demo.yousef@aoun.test",
      phone: "+962790000007",
      trustScore: 73,
    },
    {
      ...commonUser,
      _id: userIds.maryam,
      name: "مريم المستفيدة",
      email: "demo.maryam@aoun.test",
      phone: "+962790000008",
      trustScore: 82,
    },
    {
      ...commonUser,
      _id: userIds.khaled,
      name: "خالد الطالب",
      email: "demo.khaled@aoun.test",
      phone: "+962790000009",
      isVerifiedStudent: true,
      quota: 5,
      trustScore: 77,
    },
    {
      ...commonUser,
      _id: userIds.huda,
      name: "هدى الطالبة",
      email: "demo.huda@aoun.test",
      phone: "+962790000010",
      isVerifiedStudent: true,
      quota: 5,
      trustScore: 74,
    },
    {
      ...commonUser,
      _id: userIds.rami,
      name: "رامي المستفيد",
      email: "demo.rami@aoun.test",
      phone: "+962790000011",
      trustScore: 71,
    },
    {
      ...commonUser,
      _id: userIds.rana,
      name: "رنا المتبرعة",
      email: "demo.rana@aoun.test",
      phone: "+962790000012",
      trustScore: 88,
      totalDonations: 2,
      badges: ["متبرع نشط", "تسليم موثوق"],
    },
  ];

  const hubs = [
    {
      _id: hubIds.amman,
      name: "نقطة تسليم تجريبية — عمّان",
      address: "عنوان تجريبي للعرض فقط — يُعتمد قبل أي تجربة ميدانية",
      city: "عمان",
      workingHours: "تجريبي: 10:00 ص — 4:00 م",
      isActive: true,
      createdBy: userIds.admin,
    },
    {
      _id: hubIds.irbid,
      name: "نقطة تسليم تجريبية — إربد",
      address: "عنوان تجريبي للعرض فقط — يُعتمد قبل أي تجربة ميدانية",
      city: "إربد",
      workingHours: "تجريبي: 10:00 ص — 4:00 م",
      isActive: true,
      createdBy: userIds.admin,
    },
    {
      _id: hubIds.zarqa,
      name: "نقطة تسليم تجريبية — الزرقاء",
      address: "عنوان تجريبي للعرض فقط — يُعتمد قبل أي تجربة ميدانية",
      city: "الزرقاء",
      workingHours: "تجريبي: 11:00 ص — 5:00 م",
      isActive: true,
      createdBy: userIds.admin,
    },
  ];

  const availableCatalog = [
    ["حاسوب محمول للدراسة", "حاسوب يعمل جيدًا ومناسب للواجبات والتصفح، مع الشاحن.", "إلكترونيات", "عمان", "مستعمل جيد", MOCK_IMAGES.laptop],
    ["كرسي مكتب مريح", "كرسي ثابت ونظيف ومناسب لمكتب دراسة منزلي.", "أثاث", "إربد", "مستعمل ممتاز", MOCK_IMAGES.chair],
    ["آلة حاسبة علمية", "آلة حاسبة علمية تعمل بالكامل ومناسبة لطلاب الهندسة والعلوم.", "إلكترونيات", "عمان", "مستعمل ممتاز", MOCK_IMAGES.calculator],
    ["مكتب دراسة صغير", "مكتب بحالة جيدة يناسب الدراسة والعمل في المنزل.", "أثاث", "إربد", "مستعمل جيد", MOCK_IMAGES.desk],
    ["طابعة منزلية", "طابعة للاستخدام الدراسي، وتحتاج عبوة حبر جديدة.", "إلكترونيات", "الزرقاء", "مستعمل جيد", MOCK_IMAGES.printer],
    ["رف كتب خشبي", "رف بحالة ممتازة ومناسب لترتيب الكتب والمراجع.", "أثاث", "إربد", "مستعمل ممتاز", MOCK_IMAGES.bookshelf],
    ["جهاز راوتر منزلي", "راوتر يعمل مع محول الكهرباء ومناسب لاتصال منزلي أساسي.", "إلكترونيات", "عمان", "مستعمل ممتاز", MOCK_IMAGES.router],
    ["طاولة قابلة للطي", "طاولة خفيفة للدراسة أو الاستخدام المنزلي.", "أثاث", "الزرقاء", "مستعمل جيد", MOCK_IMAGES.foldingTable],
    ["لوحة مفاتيح سلكية", "لوحة مفاتيح عربية وإنجليزية تعمل عبر USB.", "إلكترونيات", "عمان", "مستعمل ممتاز", MOCK_IMAGES.keyboard],
    ["حقيبة مدرسية متينة", "حقيبة نظيفة متعددة الجيوب ومناسبة للاستخدام اليومي.", "ملابس", "إربد", "مستعمل ممتاز", MOCK_IMAGES.backpack],
    ["مصباح مكتب LED", "مصباح بإضاءة قابلة للتعديل مع كابل طاقة.", "إلكترونيات", "عمان", "مستعمل ممتاز", MOCK_IMAGES.deskLamp],
    ["مجموعة كتب برمجة", "كتب تأسيسية في البرمجة وقواعد البيانات بالعربية والإنجليزية.", "كتب", "إربد", "مستعمل جيد", MOCK_IMAGES.programmingBooks],
    ["سماعات رأس سلكية", "سماعات تعمل جيدًا ومناسبة للمحاضرات والاجتماعات.", "إلكترونيات", "الزرقاء", "مستعمل جيد", MOCK_IMAGES.headphones],
    ["أريكة منزلية صغيرة", "أريكة نظيفة بحالة جيدة ومناسبة لمساحة جلوس صغيرة.", "أثاث", "عمان", "مستعمل جيد", MOCK_IMAGES.sofa],
  ];

  const availableItems = availableCatalog.map(
    ([title, description, category, location, condition, imageUrl], index) => ({
      _id: availableItemIds[index],
      title,
      description,
      category,
      location,
      condition,
      imageUrl,
      donor: userIds.donor2,
      safeHub: index % 3 === 0
        ? hubIds.amman
        : index % 3 === 1
          ? hubIds.irbid
          : hubIds.zarqa,
      status: "متاح",
      cancelledBy: index === 0 ? [userIds.yousef] : [],
      createdAt: addDays(now, -(index + 1)),
      updatedAt: addDays(now, -(index + 1)),
    })
  );

  const specialItems = [
    {
      _id: specialItemIds.booked,
      title: "شاشة حاسوب محجوزة للتسليم",
      description: "شاشة بحالة ممتازة حُجزت ويجري تنسيق موعد تسليمها.",
      category: "إلكترونيات",
      location: "عمان",
      condition: "مستعمل ممتاز",
      imageUrl: MOCK_IMAGES.monitor,
      donor: userIds.donor2,
      safeHub: hubIds.amman,
      status: "محجوز",
      bookedBy: userIds.yousef,
      bookedAt: addDays(now, -1),
      waitlist: [{ user: userIds.ahmad, joinedAt: addDays(now, -0.5) }],
    },
    {
      _id: specialItemIds.deliveredRated,
      title: "جهاز لوحي تم تسليمه",
      description: "جهاز لوحي للدراسة تم تسليمه وتقييم التجربة بنجاح.",
      category: "إلكترونيات",
      location: "عمان",
      condition: "مستعمل ممتاز",
      imageUrl: MOCK_IMAGES.tablet,
      donor: userIds.donor2,
      safeHub: hubIds.amman,
      status: "تم التسليم",
      bookedBy: userIds.maryam,
      bookedAt: addDays(now, -15),
      recipientConfirmed: true,
      donorConfirmed: true,
      recipientConfirmedAt: addDays(now, -12.2),
      donorConfirmedAt: addDays(now, -12.1),
      deliveredAt: addDays(now, -12),
      isRated: true,
    },
    {
      _id: specialItemIds.deliveredReported,
      title: "مروحة منزلية تم تسليمها",
      description: "معاملة مكتملة مرتبطة ببلاغ مفتوح واعتراض قيد المراجعة.",
      category: "إلكترونيات",
      location: "إربد",
      condition: "مستعمل جيد",
      imageUrl: MOCK_IMAGES.fan,
      donor: userIds.rana,
      safeHub: hubIds.irbid,
      status: "تم التسليم",
      bookedBy: userIds.yousef,
      bookedAt: addDays(now, -11),
      recipientConfirmed: true,
      donorConfirmed: true,
      recipientConfirmedAt: addDays(now, -8.2),
      donorConfirmedAt: addDays(now, -8.1),
      deliveredAt: addDays(now, -8),
    },
    {
      _id: specialItemIds.deliveredDismissed,
      title: "مجموعة كتب تم تسليمها",
      description: "تبرع مكتمل مع بلاغ سابق راجعته الإدارة وأغلقته دون إجراء.",
      category: "كتب",
      location: "إربد",
      condition: "مستعمل جيد",
      imageUrl: MOCK_IMAGES.libraryBooks,
      donor: userIds.rana,
      safeHub: hubIds.irbid,
      status: "تم التسليم",
      bookedBy: userIds.noor,
      bookedAt: addDays(now, -23),
      recipientConfirmed: true,
      donorConfirmed: true,
      recipientConfirmedAt: addDays(now, -20.2),
      donorConfirmedAt: addDays(now, -20.1),
      deliveredAt: addDays(now, -20),
    },
    {
      _id: specialItemIds.hidden,
      title: "غرض مخفي بقرار إداري",
      description: "سجل تجريبي لاختبار ظهور العناصر المخفية داخل لوحة الإدارة فقط.",
      category: "أخرى",
      location: "الزرقاء",
      condition: "مستعمل جيد",
      imageUrl: MOCK_IMAGES.hiddenItem,
      donor: userIds.rana,
      safeHub: hubIds.zarqa,
      status: "مخفي",
      reportCount: 2,
    },
    {
      _id: specialItemIds.linkedRequest,
      title: "حاسوب مقدم استجابة لطلب",
      description: "غرض خاص ناتج عن قبول عرض على طلب احتياج ولا يظهر في التصفح العام.",
      category: "إلكترونيات",
      location: "الزرقاء",
      condition: "مستعمل ممتاز",
      imageUrl: MOCK_IMAGES.offeredLaptop,
      donor: userIds.rana,
      safeHub: hubIds.zarqa,
      status: "محجوز",
      bookedBy: userIds.khaled,
      bookedAt: addDays(now, -2),
      linkedRequestId: requestIds.fulfilled,
    },
  ];

  const items = [...availableItems, ...specialItems];
  const currentMonth = monthKey(now);
  const previousMonth = monthKey(addDays(now, -35));

  const requests = [
    {
      _id: requestIds.open,
      requester: userIds.ahmad,
      title: "كتب لمواد البرمجة الأساسية",
      category: "كتب",
      urgency: "medium",
      description: "أحتاج كتبًا تأسيسية في الخوارزميات وقواعد البيانات، ويمكن أن تكون مستعملة.",
      location: "عمان",
      status: "active",
      month: currentMonth,
      expiresAt: addDays(now, 25),
    },
    {
      _id: requestIds.withOffers,
      requester: userIds.noor,
      title: "آلة حاسبة علمية للدراسة",
      category: "إلكترونيات",
      urgency: "high",
      description: "أحتاج آلة حاسبة علمية تعمل جيدًا لاستخدامها في المساقات الجامعية.",
      location: "إربد",
      status: "active",
      month: currentMonth,
      expiresAt: addDays(now, 20),
    },
    {
      _id: requestIds.fulfilled,
      requester: userIds.khaled,
      title: "حاسوب محمول للمحاضرات",
      category: "إلكترونيات",
      urgency: "high",
      description: "طلب استُجيب له وقُبل أحد العرضين، ويجري الآن تنسيق التسليم.",
      location: "الزرقاء",
      status: "fulfilled",
      fulfilledByItem: specialItemIds.linkedRequest,
      month: currentMonth,
      expiresAt: addDays(now, 15),
    },
    {
      _id: requestIds.expired,
      requester: userIds.huda,
      title: "طاولة صغيرة للدراسة",
      category: "أثاث",
      urgency: "low",
      description: "طلب تجريبي انتهت مدته دون قبول عرض.",
      location: "عمان",
      status: "expired",
      month: previousMonth,
      expiresAt: addDays(now, -2),
    },
    {
      _id: requestIds.cancelled,
      requester: userIds.rami,
      title: "حقيبة للاستخدام الجامعي",
      category: "ملابس",
      urgency: "medium",
      description: "طلب تجريبي ألغاه صاحبه بعد وصول عرض.",
      location: "إربد",
      status: "cancelled",
      month: currentMonth,
      expiresAt: addDays(now, 10),
    },
  ];

  const offers = [
    {
      _id: offerIds.pending,
      request: requestIds.withOffers,
      donor: userIds.donor2,
      safeHub: hubIds.irbid,
      condition: "مستعمل ممتاز",
      description: "آلة حاسبة تعمل بالكامل مع الغطاء.",
      imageUrl: MOCK_IMAGES.calculator,
      status: "pending",
    },
    {
      _id: offerIds.withdrawn,
      request: requestIds.withOffers,
      donor: userIds.rana,
      safeHub: hubIds.irbid,
      condition: "مستعمل جيد",
      description: "عرض سحبته المتبرعة قبل اتخاذ قرار.",
      imageUrl: MOCK_IMAGES.calculator,
      status: "withdrawn",
    },
    {
      _id: offerIds.accepted,
      request: requestIds.fulfilled,
      donor: userIds.rana,
      safeHub: hubIds.zarqa,
      condition: "مستعمل ممتاز",
      description: "حاسوب مناسب للمحاضرات مع الشاحن، وتم قبول العرض.",
      imageUrl: MOCK_IMAGES.offeredLaptop,
      status: "accepted",
    },
    {
      _id: offerIds.rejected,
      request: requestIds.fulfilled,
      donor: userIds.donor2,
      safeHub: hubIds.amman,
      condition: "مستعمل جيد",
      description: "عرض بديل رُفض تلقائيًا بعد قبول العرض الفائز.",
      imageUrl: MOCK_IMAGES.laptop,
      status: "rejected",
    },
    {
      _id: offerIds.expired,
      request: requestIds.expired,
      donor: userIds.donor2,
      safeHub: hubIds.amman,
      condition: "مستعمل جيد",
      description: "عرض انتهى بانتهاء مدة الطلب.",
      imageUrl: MOCK_IMAGES.foldingTable,
      status: "request_expired",
    },
    {
      _id: offerIds.cancelled,
      request: requestIds.cancelled,
      donor: userIds.rana,
      safeHub: hubIds.irbid,
      condition: "جديد",
      description: "عرض أُلغي عندما ألغى صاحب الطلب طلبه.",
      imageUrl: MOCK_IMAGES.backpack,
      status: "cancelled_by_requester",
    },
  ];

  const conversations = [
    {
      _id: conversationIds.booked,
      item: specialItemIds.booked,
      owner: userIds.donor2,
      requester: userIds.yousef,
      participants: [userIds.donor2, userIds.yousef],
      lastMessage: "ممتاز، سأكون عند النقطة في الموعد.",
      lastMessageAt: addDays(now, -0.2),
    },
    {
      _id: conversationIds.linked,
      item: specialItemIds.linkedRequest,
      owner: userIds.rana,
      requester: userIds.khaled,
      participants: [userIds.rana, userIds.khaled],
      lastMessage: "تم الاتفاق، شكرًا لكِ.",
      lastMessageAt: addDays(now, -1),
    },
    {
      _id: conversationIds.delivered,
      item: specialItemIds.deliveredRated,
      owner: userIds.donor2,
      requester: userIds.maryam,
      participants: [userIds.donor2, userIds.maryam],
      lastMessage: "تم الاستلام، شكرًا جزيلًا.",
      lastMessageAt: addDays(now, -12),
    },
  ];

  const messages = [
    {
      conversation: conversationIds.booked,
      sender: userIds.donor2,
      clientMessageId: "demo-booked-1",
      text: "مرحبًا، الغرض جاهز للتسليم في نقطة عمّان.",
      read: true,
      createdAt: addDays(now, -0.8),
    },
    {
      conversation: conversationIds.booked,
      sender: userIds.yousef,
      clientMessageId: "demo-booked-2",
      text: "مناسب، هل الساعة الثانية متاحة؟",
      read: true,
      createdAt: addDays(now, -0.5),
    },
    {
      conversation: conversationIds.booked,
      sender: userIds.donor2,
      clientMessageId: "demo-booked-3",
      text: "ممتاز، سأكون عند النقطة في الموعد.",
      read: false,
      createdAt: addDays(now, -0.2),
    },
    {
      conversation: conversationIds.linked,
      sender: userIds.rana,
      clientMessageId: "demo-linked-1",
      text: "تم قبول العرض، يمكنني التسليم غدًا.",
      read: true,
      createdAt: addDays(now, -1.8),
    },
    {
      conversation: conversationIds.linked,
      sender: userIds.khaled,
      clientMessageId: "demo-linked-2",
      text: "تم الاتفاق، شكرًا لكِ.",
      read: true,
      createdAt: addDays(now, -1),
    },
    {
      conversation: conversationIds.delivered,
      sender: userIds.donor2,
      clientMessageId: "demo-delivered-1",
      text: "وصلت إلى نقطة التسليم.",
      read: true,
      createdAt: addDays(now, -12.3),
    },
    {
      conversation: conversationIds.delivered,
      sender: userIds.maryam,
      clientMessageId: "demo-delivered-2",
      text: "تم الاستلام، شكرًا جزيلًا.",
      read: true,
      createdAt: addDays(now, -12),
    },
  ];

  const ratings = [
    {
      item: specialItemIds.deliveredRated,
      rater: userIds.maryam,
      ratee: userIds.donor2,
      score: 9,
      comment: "الغرض مطابق للوصف والتسليم كان منظمًا.",
      isHandoverConfirmed: true,
      trustDelta: 5,
      createdAt: addDays(now, -11.8),
    },
  ];

  const reports = [
    {
      _id: reportIds.pending,
      reporter: userIds.yousef,
      reportedUser: userIds.rana,
      relatedItem: specialItemIds.deliveredReported,
      reason: "غرض مختلف عن الوصف",
      details: "وصل الغرض بحالة مختلفة عن الوصف المنشور، وأطلب مراجعة الحالة.",
      status: "pending",
      appealText: "أوضحت حالة الغرض أثناء المحادثة وأطلب مراجعة الرسائل.",
      appealedAt: addDays(now, -1),
      appealDeadline: addDays(now, 2),
      createdAt: addDays(now, -2),
    },
    {
      _id: reportIds.actioned,
      reporter: userIds.maryam,
      reportedUser: userIds.donor2,
      relatedItem: specialItemIds.deliveredRated,
      reason: "معلومات مضللة",
      details: "بعض التفاصيل لم تكن واضحة قبل التسليم.",
      status: "actioned",
      adminNote: "تم التواصل مع الطرفين وإرسال تحذير إداري.",
      resolvedBy: userIds.admin,
      resolvedAt: addDays(now, -5),
      appealDeadline: addDays(now, -4),
      createdAt: addDays(now, -7),
    },
    {
      _id: reportIds.dismissed,
      reporter: userIds.noor,
      reportedUser: userIds.rana,
      relatedItem: specialItemIds.deliveredDismissed,
      reason: "أخرى",
      details: "بلاغ تجريبي أغلقته الإدارة بعد التحقق.",
      status: "dismissed",
      adminNote: "لم تثبت مخالفة بعد مراجعة تفاصيل المعاملة.",
      resolvedBy: userIds.admin,
      resolvedAt: addDays(now, -16),
      appealDeadline: addDays(now, -15),
      createdAt: addDays(now, -18),
    },
  ];

  const notifications = [
    {
      user: userIds.yousef,
      type: "item_booked",
      title: "تم حجز الغرض",
      body: "تم حجز شاشة الحاسوب باسمك، نسّق موعد التسليم مع المتبرعة.",
      itemId: specialItemIds.booked,
      actionUrl: `/items/${specialItemIds.booked}`,
      isRead: true,
    },
    {
      user: userIds.yousef,
      type: "new_message",
      title: "رسالة جديدة",
      body: "لديك رسالة جديدة في محادثة التسليم.",
      itemId: specialItemIds.booked,
      conversationId: conversationIds.booked,
      actionUrl: "/dashboard",
      isRead: false,
    },
    {
      user: userIds.noor,
      type: "request_new_offer",
      title: "وصل عرض جديد",
      body: "وصل عرض جديد على طلب آلة الحاسبة العلمية.",
      actionUrl: `/donation-requests/${requestIds.withOffers}`,
      metadata: { requestId: toId(requestIds.withOffers), offerId: toId(offerIds.pending) },
      isRead: false,
    },
    {
      user: userIds.khaled,
      type: "offer_accepted",
      title: "تم قبول العرض",
      body: "تم ربط الغرض بطلبك ويمكنك الآن تنسيق التسليم.",
      itemId: specialItemIds.linkedRequest,
      actionUrl: `/items/${specialItemIds.linkedRequest}`,
      metadata: { requestId: toId(requestIds.fulfilled) },
      isRead: false,
    },
    {
      user: userIds.donor2,
      type: "offer_rejected",
      title: "تم اختيار عرض آخر",
      body: "اختار صاحب الطلب عرضًا آخر، شكرًا لمبادرتك.",
      actionUrl: `/donation-requests/${requestIds.fulfilled}`,
      metadata: { requestId: toId(requestIds.fulfilled) },
      isRead: true,
    },
    {
      user: userIds.huda,
      type: "request_expired",
      title: "انتهت مدة الطلب",
      body: "انتهت مدة طلب طاولة الدراسة دون إتمامه.",
      actionUrl: `/donation-requests/${requestIds.expired}`,
      isRead: false,
    },
    {
      user: userIds.rana,
      type: "request_cancelled_by_requester",
      title: "أُلغي طلب التبرع",
      body: "ألغى صاحب الطلب طلب الحقيبة، لذلك أُلغي عرضك.",
      actionUrl: `/donation-requests/${requestIds.cancelled}`,
      isRead: true,
    },
    {
      user: userIds.maryam,
      type: "delivery_completed",
      title: "اكتمل التسليم",
      body: "أكد الطرفان استلام الجهاز اللوحي بنجاح.",
      itemId: specialItemIds.deliveredRated,
      actionUrl: "/dashboard",
      isRead: true,
    },
    {
      user: userIds.donor2,
      type: "new_rating",
      title: "تقييم جديد",
      body: "حصلت على تقييم 9 من 10 بعد التسليم.",
      itemId: specialItemIds.deliveredRated,
      actionUrl: `/profile/${userIds.donor2}`,
      isRead: false,
    },
    {
      user: userIds.maryam,
      type: "report_resolved",
      title: "تمت معالجة البلاغ",
      body: "راجعت الإدارة بلاغك واتخذت إجراءً مناسبًا.",
      itemId: specialItemIds.deliveredRated,
      actionUrl: "/dashboard",
      metadata: { reportId: toId(reportIds.actioned), status: "actioned" },
      isRead: false,
    },
    {
      user: userIds.donor2,
      type: "admin_warning",
      title: "تحذير من الإدارة",
      body: "اتخذت الإدارة إجراءً بسبب بلاغ مرتبط بمعاملة سابقة.",
      itemId: specialItemIds.deliveredRated,
      actionUrl: "/dashboard",
      metadata: { reportId: toId(reportIds.actioned) },
      isRead: false,
    },
    {
      user: userIds.khaled,
      type: "new_message",
      title: "رسالة في محادثة الطلب",
      body: "لديك تحديث جديد حول موعد تسليم الغرض.",
      itemId: specialItemIds.linkedRequest,
      conversationId: conversationIds.linked,
      actionUrl: "/dashboard",
      isRead: true,
    },
  ];

  const adminLogs = [
    {
      adminId: userIds.admin,
      targetId: reportIds.actioned,
      targetModel: "Report",
      action: "REPORT_ACTION",
      reason: "تم الإجراء",
      targetName: "ليان المتبرعة",
      adminNote: "تم إرسال تحذير بعد مراجعة البلاغ.",
      meta: { status: "actioned", reportedBy: "مريم المستفيدة" },
      createdAt: addDays(now, -5),
    },
    {
      adminId: userIds.admin,
      targetId: reportIds.dismissed,
      targetModel: "Report",
      action: "REPORT_ACTION",
      reason: "تم الرفض",
      targetName: "رنا المتبرعة",
      adminNote: "لم تثبت مخالفة.",
      meta: { status: "dismissed", reportedBy: "نور الطالبة" },
      createdAt: addDays(now, -16),
    },
    {
      adminId: userIds.admin,
      targetId: specialItemIds.hidden,
      targetModel: "Item",
      action: "ITEM_HIDE",
      reason: "مراجعة محتوى تجريبي",
      targetName: "غرض مخفي بقرار إداري",
      createdAt: addDays(now, -3),
    },
    {
      adminId: userIds.admin,
      targetId: hubIds.zarqa,
      targetModel: "SafeHub",
      action: "HUB_MANAGE",
      reason: "إضافة نقطة تجريبية",
      targetName: "نقطة تسليم تجريبية — الزرقاء",
      createdAt: addDays(now, -10),
    },
    {
      adminId: userIds.admin,
      targetId: null,
      targetModel: null,
      action: "SETTINGS_UPDATE",
      reason: "تهيئة بيانات Demo",
      targetName: "إعدادات المنصة",
      meta: { changedFields: ["categories", "locations", "reportReasons"] },
      createdAt: addDays(now, -1),
    },
  ];

  return {
    settings,
    users,
    hubs,
    requests,
    items,
    offers,
    conversations,
    messages,
    notifications,
    ratings,
    reports,
    adminLogs,
    ids: {
      users: userIds,
      hubs: hubIds,
      requests: requestIds,
      items: { available: availableItemIds, ...specialItemIds },
    },
  };
}

type MockDataset = ReturnType<typeof buildMockDataset>;
type IntegrityItem = {
  _id: unknown;
  title: string;
  donor: unknown;
  status: string;
  bookedBy?: unknown;
  safeHub?: unknown;
  linkedRequestId?: unknown;
  waitlist?: Array<{ user?: unknown }>;
};

async function validateDataset(dataset: MockDataset): Promise<void> {
  for (const [key, Model] of MODELS) {
    for (const [index, record] of dataset[key].entries()) {
      try {
        await new Model(record).validate();
      } catch (error: unknown) {
        throw new Error(
          `Mock validation failed for ${Model.modelName}[${index}]: ${getErrorMessage(error)}`,
          { cause: error }
        );
      }
    }
  }
}

function assertDatasetIntegrity(dataset: MockDataset): void {
  const idsOf = (records: ReadonlyArray<{ _id: unknown }>): Set<string> =>
    new Set(records.map((record: { _id: unknown }) => toId(record._id)));
  const userIds = idsOf(dataset.users);
  const hubIds = idsOf(dataset.hubs);
  const requestIds = idsOf(dataset.requests);
  const itemIds = idsOf(dataset.items);
  const conversationIds = idsOf(dataset.conversations);
  const reportIds = idsOf(dataset.reports);

  const requireRef = (set: Set<string>, value: unknown, label: string): void => {
    assert.ok(set.has(toId(value)), `مرجع Mock غير موجود: ${label}`);
  };

  for (const rawItem of dataset.items) {
    const item = rawItem as IntegrityItem;
    requireRef(userIds, item.donor, `Item.donor (${item.title})`);
    if (item.bookedBy) requireRef(userIds, item.bookedBy, `Item.bookedBy (${item.title})`);
    if (item.safeHub) requireRef(hubIds, item.safeHub, `Item.safeHub (${item.title})`);
    if (item.linkedRequestId) {
      requireRef(requestIds, item.linkedRequestId, `Item.linkedRequestId (${item.title})`);
    }
    for (const entry of item.waitlist ?? []) {
      requireRef(userIds, entry.user, `Item.waitlist.user (${item.title})`);
    }
  }

  for (const request of dataset.requests) {
    requireRef(userIds, request.requester, `DonationRequest.requester (${request.title})`);
    if (request.fulfilledByItem) {
      requireRef(itemIds, request.fulfilledByItem, `DonationRequest.fulfilledByItem (${request.title})`);
      const linkedItem = dataset.items.find(
        (item) => toId(item._id) === toId(request.fulfilledByItem)
      ) as IntegrityItem | undefined;
      if (!linkedItem) throw new Error(`Linked item missing for request ${request.title}`);
      assert.equal(toId(linkedItem.linkedRequestId), toId(request._id));
    }
  }

  for (const offer of dataset.offers) {
    requireRef(requestIds, offer.request, "DonationOffer.request");
    requireRef(userIds, offer.donor, "DonationOffer.donor");
    if (offer.safeHub) requireRef(hubIds, offer.safeHub, "DonationOffer.safeHub");
  }

  for (const conversation of dataset.conversations) {
    requireRef(itemIds, conversation.item, "Conversation.item");
    requireRef(userIds, conversation.owner, "Conversation.owner");
    requireRef(userIds, conversation.requester, "Conversation.requester");
    assert.deepEqual(
      new Set(conversation.participants.map(toId)),
      new Set([toId(conversation.owner), toId(conversation.requester)])
    );
  }

  for (const message of dataset.messages) {
    requireRef(conversationIds, message.conversation, "Message.conversation");
    requireRef(userIds, message.sender, "Message.sender");
    const conversation = dataset.conversations.find(
      (entry) => toId(entry._id) === toId(message.conversation)
    );
    if (!conversation) throw new Error('Conversation missing for mock message');
    assert.ok(conversation.participants.map(toId).includes(toId(message.sender)));
  }

  for (const notification of dataset.notifications) {
    requireRef(userIds, notification.user, "Notification.user");
    if (notification.itemId) requireRef(itemIds, notification.itemId, "Notification.itemId");
    if (notification.conversationId) {
      requireRef(conversationIds, notification.conversationId, "Notification.conversationId");
    }
  }

  for (const rating of dataset.ratings) {
    requireRef(itemIds, rating.item, "Rating.item");
    requireRef(userIds, rating.rater, "Rating.rater");
    requireRef(userIds, rating.ratee, "Rating.ratee");
    const item = dataset.items.find(
      (entry) => toId(entry._id) === toId(rating.item)
    ) as IntegrityItem | undefined;
    if (!item) throw new Error('Item missing for mock rating');
    assert.equal(item.status, "تم التسليم");
    assert.equal(toId(item.bookedBy), toId(rating.rater));
    assert.equal(toId(item.donor), toId(rating.ratee));
  }

  for (const report of dataset.reports) {
    requireRef(userIds, report.reporter, "Report.reporter");
    requireRef(userIds, report.reportedUser, "Report.reportedUser");
    if (report.relatedItem) {
      requireRef(itemIds, report.relatedItem, "Report.relatedItem");
      const item = dataset.items.find(
        (entry) => toId(entry._id) === toId(report.relatedItem)
      ) as IntegrityItem | undefined;
      if (!item) throw new Error('Item missing for mock report');
      assert.equal(item.status, "تم التسليم");
      const parties = new Set([toId(item.donor), toId(item.bookedBy)]);
      assert.ok(parties.has(toId(report.reporter)));
      assert.ok(parties.has(toId(report.reportedUser)));
    }
  }

  for (const log of dataset.adminLogs) {
    requireRef(userIds, log.adminId, "AdminLog.adminId");
    if (log.targetModel === "Item") requireRef(itemIds, log.targetId, "AdminLog.Item");
    if (log.targetModel === "Report") requireRef(reportIds, log.targetId, "AdminLog.Report");
    if (log.targetModel === "SafeHub") requireRef(hubIds, log.targetId, "AdminLog.SafeHub");
  }

  const cleanStudentId = toId(dataset.ids.users.student);
  const cleanDonorId = toId(dataset.ids.users.donor);
  assert.ok(!dataset.requests.some((request) => toId(request.requester) === cleanStudentId));
  assert.ok(!dataset.items.some((item) => toId(item.donor) === cleanDonorId));
  assert.ok(!dataset.offers.some((offer) => toId(offer.donor) === cleanDonorId));

  assert.deepEqual(
    new Set(dataset.items.map((item) => item.status)),
    new Set(["متاح", "محجوز", "تم التسليم", "مخفي"])
  );
  assert.deepEqual(
    new Set(dataset.requests.map((request) => request.status)),
    new Set(["active", "fulfilled", "expired", "cancelled"])
  );
  assert.deepEqual(
    new Set(dataset.offers.map((offer) => offer.status)),
    new Set([
      "pending",
      "withdrawn",
      "accepted",
      "rejected",
      "request_expired",
      "cancelled_by_requester",
    ])
  );
}

async function recreateIndexes(): Promise<void> {
  for (const [, Model] of MODELS) {
    await Model.createIndexes();
  }
  await ensureIndexes();
}

async function insertDataset(dataset: MockDataset): Promise<void> {
  await SystemSettings.insertMany(dataset.settings);
  await User.insertMany(dataset.users);
  await SafeHub.insertMany(dataset.hubs);
  await DonationRequest.insertMany(dataset.requests);
  await Item.insertMany(dataset.items);
  await DonationOffer.insertMany(dataset.offers);
  await Conversation.insertMany(dataset.conversations);
  await Message.insertMany(dataset.messages);
  await Notification.insertMany(dataset.notifications);
  await Rating.insertMany(dataset.ratings);
  await Report.insertMany(dataset.reports);
  await AdminLog.insertMany(dataset.adminLogs);
}

function assertResetAuthorization(actualDatabaseName: string): void {
  if (process.env.ALLOW_MOCK_RESET !== "true") {
    throw new Error(
      "للحماية: أضف ALLOW_MOCK_RESET=true فقط عند تشغيل Seed على قاعدة Demo"
    );
  }

  const expectedDatabaseName = process.env.MOCK_RESET_DATABASE_NAME?.trim();
  if (!expectedDatabaseName) {
    throw new Error(
      "للحماية: ضع MOCK_RESET_DATABASE_NAME باسم قاعدة Demo حرفيًا قبل المسح"
    );
  }
  if (expectedDatabaseName !== actualDatabaseName) {
    throw new Error(
      `رفض المسح: القاعدة المتصلة هي "${actualDatabaseName}" بينما MOCK_RESET_DATABASE_NAME="${expectedDatabaseName}"`
    );
  }
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("ضع MONGODB_URI أو MONGO_URI في ملف .env");

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const dataset = buildMockDataset(passwordHash);

  // نتحقق من كل Schema وكل علاقة قبل لمس قاعدة البيانات.
  await validateDataset(dataset);
  assertDatasetIntegrity(dataset);

  await mongoose.connect(uri, { autoIndex: false });
  assertResetAuthorization(mongoose.connection.name);

  const databaseName = mongoose.connection.name;
  await mongoose.connection.dropDatabase();
  await recreateIndexes();
  await insertDataset(dataset);

  const counts = Object.fromEntries(
    MODELS.map(([key]) => [key, dataset[key].length])
  );

  console.log(
    JSON.stringify(
      {
        databaseReset: databaseName,
        users: {
          admin: "mock.admin@aoun.test",
          student: "mock.student@aoun.test",
          donor: "mock.donor@aoun.test",
          donor2: "mock.donor2@aoun.test",
        },
        password: DEMO_PASSWORD,
        counts,
        coveredScenarios: [
          "available_booked_delivered_hidden_items",
          "waitlist_and_previous_cancellation",
          "active_fulfilled_expired_cancelled_requests",
          "pending_withdrawn_accepted_rejected_expired_cancelled_offers",
          "conversations_read_and_unread_messages",
          "read_and_unread_notifications",
          "rating_after_confirmed_handover",
          "pending_appealed_actioned_dismissed_reports",
          "admin_audit_logs",
        ],
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  DEMO_PASSWORD,
  buildMockDataset,
  validateDataset,
  assertDatasetIntegrity,
  assertResetAuthorization,
};
