// models/SystemSettings.js
const mongoose      = require('mongoose');
const EventEmitter  = require('events');

const settingsEvents = new EventEmitter();

const systemSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'global' },

    // ─── حصص المستخدمين ──────────────────────────────────────────────────
    defaultUserQuota:         { type: Number, default: 2, min: 0, max: 20 },
    studentQuota:             { type: Number, default: 5, min: 1, max: 20 },
    studentDefaultTrustLevel: { type: Number, default: 2, min: 1, max: 4  },
    level2Quota:              { type: Number, default: 4, min: 0, max: 20 },

    // ─── حدود الحجز والتبرع ──────────────────────────────────────────────
    maxBookingsPerUser:           { type: Number, default: 3,  min: 1, max: 10  },
    maxActiveRequestsPerMonth:    { type: Number, default: 1,  min: 1, max: 5   },
    maxActiveDonationsPerUser:    { type: Number, default: 2,  min: 1, max: 20  },
    maxActiveDonationsLevel2Plus: { type: Number, default: 4,  min: 1, max: 20  },
    bookingExpiryHours:           { type: Number, default: 72, min: 1, max: 336 },
    requestExpiryDays:            { type: Number, default: 30, min: 1, max: 180 },

    // ─── نقاط الثقة والمكافآت ────────────────────────────────────────────
    donorQuotaReward:      { type: Number, default: 1, min: 0, max: 5  },
    trustScorePerDonation: { type: Number, default: 5, min: 0, max: 20 },
    trustScorePerRequest:  { type: Number, default: 2, min: 0, max: 10 },

    // ✅ [HC-RATING-01]: حدود حساب trustDelta ديناميكية بدل hardcoded
    ratingThresholdExcellent: { type: Number, default: 9, min: 1, max: 10 },
    ratingThresholdGood:      { type: Number, default: 7, min: 1, max: 10 },
    ratingThresholdNeutral:   { type: Number, default: 5, min: 1, max: 10 },
    ratingThresholdBad:       { type: Number, default: 3, min: 1, max: 10 },

    // ─── التصنيفات وأسباب البلاغات ───────────────────────────────────────
    categories: {
      type: [String],
      default: ['كتب', 'إلكترونيات', 'أثاث', 'ملابس', 'أخرى'],
      validate: {
        validator: (v) => v.length >= 1 && v.length <= 30,
        message:   'يجب أن يكون هناك تصنيف واحد على الأقل',
      },
    },
    reportReasons: {
      type: [String],
      default: [
        'لم يُسلّم الغرض', 'معلومات مضللة',
        'سلوك غير لائق', 'غرض مختلف عن الوصف', 'أخرى',
      ],
    },

    // ─── حدود البلاغات والحظر ────────────────────────────────────────────
    autoReportBanThreshold: { type: Number, default: 5, min: 1, max: 20 },

    // ─── إعدادات OTP وكلمة المرور ────────────────────────────────────────
    otpExpiryMinutes:           { type: Number, default: 10, min: 1,  max: 60  },
    maxOtpAttempts:             { type: Number, default: 5,  min: 3,  max: 10  },
    resetPasswordExpiryMinutes: { type: Number, default: 15, min: 5,  max: 60  },

    // ─── إعدادات الصور الشخصية ───────────────────────────────────────────
    maxAvatarSizeMb: { type: Number, default: 5,   min: 1,   max: 20   },
    avatarWidth:     { type: Number, default: 400, min: 100, max: 1000 },
    avatarHeight:    { type: Number, default: 400, min: 100, max: 1000 },

    // ─── إعدادات Pagination ──────────────────────────────────────────────
    maxPageSize:          { type: Number, default: 20, min: 5, max: 100 },
    profilePageSize:      { type: Number, default: 10, min: 5, max: 50  },
    // ✅ [HC-ADMIN-01/02]: pagination لوحة الآدمن ديناميكي
    adminPageSize:        { type: Number, default: 20, min: 5, max: 100 },
    adminReportsPageSize: { type: Number, default: 10, min: 5, max: 50  },

    // ─── إعدادات الطلبات والعروض ──────────────────────────────────────────
    // ✅ [HC-OFFER-01]: حدود الأهلية والعروض ديناميكية
    minTrustLevelForRequests: { type: Number, default: 2, min: 1, max: 4 },
    minTrustLevelForDonating: { type: Number, default: 1, min: 1, max: 4 },
    maxPendingOffersPerDonor: { type: Number, default: 5, min: 1, max: 20 },

    // ─── إعدادات الجامعات ─────────────────────────────────────────────────
    universityEmailDomains: {
      type: [String],
      default: [
        '@student.ju.edu.jo',   '@ju.edu.jo',
        '@stu.yarmouk.edu.jo',  '@yarmouk.edu.jo',
        '@students.mut.edu.jo', '@mut.edu.jo',
        '@stu.hu.edu.jo',       '@hu.edu.jo',
        '@student.bau.edu.jo',  '@bau.edu.jo',
        '@stu.just.edu.jo',     '@just.edu.jo',
        '@student.meu.edu.jo',  '@meu.edu.jo',
        '@std-zuj.edu.jo',      '@zuj.edu.jo',
        '@student.philadelphia.edu.jo',
        '@psut.edu.jo',         '@gju.edu.jo',
      ],
    },

    // ─── إعدادات النظام العامة ────────────────────────────────────────────
    quotaResetDayOfMonth: { type: Number,  default: 1,                min: 1, max: 28 },
    requireHubForBooking: { type: Boolean, default: false },
    maintenanceMode:      { type: Boolean, default: false },
    platformName: { type: String, default: process.env.PLATFORM_NAME ?? 'عون' },
    contactEmail:         { type: String,  default: 'aoun.help.center@gmail.com' },
  },
  { timestamps: true }
);

// ─── getInstance ─────────────────────────────────────────────────────────────
systemSettingsSchema.statics.getInstance = async function () {
  let settings = await this.findById('global').lean();
  if (!settings) {
    await this.create({ _id: 'global' });
    settings = await this.findById('global').lean();
  }
  return settings;
};

// ─── In-Memory Cache ─────────────────────────────────────────────────────────
const IS_CLUSTER = parseInt(process.env.WEB_CONCURRENCY ?? '1', 10) > 1;
const CACHE_TTL  = IS_CLUSTER ? 5_000 : 60_000;

let _cache   = null;
let _cacheAt = 0;

systemSettingsSchema.statics.getCached = async function () {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  _cache   = await this.getInstance();
  _cacheAt = Date.now();
  return _cache;
};

systemSettingsSchema.statics.invalidateCache = function () {
  _cache   = null;
  _cacheAt = 0;
  settingsEvents.emit('invalidated');
};

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);

module.exports                = SystemSettings;
module.exports.settingsEvents = settingsEvents;