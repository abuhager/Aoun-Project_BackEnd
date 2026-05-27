// services/hubService.js
// Business logic للـ SafeHub — Controller لا يلمس الـ Model مباشرة
const hubRepository = require('../repositories/hubRepository');

exports.getAllHubs = async () => {
  const hubs = await hubRepository.findAllActive();
  return { statusCode: 200, body: hubs };
};

exports.createHub = async ({ name, address, city, coordinates, workingHours }, adminId) => {
  if (!name || !address || !city) {
    return { statusCode: 400, body: { msg: 'الاسم والعنوان والمدينة مطلوبة' } };
  }
  const hub = await hubRepository.create({
    name, address, city, coordinates, workingHours, createdBy: adminId,
  });
  return { statusCode: 201, body: hub };
};

exports.updateHub = async (hubId, rawBody) => {
  const hub = await hubRepository.updateById(hubId, rawBody);
  if (!hub) return { statusCode: 404, body: { msg: 'المركز غير موجود' } };
  return { statusCode: 200, body: hub };
};

exports.deactivateHub = async (hubId) => {
  const hub = await hubRepository.deactivateById(hubId);
  if (!hub) return { statusCode: 404, body: { msg: 'المركز غير موجود' } };
  return { statusCode: 200, body: { msg: 'تم تعطيل المركز ✅' } };
};