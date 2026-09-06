import mongoose from 'mongoose';
import hubRepository from '../repositories/hubRepository.js';
import itemRepository from '../repositories/itemRepository.js';
import donationOfferRepository from '../repositories/donationOfferRepository.js';
import adminRepository from '../repositories/adminRepository.js';
import hubDto from '../dtos/hubDto.js';
import type { EntityId, ServicePayload } from './serviceTypes.js';

type HubActionTarget = {
  _id: EntityId;
  name: string;
};

const isValidId = (id: EntityId) => mongoose.Types.ObjectId.isValid(id);

const invalidIdResponse = () => ({
  statusCode: 400,
  body: { msg: 'معرّف المركز غير صحيح', code: 'INVALID_HUB_ID' },
});

const logHubAction = (
  adminId: EntityId,
  hub: HubActionTarget,
  operation: string,
  reason: string,
  changedFields: string[] = []
) =>
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

export const getAllHubs = async () => {
  const hubs = await hubRepository.findAllActive();
  return { statusCode: 200, body: hubs.map(hubDto.toPublicHub) };
};

export const getAllHubsAdmin = async () => {
  const hubs = await hubRepository.findAll();
  return { statusCode: 200, body: hubs.map(hubDto.toAdminHub) };
};

export const createHub = async (body: ServicePayload, adminId: EntityId) => {
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

export const updateHub = async (
  hubId: EntityId,
  rawBody: ServicePayload,
  adminId: EntityId
) => {
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

export const deactivateHub = async (hubId: EntityId, adminId: EntityId) => {
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
    const blockers: string[] = [];
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

export const reactivateHub = async (hubId: EntityId, adminId: EntityId) => {
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

export default { getAllHubs, getAllHubsAdmin, createHub, updateHub, deactivateHub, reactivateHub };
