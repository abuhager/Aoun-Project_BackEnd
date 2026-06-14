// dtos/hubDto.js
// ✅ FIX [HUB-08]: validateCreateHub تتحقق من address (وليس location)
//    مطابق للـ Model والـ Repository

/** ما يُرجع للمستخدمين العاديين */
exports.toPublicHub = (hub) => ({
  _id:          hub._id,
  name:         hub.name,
  address:      hub.address,
  city:         hub.city,
  coordinates:  hub.coordinates,
  workingHours: hub.workingHours,
  isActive:     hub.isActive,
});

/** ما يُرجع للأدمن (يشمل createdBy + timestamps) */
exports.toAdminHub = (hub) => ({
  ...exports.toPublicHub(hub),
  createdBy: hub.createdBy,
  createdAt: hub.createdAt,
  updatedAt: hub.updatedAt,
});

/**
 * التحقق من الحقول المطلوبة عند الإنشاء
 * ✅ FIX [HUB-08]: address (وليس location) — مطابق للـ Schema
 */
exports.validateCreateHub = ({ name, address, city }) => {
  const errors = [];
  if (!name?.trim())    errors.push('الاسم مطلوب');
  if (!address?.trim()) errors.push('العنوان مطلوب');   // ✅ كان يتحقق من address لكن schema يرسل location — تم توحيدهما
  if (!city?.trim())    errors.push('المدينة مطلوبة');
  return errors;
};

/** الحقول المسموح بتعديلها فقط */
exports.ALLOWED_UPDATE_FIELDS = [
  'name', 'address', 'city', 'coordinates', 'isActive', 'workingHours',
];