// controllers/hubController.js
// المسؤولية: HTTP فقط — استقبال الطلب → hubService → Response
const hubService = require('../services/hubService');

exports.getHubs = async (req, res) => {
  try {
    const { statusCode, body } = await hubService.getAllHubs();
    res.status(statusCode).json(body);
  } catch (err) {
    res.status(500).json({ msg: 'خطأ في جلب المراكز' });
  }
};

exports.createHub = async (req, res) => {
  try {
    const { statusCode, body } = await hubService.createHub(req.body, req.user.id);
    res.status(statusCode).json(body);
  } catch (err) {
    res.status(500).json({ msg: 'خطأ في إنشاء المركز' });
  }
};

exports.updateHub = async (req, res) => {
  try {
    const { statusCode, body } = await hubService.updateHub(req.params.id, req.body);
    res.status(statusCode).json(body);
  } catch (err) {
    res.status(500).json({ msg: 'خطأ في تحديث المركز' });
  }
};

exports.deactivateHub = async (req, res) => {
  try {
    const { statusCode, body } = await hubService.deactivateHub(req.params.id);
    res.status(statusCode).json(body);
  } catch (err) {
    res.status(500).json({ msg: 'خطأ في تعطيل المركز' });
  }
};