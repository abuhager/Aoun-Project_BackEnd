// models/SystemSettings.js
// ✅ Singleton — سجل واحد فقط في DB (id: 'global')
// يُستبدَل به كل قيمة hardcoded في المشروع

const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'global' },

    // ── حصص المستخدمين ───────────────────────────────────────
    defaultQuota:         { type: Number, default: 2,  min: 0, max: 20 },
    level2Quota:          { type: Number, default: 4,  min: 0, max: 20 },
    level3Quota:          { type: Number, default: 6,  min: 0, max: 20 },
    maxBookingsPerUser:   { type: Number, default: 3,  min: 1, max: 10 },

    // ── طلبات التبرع ─────────────────────────────────────────
    maxActiveRequestsPerMonth: { type: Number, default: 1, min: 1, max: 5 },
    requestExpiryDays:         { type: Number, default: 30, min: 1, max: 180 },

    // ── التصنيفات (ديناميكية بالكامل) ────────────────────────
    categories: {
      type:    [String],
      default: ['كتب', 'إلكترونيات', 'أثاث', 'ملابس', 'أخرى'],
      validate: {
        validator: (v) => v.length >= 1 && v.length <= 30,
        message:   'يجب أن يكون هناك تصنيف واحد على الأقل',
      },
    },

    // ── أسباب البلاغات (ديناميكية) ───────────────────────────
    reportReasons: {
      type:    [String],
      default: ['لم يُسلّم الغرض', 'معلومات مضللة', 'سلوك غير لائق', 'غرض مختلف عن الوصف', 'أخرى'],
    },

    // ── حد البلاغات للحظر التلقائي ────────────────────────────
    autoReportBanThreshold: { type: Number, default: 5, min: 1, max: 20 },

    // ── الكوتا الشهرية (cron reset) ──────────────────────────
    quotaResetDayOfMonth: { type: Number, default: 1, min: 1, max: 28 },

    // ── نطاقات الجامعات (ديناميكية) ──────────────────────────
    universityEmailDomains: {
      type:    [String],
      default: [
        '@student.ju.edu.jo',   '@ju.edu.jo',
        '@stu.yarmouk.edu.jo',  '@yarmouk.edu.jo',
        '@students.mut.edu.jo', '@mut.edu.jo',
        '@stu.hu.edu.jo',       '@hu.edu.jo',
        '@student.bau.edu.jo',  '@bau.edu.jo',
        '@stu.just.edu.jo',     '@just.edu.jo',
        '@student.meu.edu.jo',  '@meu.edu.jo',
        '@student.philadelphia.edu.jo',
        '@psut.edu.jo', '@gju.edu.jo',
      ],
    },

    // ── Safe Hubs إعدادات ─────────────────────────────────────
    requireHubForBooking: { type: Boolean, default: false },

    // ── الحالة العامة ─────────────────────────────────────────
    maintenanceMode: { type: Boolean, default: false },
    platformName:    { type: String,  default: 'عون' },
    contactEmail:    { type: String,  default: 'support@aoun.jo' },
  },
  { timestamps: true }
);

// ── getInstance: Singleton جاهز للاستخدام ────────────────────
systemSettingsSchema.statics.getInstance = async function () {
  let settings = await this.findById('global').lean();
  if (!settings) {
    const doc = await this.create({ _id: 'global' });
    settings = doc.toObject();
  }
  return settings;
};

// ── getCached: نسخة مع Simple Cache (TTL: 60s) ───────────────
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 60_000; // 60 ثانية

systemSettingsSchema.statics.getCached = async function () {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  _cache  = await this.getInstance();
  _cacheAt = Date.now();
  return _cache;
};

// ── invalidateCache: بعد كل تعديل ────────────────────────────
systemSettingsSchema.statics.invalidateCache = function () {
  _cache   = null;
  _cacheAt = 0;
};

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);
