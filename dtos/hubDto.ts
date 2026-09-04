import { toPlainRecord } from './dtoTypes';

/** ما يُرجع للمستخدمين العاديين */
exports.toPublicHub = (rawHub: unknown) => {
  const hub = toPlainRecord(rawHub);
  if (!hub) return null;

  return ({
  _id:          hub._id,
  name:         hub.name,
  address:      hub.address,
  city:         hub.city,
  coordinates:  hub.coordinates,
  workingHours: hub.workingHours || '9:00 ص — 5:00 م',
  // المراكز القديمة التي سبقت إضافة الحقل تُعامل كنشطة ما لم تُعطّل صراحةً.
  isActive:     hub.isActive !== false,
  });
};

/** ما يُرجع للأدمن (يشمل createdBy + timestamps) */
exports.toAdminHub = (rawHub: unknown) => {
  const hub = toPlainRecord(rawHub);
  if (!hub) return null;

  return ({
    ...exports.toPublicHub(hub),
    createdBy: hub.createdBy,
    createdAt: hub.createdAt,
    updatedAt: hub.updatedAt,
  });
};

/** الحقول المسموح بتعديلها فقط */
const ALLOWED_UPDATE_FIELDS: readonly string[] = [
  // تغيير الحالة له مساران مستقلان حتى لا يمكن تجاوز فحص الارتباطات النشطة.
  'name', 'address', 'city', 'coordinates', 'workingHours',
];

exports.ALLOWED_UPDATE_FIELDS = ALLOWED_UPDATE_FIELDS;
