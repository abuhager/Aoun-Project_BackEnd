const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'global' },
    defaultQuota: { type: Number, default: 2, min: 0, max: 20 },
    level2Quota: { type: Number, default: 4, min: 0, max: 20 },
    maxBookingsPerUser: { type: Number, default: 3, min: 1, max: 10 },
    maxActiveRequestsPerMonth: { type: Number, default: 1, min: 1, max: 5 },
    requestExpiryDays: { type: Number, default: 30, min: 1, max: 180 },
    donorQuotaReward: { type: Number, default: 1, min: 0, max: 5 },
    trustScorePerDonation: { type: Number, default: 5, min: 0, max: 20 },
    trustScorePerRequest: { type: Number, default: 2, min: 0, max: 10 },
    bookingExpiryHours: { type: Number, default: 72, min: 1, max: 336 },
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
      default: ['لم يُسلّم الغرض', 'معلومات مضللة', 'سلوك غير لائق', 'غرض مختلف عن الوصف', 'أخرى'],
    },
    autoReportBanThreshold: { type: Number, default: 5, min: 1, max: 20 },
    quotaResetDayOfMonth: { type: Number, default: 1, min: 1, max: 28 },
    universityEmailDomains: {
      type: [String],
      default: [
        '@student.ju.edu.jo', '@ju.edu.jo', '@stu.yarmouk.edu.jo', '@yarmouk.edu.jo',
        '@students.mut.edu.jo', '@mut.edu.jo', '@stu.hu.edu.jo', '@hu.edu.jo',
        '@student.bau.edu.jo', '@bau.edu.jo', '@stu.just.edu.jo', '@just.edu.jo',
        '@student.meu.edu.jo', '@meu.edu.jo', '@student.philadelphia.edu.jo',
        '@psut.edu.jo', '@gju.edu.jo',
      ],
    },
    requireHubForBooking: { type: Boolean, default: false },
    maintenanceMode: { type: Boolean, default: false },
    platformName: { type: String, default: 'عون' },
    contactEmail: { type: String, default: 'support@aoun.jo' },
  },
  { timestamps: true }
);

systemSettingsSchema.statics.getInstance = async function () {
  let settings = await this.findById('global').lean();
  if (!settings) {
    const doc = await this.create({ _id: 'global' });
    settings = doc.toObject();
  }
  return settings;
};

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 60_000;

systemSettingsSchema.statics.getCached = async function () {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  _cache = await this.getInstance();
  _cacheAt = Date.now();
  return _cache;
};

systemSettingsSchema.statics.invalidateCache = function () {
  _cache = null;
  _cacheAt = 0;
};

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);
