// controllers/adminController.js
const adminService  = require('../services/adminService');
const { validatePromote } = require('../dtos/adminDto');

exports.promoteUser = async (req, res) => {
  // ✅ DTO validation
  const { error } = validatePromote(req.body);
  if (error) return res.status(400).json({ msg: error.details[0].message, code: 'VALIDATION_ERROR' });

  try {
    const user = await adminService.promoteToLevel2(req.params.id, req.user.id, req.body.reason);
    return res.status(200).json({ msg: `تمت ترقية ${user.name} إلى المستوى 2 ✅`, user });
  } catch (err) {
    return res.status(err.status ?? 500).json({ msg: err.message, code: err.code ?? 'SERVER_ERROR' });
  }
};

exports.demoteUser = async (req, res) => {
  const { error } = validatePromote(req.body);
  if (error) return res.status(400).json({ msg: error.details[0].message, code: 'VALIDATION_ERROR' });

  try {
    const user = await adminService.demoteToLevel1(req.params.id, req.user.id, req.body.reason);
    return res.status(200).json({ msg: `تم خفض ${user.name} إلى المستوى 1`, user });
  } catch (err) {
    return res.status(err.status ?? 500).json({ msg: err.message, code: err.code ?? 'SERVER_ERROR' });
  }
};