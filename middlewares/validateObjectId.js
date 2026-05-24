// middlewares/validateObjectId.js — ✅ FIXED: double validation
const mongoose = require('mongoose');

module.exports = function validateObjectId(paramName = 'id') {
  return function (req, res, next) {
    const value = req.params[paramName];

    // ✅ التحقق المزدوج: يمنع strings زي "000000000000"
    const isValid =
      mongoose.Types.ObjectId.isValid(value) &&
      new mongoose.Types.ObjectId(value).toString() === value;

    if (!isValid) {
      return res.status(400).json({ msg: 'المعرّف غير صالح' });
    }

    next();
  };
};