import mongoose from 'mongoose';
import EventEmitter from 'events';

const settingsEvents = new EventEmitter();

const normalizeStringList = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => String(value).trim())
    .filter(Boolean);
  return [...new Map(normalized.map((value) => [value.toLocaleLowerCase('en'), value])).values()];
};

const normalizeDomainList = (values: unknown): string[] => (
  normalizeStringList(values).map((value) => value.toLowerCase())
);

const systemSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'global' },

    // ─── حصص المستخدمين ──────────────────────────────────────────────────
    defaultUserQuota:         { type: Number, default: 2, min: 1, max: 20 },
    studentQuota:             { type: Number, default: 5, min: 1, max: 20 },
    studentDefaultTrustLevel: { type: Number, default: 2, min: 1, max: 2  },
    level2Quota:              { type: Number, default: 4, min: 1, max: 20 },

    // ─── حدود الحجز والتبرع ──────────────────────────────────────────────
    maxBookingsPerUser:           { type: Number, default: 3,  min: 1, max: 10  },
    maxActiveRequestsPerMonth:    { type: Number, default: 1,  min: 1, max: 5   },
    maxActiveDonationsPerUser:    { type: Number, default: 2,  min: 1, max: 20  },
    maxActiveDonationsLevel2Plus: { type: Number, default: 4,  min: 1, max: 20  },
    maxWaitlistPerItem:            { type: Number, default: 10, min: 1, max: 50  },
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
      set: normalizeStringList,
      validate: {
        validator: (values: string[]) => (
          values.length >= 1
          && values.length <= 30
          && values.every((value: string) => value.length >= 2 && value.length <= 50)
        ),
        message:   'يجب أن يكون هناك تصنيف واحد على الأقل',
      },
    },
    locations: {
      type: [String],
      default: ['عمان', 'الزرقاء', 'إربد', 'العقبة', 'السلط', 'مادبا'],
      set: normalizeStringList,
      validate: {
        validator: (values: string[]) => (
          values.length >= 1
          && values.length <= 30
          && values.every((value: string) => value.length >= 2 && value.length <= 60)
        ),
        message: 'يجب أن تكون هناك منطقة واحدة على الأقل',
      },
    },
    reportReasons: {
      type: [String],
      default: [
        'لم يُسلّم الغرض', 'معلومات مضللة',
        'سلوك غير لائق', 'غرض مختلف عن الوصف', 'أخرى',
      ],
      set: normalizeStringList,
      validate: {
        validator: (values: string[]) => (
          values.length >= 1
          && values.length <= 50
          && values.every((value: string) => value.length >= 2 && value.length <= 100)
        ),
        message: 'يجب أن يكون هناك سبب بلاغ واحد على الأقل',
      },
    },

    // ─── حدود البلاغات والحظر ────────────────────────────────────────────
    autoReportBanThreshold: { type: Number, default: 5, min: 1, max: 20 },
    appealWindowHours:       { type: Number, default: 72, min: 1, max: 336 },

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
    minTrustLevelForRequests: { type: Number, default: 2, min: 1, max: 2 },
    minTrustLevelForDonating: { type: Number, default: 1, min: 1, max: 2 },
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
      set: normalizeDomainList,
      validate: {
        validator: (values: string[]) => (
          values.length <= 50
          && values.every((value: string) => /^@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+$/.test(value))
        ),
        message: 'نطاقات البريد الجامعي غير صالحة',
      },
    },

    // ─── إعدادات النظام العامة ────────────────────────────────────────────
    quotaResetDayOfMonth: { type: Number,  default: 1,                min: 1, max: 28 },
    requireHubForBooking: { type: Boolean, default: false },
    maintenanceMode:      { type: Boolean, default: false },
    platformName: {
      type: String,
      default: process.env.PLATFORM_NAME ?? 'عون',
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    contactEmail: {
      type: String,
      default: 'aoun.help.center@gmail.com',
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
  },
  { timestamps: true }
);

type CachedSettings = mongoose.InferSchemaType<typeof systemSettingsSchema>;
interface SystemSettingsModel extends mongoose.Model<CachedSettings> {
  getInstance(): Promise<CachedSettings>;
  getCached(): Promise<CachedSettings>;
  invalidateCache(changedFields?: string[]): void;
}

// ─── getInstance ─────────────────────────────────────────────────────────────
systemSettingsSchema.statics.getInstance = async function () {
  const Settings = this as unknown as SystemSettingsModel;
  let settings = await Settings.findOneAndUpdate(
    { _id: 'global' },
    { $setOnInsert: { _id: 'global' } },
    {
      returnDocument: 'after',
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    }
  ).lean();

  if (!settings) throw new Error('Unable to initialize system settings');

  const defaults = new Settings({ _id: 'global' }).toObject();
  const missingDefaults = Object.fromEntries(
    Object.entries(defaults).filter(([key]) => (
      !['_id', 'createdAt', 'updatedAt', '__v'].includes(key)
      && (settings as Record<string, unknown>)[key] === undefined
    ))
  );

  if (Object.keys(missingDefaults).length > 0) {
    const updatedSettings = await Settings.findOneAndUpdate(
      { _id: 'global' },
      { $set: missingDefaults },
      { returnDocument: 'after', runValidators: true }
    ).lean();
    if (!updatedSettings) throw new Error('Unable to apply system setting defaults');
    settings = updatedSettings;
  }

  return settings;
};

// ─── In-Memory Cache ─────────────────────────────────────────────────────────
const IS_CLUSTER = parseInt(process.env.WEB_CONCURRENCY ?? '1', 10) > 1;
const CACHE_TTL  = IS_CLUSTER ? 5_000 : 60_000;

let _cache: CachedSettings | null = null;
let _cacheAt = 0;
let _cachePromise: Promise<CachedSettings> | null = null;
let _cacheGeneration = 0;

systemSettingsSchema.statics.getCached = async function () {
  const Settings = this as unknown as SystemSettingsModel;
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  if (_cachePromise) return _cachePromise;

  const generation = _cacheGeneration;
  const pending = Settings.getInstance()
    .then((settings: CachedSettings) => {
      if (generation === _cacheGeneration) {
        _cache = settings;
        _cacheAt = Date.now();
      }
      return settings;
    })
    .finally(() => {
      if (_cachePromise === pending) _cachePromise = null;
    });

  _cachePromise = pending;
  return pending;
};

systemSettingsSchema.statics.invalidateCache = function (changedFields: string[] = []) {
  _cache   = null;
  _cacheAt = 0;
  _cacheGeneration += 1;
  _cachePromise = null;
  settingsEvents.emit('invalidated', { changedFields: [...changedFields] });
};

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema) as unknown as SystemSettingsModel;

export { settingsEvents };
export default SystemSettings;
