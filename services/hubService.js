// services/hubService.js — PATCHED ✅
// التغييرات: إضافة getAllHubsAdmin + validateObjectId + reactivateHub

const hubRepository = require('../repositories/hubRepository');
const hubDto        = require('../dtos/hubDto');
const mongoose      = require('mongoose');

// ── helper ──────────────────────────────────────────────────
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ── Public: المراكز النشطة فقط ──────────────────────────────
exports.getAllHubs = async () => {
  const hubs = await hubRepository.findAllActive();
  return { statusCode: 200, body: hubs.map(hubDto.toPublicHub) };
};

// ── Admin: كل المراكز (نشطة + معطّلة) ─────────────────────
exports.getAllHubsAdmin = async () => {
  const hubs = await hubRepository.findAll(); // ✅ جديد — كل الحالات
  return { statusCode: 200, body: hubs.map(hubDto.toAdminHub) };
};

// ── إنشاء مركز جديد ─────────────────────────────────────────
exports.createHub = async (body, adminId) => {
  const errors = hubDto.validateCreateHub(body);
  if (errors.length)
    return { statusCode: 400, body: { msg: errors.join(' | ') } };

  const hub = await hubRepository.create({ ...body, createdBy: adminId });
  return { statusCode: 201, body: hubDto.toAdminHub(hub) };
};

// ── تحديث مركز ──────────────────────────────────────────────
exports.updateHub = async (hubId, rawBody) => {
  if (!isValidId(hubId))
    return { statusCode: 400, body: { msg: 'معرّف المركز غير صحيح' } };

  const hub = await hubRepository.updateById(hubId, rawBody);
  if (!hub)
    return { statusCode: 404, body: { msg: 'المركز غير موجود' } };

  return { statusCode: 200, body: hubDto.toAdminHub(hub) };
};

// ── تعطيل مركز ──────────────────────────────────────────────
exports.deactivateHub = async (hubId) => {
  if (!isValidId(hubId))
    return { statusCode: 400, body: { msg: 'معرّف المركز غير صحيح' } };

  const hub = await hubRepository.deactivateById(hubId);
  if (!hub)
    return { statusCode: 404, body: { msg: 'المركز غير موجود' } };

  return { statusCode: 200, body: { msg: 'تم تعطيل المركز ✅', hub: hubDto.toAdminHub(hub) } };
};

// ── تفعيل مركز (reactivate) — مفقود في الكود الأصلي ─────────
exports.reactivateHub = async (hubId) => {
  if (!isValidId(hubId))
    return { statusCode: 400, body: { msg: 'معرّف المركز غير صحيح' } };

  const hub = await hubRepository.updateById(hubId, { isActive: true });
  if (!hub)
    return { statusCode: 404, body: { msg: 'المركز غير موجود' } };

  return { statusCode: 200, body: { msg: 'تم تفعيل المركز ✅', hub: hubDto.toAdminHub(hub) } };
};
