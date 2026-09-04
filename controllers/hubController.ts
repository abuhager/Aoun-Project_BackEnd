// controllers/hubController.js
// ✅ FIX [HUB-03]: إضافة reactivateHub handler الذي كان مفقوداً

const hubService   = require('../services/hubService');
import asyncHandler = require('../utils/asyncHandler');

// ── Public: المراكز النشطة فقط ─────────────────────────────
exports.getHubs = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.getAllHubs();
  res.status(statusCode).json(body);
});

// ── Admin: كل المراكز بكل الحالات ──────────────────────────
exports.getAllAdmin = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.getAllHubsAdmin();
  res.status(statusCode).json(body);
});

// ── إنشاء مركز جديد ────────────────────────────────────────
exports.createHub = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.createHub(req.body, req.user.id);
  res.status(statusCode).json(body);
});

// ── تحديث مركز ─────────────────────────────────────────────
exports.updateHub = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.updateHub(req.params.id, req.body, req.user.id);
  res.status(statusCode).json(body);
});

// ── تعطيل مركز (Soft Delete) ───────────────────────────────
exports.deactivateHub = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.deactivateHub(req.params.id, req.user.id);
  res.status(statusCode).json(body);
});

// ── ✅ FIX [HUB-03]: تفعيل مركز مُعطَّل — كان مفقوداً تماماً
exports.reactivateHub = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.reactivateHub(req.params.id, req.user.id);
  res.status(statusCode).json(body);
});
