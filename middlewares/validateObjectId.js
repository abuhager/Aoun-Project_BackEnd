// middlewares/validateObjectId.js
// ✅ يُستخدَم في جميع الـ routes التي تأخذ :id أو أي param من DB
const mongoose = require('mongoose');

/**
 * validateObjectId('id')           → يتحقق من req.params.id
 * validateObjectId('id', 'userId') → يتحقق من param متعدد
 */
const validateObjectId = (...params) =>
  (req, res, next) => {
    for (const param of params) {
      const value = req.params[param];
      if (value && !mongoose.Types.ObjectId.isValid(value)) {
        return res.status(400).json({
          msg:   `المعرّف "${param}" غير صحيح`,
          field: param,
        });
      }
    }
    next();
  };

module.exports = validateObjectId;
