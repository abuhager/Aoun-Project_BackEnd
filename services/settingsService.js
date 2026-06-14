// services/settingsService.js

const SystemSettings              = require('../models/SystemSettings');
const { settingsEvents }          = require('../models/SystemSettings');

// ─── DC-01 FIX: اشتقاق ALLOWED_FIELDS من الـ Schema تلقائياً ──────────────────
// الطريقة القديمة كانت قائمة يدوية أفقدت maxActiveDonationsPerUser
// و maxActiveDonationsLevel2Plus — الآن لا يمكن نسيان أي حقل جديد
const EXCLUDED_FIELDS = ['_id', '__v', 'createdAt', 'updatedAt'];
const ALLOWED_FIELDS  = Object.keys(SystemSettings.schema.paths)
  .filter((field) => !EXCLUDED_FIELDS.includes(field));


// ── جلب الإعدادات الكاملة (Admin) ─────────────────────────────────────────────
exports.getSettings = async () => {
  return SystemSettings.getCached();
};


// ── تحديث الإعدادات ────────────────────────────────────────────────────────────
exports.updateSettings = async (updates) => {
  // تصفية الحقول لمنع حقن إعدادات غير مصرح بها
  const sanitized = Object.fromEntries(
    Object.entries(updates).filter(([k]) => ALLOWED_FIELDS.includes(k))
  );

  if (Object.keys(sanitized).length === 0) {
    throw Object.assign(
      new Error('لا توجد حقول صالحة للتحديث'),
      { status: 400 }
    );
  }

  const updated = await SystemSettings.findByIdAndUpdate(
    'global',
    { $set: sanitized },
    { returnDocument: 'after', upsert: true, runValidators: true }
  ).lean();

  // إبطال الـ Cache المركزي فوراً بعد كل تحديث ناجح
  // DC-04: invalidateCache تُطلق settingsEvents.emit('invalidated') داخلياً
  SystemSettings.invalidateCache();

  return updated;
};


