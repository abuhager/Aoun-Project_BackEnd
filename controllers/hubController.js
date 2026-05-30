// controllers/hubController.js
const hubService = require('../services/hubService');
const asyncHandler = require('../utils/asyncHandler');

exports.getHubs = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.getAllHubs();
  res.status(statusCode).json(body);
});

exports.getAllAdmin = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.getAllHubsAdmin();
  res.status(statusCode).json(body);
});

exports.createHub = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.createHub(req.body, req.user.id);
  res.status(statusCode).json(body);
});

exports.updateHub = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.updateHub(req.params.id, req.body);
  res.status(statusCode).json(body);
});

exports.deactivateHub = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.deactivateHub(req.params.id);
  res.status(statusCode).json(body);
});