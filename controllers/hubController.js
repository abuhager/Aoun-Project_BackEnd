const SafeHub = require('../models/SafeHub');

// GET /api/hubs — كل المستخدمين يشوفون الـ Hubs النشطة
exports.getHubs = async (req, res) => {
  try {
    const hubs = await SafeHub.find({ isActive: true }).select('-createdBy');
    res.json(hubs);
  } catch (err) {
    res.status(500).json({ message: 'خطأ في جلب المراكز' });
  }
};

// POST /api/hubs — Admin فقط
exports.createHub = async (req, res) => {
  try {
    const { name, address, city, coordinates } = req.body;

    if (!name || !address || !city) {
      return res.status(400).json({ message: 'الاسم والعنوان والمدينة مطلوبة' });
    }

    const hub = await SafeHub.create({
      name,
      address,
      city,
      coordinates,
      createdBy: req.user._id,
    });

    res.status(201).json(hub);
  } catch (err) {
    res.status(500).json({ message: 'خطأ في إنشاء المركز' });
  }
};

// PATCH /api/hubs/:id — Admin فقط
exports.updateHub = async (req, res) => {
  try {
    const hub = await SafeHub.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!hub) return res.status(404).json({ message: 'المركز غير موجود' });
    res.json(hub);
  } catch (err) {
    res.status(500).json({ message: 'خطأ في تحديث المركز' });
  }
};

// DELETE /api/hubs/:id — Admin فقط (soft delete)
exports.deactivateHub = async (req, res) => {
  try {
    const hub = await SafeHub.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!hub) return res.status(404).json({ message: 'المركز غير موجود' });
    res.json({ message: 'تم تعطيل المركز' });
  } catch (err) {
    res.status(500).json({ message: 'خطأ في تعطيل المركز' });
  }
};