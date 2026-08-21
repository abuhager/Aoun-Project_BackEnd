const mongoose                = require('mongoose');
const hubRepository           = require('../repositories/hubRepository');
const itemRepository          = require('../repositories/itemRepository');
const donationOfferRepository = require('../repositories/donationOfferRepository');
const adminRepository         = require('../repositories/adminRepository');
const hubDto                  = require('../dtos/hubDto');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const invalidIdResponse = () => ({
  statusCode: 400,
  body: { msg: 'معرّف المركز غير صحيح', code: 'INVALID_HUB_ID' },
});

const logHubAction = (adminId, hub, operation, reason, changedFields = []) =>
  adminRepository.logAdminAction({
    adminId,
    action: 'HUB_MANAGE',
    targetId: hub._id,
    targetModel: 'SafeHub',
    targetName: hub.name,
    reason,
    meta: {
      targetName: hub.name,
      operation,
      changedFields,
    },
  });

// Public: المراكز النشطة فقط، بما فيها السجلات القديمة غير المعطلة صراحةً.
exports.getAllHubs = async () => {
  const hubs = await hubRepository.findAllActive();
  return { statusCode: 200, body: hubs.map(hubDto.toPublicHub) };
};

// Admin: كل المراكز (نشطة + معطلة).
exports.getAllHubsAdmin = async () => {
  const hubs = await hubRepository.findAll();
  return { statusCode: 200, body: hubs.map(hubDto.toAdminHub) };
};

exports.createHub = async (body, adminId) => {
  const hub = await hubRepository.create({ ...body, createdBy: adminId });

  await logHubAction(
    adminId,
    hub,
    'create',
    'إنشاء مركز تسليم جديد',
    Object.keys(body)
  );

  return { statusCode: 201, body: hubDto.toAdminHub(hub) };
};

exports.updateHub = async (hubId, rawBody, adminId) => {
  if (!isValidId(hubId)) return invalidIdResponse();

  const hub = await hubRepository.updateById(hubId, rawBody);

  if (hub === null) {
    const exists = await hubRepository.findById(hubId);
    if (!exists) {
      return {
        statusCode: 404,
        body: { msg: 'المركز غير موجود', code: 'HUB_NOT_FOUND' },
      };
    }
    return {
      statusCode: 400,
      body: { msg: 'لم يتم تحديد أي حقل للتعديل', code: 'NO_HUB_FIELDS' },
    };
  }

  await logHubAction(
    adminId,
    hub,
    'update',
    'تعديل بيانات مركز التسليم',
    Object.keys(rawBody).filter((field) => hubDto.ALLOWED_UPDATE_FIELDS.includes(field))
  );

  return { statusCode: 200, body: hubDto.toAdminHub(hub) };
};

exports.deactivateHub = async (hubId, adminId) => {
  if (!isValidId(hubId)) return invalidIdResponse();

  const existingHub = await hubRepository.findById(hubId);
  if (!existingHub) {
    return {
      statusCode: 404,
      body: { msg: 'المركز غير موجود', code: 'HUB_NOT_FOUND' },
    };
  }

  // العملية idempotent: تكرار الطلب لا ينشئ سجلاً إدارياً وهمياً.
  if (existingHub.isActive === false) {
    return {
      statusCode: 200,
      body: { msg: 'المركز معطّل مسبقاً', hub: hubDto.toAdminHub(existingHub) },
    };
  }

  const [activeItems, pendingOffers] = await Promise.all([
    itemRepository.countActiveByHub(hubId),
    donationOfferRepository.countPendingByHub(hubId),
  ]);

  if (activeItems > 0 || pendingOffers > 0) {
    const blockers = [];
    if (activeItems > 0) blockers.push(`${activeItems} غرض نشط`);
    if (pendingOffers > 0) blockers.push(`${pendingOffers} عرض تبرع معلّق`);

    return {
      statusCode: 409,
      body: {
        msg: `لا يمكن تعطيل المركز — يوجد ${blockers.join(' و')} مرتبط به. أعد تعيينها أو عالجها أولاً.`,
        code: 'HUB_HAS_ACTIVE_HANDOFFS',
        details: { activeItems, pendingOffers },
      },
    };
  }

  const hub = await hubRepository.deactivateById(hubId);
  if (!hub) {
    return {
      statusCode: 404,
      body: { msg: 'المركز غير موجود', code: 'HUB_NOT_FOUND' },
    };
  }

  await logHubAction(adminId, hub, 'deactivate', 'تعطيل مركز التسليم');

  return {
    statusCode: 200,
    body: { msg: 'تم تعطيل المركز ✅', hub: hubDto.toAdminHub(hub) },
  };
};

exports.reactivateHub = async (hubId, adminId) => {
  if (!isValidId(hubId)) return invalidIdResponse();

  const existingHub = await hubRepository.findById(hubId);
  if (!existingHub) {
    return {
      statusCode: 404,
      body: { msg: 'المركز غير موجود', code: 'HUB_NOT_FOUND' },
    };
  }

  if (existingHub.isActive !== false) {
    return {
      statusCode: 200,
      body: { msg: 'المركز مفعّل مسبقاً', hub: hubDto.toAdminHub(existingHub) },
    };
  }

  const hub = await hubRepository.reactivateById(hubId);
  if (!hub) {
    return {
      statusCode: 404,
      body: { msg: 'المركز غير موجود', code: 'HUB_NOT_FOUND' },
    };
  }

  await logHubAction(adminId, hub, 'reactivate', 'إعادة تفعيل مركز التسليم');

  return {
    statusCode: 200,
    body: { msg: 'تم تفعيل المركز ✅', hub: hubDto.toAdminHub(hub) },
  };
};
