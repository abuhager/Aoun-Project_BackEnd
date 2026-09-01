// تحقق شكل الطلبات موحّد في middlewares/validateBody.js،
// والتصنيفات والمواقع الديناميكية تتحقق منها donationRequestService.

exports.toPublicRequest = (
  req,
  options: { includeFulfilledItem?: boolean } = {}
) => ({
  _id:         req._id,
  title:       req.title,
  category:    req.category,
  urgency:     req.urgency,
  description: req.description ?? null,
  location:    req.location,
  status:      req.status,
  month:       req.month       ?? null,
  expiresAt:   req.expiresAt   ?? null,
  createdAt:   req.createdAt,
  updatedAt:   req.updatedAt,
  requester: req.requester?.name ? {
    _id:        req.requester._id,
    name:       req.requester.name,
    avatar:     req.requester.avatar     ?? null,
    trustScore: req.requester.trustScore ?? null,
    trustLevel: req.requester.trustLevel ?? null,
  } : null,
  // تفاصيل العرض الفائز خاصة بصاحب الطلب والمتبرع المقبول والإدارة فقط.
  fulfilledByItem: options.includeFulfilledItem && req.fulfilledByItem ? {
    _id:                req.fulfilledByItem._id,
    status:             req.fulfilledByItem.status,
    condition:          req.fulfilledByItem.condition,
    recipientConfirmed: req.fulfilledByItem.recipientConfirmed ?? false,
    donorConfirmed:     req.fulfilledByItem.donorConfirmed     ?? false,
    safeHub: req.fulfilledByItem.safeHub ? {
      name:    req.fulfilledByItem.safeHub.name,
      city:    req.fulfilledByItem.safeHub.city,
      address: req.fulfilledByItem.safeHub.address,
    } : null,
    donor: req.fulfilledByItem.donor ? {
      _id:  req.fulfilledByItem.donor._id,
      name: req.fulfilledByItem.donor.name,
    } : null,
  } : null,
});
