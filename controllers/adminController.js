const adminService = require("../services/adminService");
const { validatePromote } = require("../dtos/adminDto");

// ─── Users ────────────────────────────────────────────────────
exports.promoteUser = async (req, res) => {
  const { error } = validatePromote(req.body);
  if (error) return res.status(400).json({ msg: error.details[0].message });

  try {
    const user = await adminService.promoteToLevel2(
      req.params.id,
      req.user.id,
      req.body.reason,
      req.body.adminNote
    );
    return res.status(200).json({ msg: `تمت ترقية ${user.name} ✅`, user });
  } catch (err) {
    return res.status(err.status ?? 500).json({ msg: err.message });
  }
};

exports.demoteUser = async (req, res) => {
  const { error } = validatePromote(req.body);
  if (error) return res.status(400).json({ msg: error.details[0].message });

  try {
    const user = await adminService.demoteToLevel1(
      req.params.id,
      req.user.id,
      req.body.reason,
      req.body.adminNote
    );
    return res.status(200).json({ msg: `تم خفض ${user.name}`, user });
  } catch (err) {
    return res.status(err.status ?? 500).json({ msg: err.message });
  }
};

exports.listUsers = async (req, res) => {
  try {
    const result = await adminService.listUsers(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

exports.banUser = async (req, res) => {
  try {
    const user = await adminService.banUser(
      req.params.id,
      req.user.id,
      req.body.reason,
      req.body.adminNote
    );
    res.json({ msg: `تم حظر ${user.name}`, user });
  } catch (err) {
    res.status(err.status ?? 500).json({ msg: err.message });
  }
};

exports.unbanUser = async (req, res) => {
  try {
    const user = await adminService.unbanUser(
      req.params.id,
      req.user.id,
      req.body.adminNote
    );
    res.json({ msg: `تم رفع الحظر عن ${user.name}`, user });
  } catch (err) {
    res.status(err.status ?? 500).json({ msg: err.message });
  }
};

// ─── Items ────────────────────────────────────────────────────
exports.listItems = async (req, res) => {
  try {
    const result = await adminService.listItems(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    if (!req.body.adminNote || !req.body.adminNote.trim()) {
      return res.status(400).json({ msg: "تعليق الحذف مطلوب" });
    }

    await adminService.deleteItem(
      req.params.id,
      req.user.id,
      req.body.adminNote.trim()
    );

    res.json({ msg: "تم حذف الغرض ✅" });
  } catch (err) {
    res.status(err.status ?? 500).json({ msg: err.message });
  }
};

// ─── Reports ──────────────────────────────────────────────────
exports.listReports = async (req, res) => {
  try {
    const result = await adminService.listReports(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

exports.resolveReport = async (req, res) => {
  try {
    const report = await adminService.resolveReport(
      req.params.id,
      req.user.id,
      req.body.action,
      req.user.name,
      req.body.adminNote
    );

    res.json({ msg: 'تم معالجة البلاغ ✅', report });
  } catch (err) {
    res.status(err.status ?? 500).json({ msg: err.message });
  }
};

// ─── Audit Log ────────────────────────────────────────────────
exports.listAuditLogs = async (req, res) => {
  try {
    const result = await adminService.listAuditLogs(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// ─── Stats ────────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const stats = await adminService.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};