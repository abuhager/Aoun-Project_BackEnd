// models/SystemSettings.js
const mongoose      = require('mongoose');
const EventEmitter  = require('events');

// ─── DC-04: EventEmitter مركزي لإخطار باقي النظام بتغيير الإعدادات ───────
const settingsEvents = new EventEmitter();

const systemSettingsSchema = new mongoose.Schema(
  {
    _id:                           { type: String,   default: 'global' },
    defaultQuota:                  { type: Number,   default: 2,   min: 0,  max: 20 },
    level2Quota:                   { type: Number,   default: 4,   min: 0,  max: 20 },
    maxBookingsPerUser:            { type: Number,   default: 3,   min: 1,  max: 10 },
    maxActiveRequestsPerMonth:     { type: Number,   default: 1,   min: 1,  max: 5  },
    requestExpiryDays:             { type: Number,   default: 30,  min: 1,  max: 180 },
    donorQuotaReward:              { type: Number,   default: 1,   min: 0,  max: 5  },
    trustScorePerDonation:         { type: Number,   default: 5,   min: 0,  max: 20 },
    trustScorePerRequest:          { type: Number,   default: 2,   min: 0,  max: 10 },
    bookingExpiryHours:            { type: Number,   default: 72,  min: 1,  max: 336 },
    maxActiveDonationsPerUser:     { type: Number,   default: 2,   min: 1,  max: 20 },
    maxActiveDonationsLevel2Plus:  { type: Number,   default: 4,   min: 1,  max: 20 },
    categories: {
      type: [String],
      default: ['كتب', 'إلكترونيات', 'أثاث', 'ملابس', 'أخرى'],
      validate: {
        validator: (v) => v.length >= 1 && v.length <= 30,
        message: 'يجب أن يكون هناك تصنيف واحد على الأقل',
      },
    },
    reportReasons: {
      type: [String],
      default: [
        'لم يُسلّم الغرض',
        'معلومات مضللة',
        'سلوك غير لائق',
        'غرض مختلف عن الوصف',
        'أخرى',
      ],
    },
    autoReportBanThreshold:   { type: Number,  default: 5,               min: 1,  max: 20 },
    quotaResetDayOfMonth:     { type: Number,  default: 1,               min: 1,  max: 28 },
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
        '@student.philadelphia.edu.jo',
        '@psut.edu.jo',         '@gju.edu.jo',
      ],
    },
    requireHubForBooking: { type: Boolean, default: false },
    maintenanceMode:      { type: Boolean, default: false },
    platformName:         { type: String,  default: 'عون' },
    contactEmail:         { type: String,  default: 'support@aoun.jo' },
  },
  { timestamps: true }
);

// ─── getInstance ──────────────────────────────────────────────────────────────
// DC-03 FIX: استخدام lean() في كلا المسارين لإرجاع plain object نظيف
systemSettingsSchema.statics.getInstance = async function () {
  let settings = await this.findById('global').lean();

  if (!settings) {
    // DC-03 FIX: بدل doc.toObject() — نُنشئ ثم نجلب بـ lean() مباشرةً
    await this.create({ _id: 'global' });
    settings = await this.findById('global').lean();
  }

  return settings;
};

// ─── In-Memory Cache ──────────────────────────────────────────────────────────
// DC-02 NOTE: هذا الـ cache يعمل بشكل صحيح في بيئة single-process (Render, Vercel, PM2 fork)
// في بيئة PM2 cluster مع عدة workers: TTL القصير (5 ثانية) يُقلّل stale window
// الحل الدائم لـ cluster هو استبدال _cache بـ Redis — انظر TODO أدناه
const IS_CLUSTER = parseInt(process.env.WEB_CONCURRENCY ?? '1', 10) > 1;
const CACHE_TTL  = IS_CLUSTER ? 5_000 : 60_000; // DC-02 FIX: TTL قصير في cluster

let _cache   = null;
let _cacheAt = 0;

systemSettingsSchema.statics.getCached = async function () {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  _cache   = await this.getInstance();
  _cacheAt = Date.now();
  return _cache;
};

// DC-02 + DC-04 FIX: invalidateCache تُطلق حدث 'invalidated' ليستمع إليه
// أي كود في النظام يحتاج يعيد تحميل الإعدادات
systemSettingsSchema.statics.invalidateCache = function () {
  _cache   = null;
  _cacheAt = 0;
  // DC-04: إخطار باقي النظام بأن الإعدادات تغيّرت
  settingsEvents.emit('invalidated');
};

// TODO [DC-02 FINAL]: لحل cluster بشكل نهائي، استبدل _cache بـ:
// const redis = require('../config/redis');
// getCached  → redis.get('sys:settings') مع JSON.parse
// invalidate → redis.del('sys:settings') + redis.publish('settings:invalidated', '1')
// كل worker يستمع: redis.subscribe('settings:invalidated', () => { _localCache = null })

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);

// DC-04: export الـ EventEmitter مع الـ Model
module.exports              = SystemSettings;
module.exports.settingsEvents = settingsEvents;