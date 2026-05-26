// services/adminService.js
const userRepository = require('../repositories/userRepository');
const AdminLog       = require('../models/AdminLog');

exports.promoteToLevel2 = async (targetId, adminId, reason = null) => {
  const user = await userRepository.findByIdForAdmin(targetId);

  if (!user)              throw Object.assign(new Error('المستخدم غير موجود'),              { status: 404, code: 'USER_NOT_FOUND'  });
  if (user.isBanned)      throw Object.assign(new Error('لا يمكن ترقية مستخدم محظور'),      { status: 403, code: 'USER_BANNED'     });
  if (user.trustLevel>=2) throw Object.assign(new Error('المستخدم في المستوى 2 بالفعل ✅'), { status: 400, code: 'ALREADY_LEVEL2'  });

  const updated = await userRepository.setTrustLevel(targetId, 2);

  // ✅ سجّل العملية — يُستخدم في Phase 6
  await AdminLog.create({ adminId, targetId, action: 'PROMOTE', reason });

  return updated;
};

exports.demoteToLevel1 = async (targetId, adminId, reason = null) => {
  const user = await userRepository.findByIdForAdmin(targetId);

  if (!user) throw Object.assign(new Error('المستخدم غير موجود'), { status: 404, code: 'USER_NOT_FOUND' });

  if (user.isVerifiedStudent || user.phoneVerified) {
    throw Object.assign(
      new Error('لا يمكن خفض مستخدم وصل Level 2 تلقائياً'),
      { status: 403, code: 'AUTO_VERIFIED_PROTECTED' }
    );
  }

  if (user.trustLevel < 2) throw Object.assign(new Error('المستخدم في المستوى 1 بالفعل'), { status: 400, code: 'ALREADY_LEVEL1' });

  const updated = await userRepository.setTrustLevel(targetId, 1);

  await AdminLog.create({ adminId, targetId, action: 'DEMOTE', reason });

  return updated;
};