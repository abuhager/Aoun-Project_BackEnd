// controllers/donationRequestController.js
const drService = require('../services/donationRequestService');

exports.getRequests = async (req, res) => {
  try {
    const result = await drService.getRequestsLogic(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.status ?? 500).json({ msg: err.message });
  }
};

exports.getMyRequests = async (req, res) => {
  try {
    const result = await drService.getMyRequestsLogic(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(err.status ?? 500).json({ msg: err.message });
  }
};

exports.createRequest = async (req, res) => {
  try {
    const result = await drService.createRequestLogic(req.body, req.user.id);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status ?? 500).json({ msg: err.message, code: err.code });
  }
};

exports.cancelRequest = async (req, res) => {
  try {
    const result = await drService.cancelRequestLogic(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(err.status ?? 500).json({ msg: err.message });
  }
};
