// services/hubService.js — ✅ PATCHED [LOGIC-01]
// التغيير الوحيد: تعديل دالة deactivateHub + إضافة import

const hubRepository  = require('../repositories/hubRepository');
const hubDto         = require('../dtos/hubDto');
const mongoose       = require('mongoose');
// ✅ LOGIC-01: نحتاج Item للتحقق من الحجوزات النشطة
const Item           = require('../models/Item');

// ── helper ──────────────────────────────────────────────────────────────────
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ── Public: المراكز النشطة فقط ──────────────────────────────────────────────
exports.getAllHubs = async () => {
  const hubs = await hubRepository.findAllActive();
  return { statusCode: 200, body: hubs.map(hubDto.toPublicHub) };
};

// ── Admin: كل المراكز (نشطة + معطّلة) ──────────────────────────────────────
exports.getAllHubsAdmin = async () => {
  const hubs = await hubRepository.findAll();
  return { statusCode: 200, body: hubs.map(hubDto.toAdminHub) };
};

// ── إنشاء مركز جديد ──────────────────────────────────────────────────────────
exports.createHub = async (body, adminId) => {
  const errors = hubDto.validateCreateHub(body);
  if (errors.length)
    return { statusCode: 400, body: { msg: errors.join(' | ') } };

  const hub = await hubRepository.create({ ...body, createdBy: adminId });
  return { statusCode: 201, body: hubDto.toAdminHub(hub) };
};

// ── تحديث مركز ───────────────────────────────────────────────────────────────
exports.updateHub = async (hubId, rawBody) => {
  if (!isValidId(hubId))
    return { statusCode: 400, body: { msg: 'معرّف المركز غير صحيح' } };

  const hub = await hubRepository.updateById(hubId, rawBody);

  if (hub === null) {
    const exists = await hubRepository.findById(hubId);
    if (!exists)
      return { statusCode: 404, body: { msg: 'المركز غير موجود' } };
    return { statusCode: 400, body: { msg: 'لم يتم تحديد أي حقل للتعديل' } };
  }

  return { statusCode: 200, body: hubDto.toAdminHub(hub) };
};

// ── تعطيل مركز ───────────────────────────────────────────────────────────────
// ✅ FIX [LOGIC-01]: التحقق من الحجوزات النشطة قبل التعطيل
exports.deactivateHub = async (hubId) => {
  if (!isValidId(hubId))
    return { statusCode: 400, body: { msg: 'معرّف المركز غير صحيح' } };

  // ── تحقق: هل يوجد عناصر محجوزة أو متاحة مرتبطة بهذا المركز؟ ──────────────
  const activeCount = await Item.countDocuments({
    safeHub: hubId,
    status:  { $in: ['متاح', 'محجوز'] },
  });

  if (activeCount > 0) {
    return {
      statusCode: 409,
      body: {
        msg:  `لا يمكن تعطيل المركز — يوجد ${activeCount} عنصر نشط مرتبط به. أعد تعيين هذه العناصر أولاً.`,
        code: 'HUB_HAS_ACTIVE_ITEMS',
      },
    };
  }

  const hub = await hubRepository.deactivateById(hubId);
  if (!hub)
    return { statusCode: 404, body: { msg: 'المركز غير موجود' } };

  return { statusCode: 200, body: { msg: 'تم تعطيل المركز ✅', hub: hubDto.toAdminHub(hub) } };
};

// ── تفعيل مركز (reactivate) ──────────────────────────────────────────────────
exports.reactivateHub = async (hubId) => {
  if (!isValidId(hubId))
    return { statusCode: 400, body: { msg: 'معرّف المركز غير صحيح' } };

  const hub = await hubRepository.updateById(hubId, { isActive: true });
  if (!hub)
    return { statusCode: 404, body: { msg: 'المركز غير موجود' } };

  return { statusCode: 200, body: { msg: 'تم تفعيل المركز ✅', hub: hubDto.toAdminHub(hub) } };
};