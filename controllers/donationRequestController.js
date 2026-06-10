// controllers/donationRequestController.js
const drService    = require('../services/donationRequestService');
const asyncHandler = require('../utils/asyncHandler');

exports.getRequests = asyncHandler(async (req, res) => {
  const result = await drService.getDonationRequestsLogic(req.query, req.user.id);
  res.json(result);
});

exports.getMyRequests = asyncHandler(async (req, res) => {
  const result = await drService.getMyRequestsLogic(req.user.id);
  res.json(result);
});

exports.createRequest = asyncHandler(async (req, res) => {
  const result = await drService.createRequestLogic(req.body, req.user.id);
  res.status(201).json(result);
});

exports.cancelRequest = asyncHandler(async (req, res) => {
  const result = await drService.cancelRequestLogic(req.params.id, req.user.id);
  res.json(result);
});

// ✅ إصلاح: drService بدل donationRequestService + asyncHandler
exports.respondToRequest = asyncHandler(async (req, res) => {
  const result = await drService.respondToRequestLogic(
    req.params.id,
    req.user.id,
    req.body,
    req.file ?? null
  );
  res.status(201).json(result);
});