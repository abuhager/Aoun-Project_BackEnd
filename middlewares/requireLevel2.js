// middlewares/requireLevel2.js
// Phase 2 — يمنع Level 1 من الحجز

module.exports = (req, res, next) => {
  const user = req.user;

  if (!user) {
    return res.status(401).json({ msg: 'يجب تسجيل الدخول أولاً' });
  }

  const level = user.trustLevel ?? 1;

  if (level < 2) {
    return res.status(403).json({
      msg:  'يجب التحقق من هويتك أولاً للقيام بهذا الإجراء 🔒',
      code: 'LEVEL_2_REQUIRED',
    });
  }

  next();
};