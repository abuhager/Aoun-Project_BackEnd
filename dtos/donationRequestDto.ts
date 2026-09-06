// تحقق شكل الطلبات موحّد في middlewares/validateBody.js،
// والتصنيفات والمواقع الديناميكية تتحقق منها donationRequestService.
import { asRecord, toPlainRecord } from './dtoTypes.js';

export const toPublicRequest = (
  rawRequest: unknown,
  options: { includeFulfilledItem?: boolean } = {}
) => {
  const req = toPlainRecord(rawRequest);
  if (!req) return null;
  const requester = asRecord(req.requester);
  const fulfilledByItem = asRecord(req.fulfilledByItem);
  const safeHub = asRecord(fulfilledByItem?.safeHub);
  const donor = asRecord(fulfilledByItem?.donor);

  return ({
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
  requester: requester?.name ? {
    _id:        requester._id,
    name:       requester.name,
    avatar:     requester.avatar     ?? null,
    trustScore: requester.trustScore ?? null,
    trustLevel: requester.trustLevel ?? null,
  } : null,
  // تفاصيل العرض الفائز خاصة بصاحب الطلب والمتبرع المقبول والإدارة فقط.
  fulfilledByItem: options.includeFulfilledItem && fulfilledByItem ? {
    _id:                fulfilledByItem._id,
    status:             fulfilledByItem.status,
    condition:          fulfilledByItem.condition,
    recipientConfirmed: fulfilledByItem.recipientConfirmed ?? false,
    donorConfirmed:     fulfilledByItem.donorConfirmed     ?? false,
    safeHub: safeHub ? {
      name:    safeHub.name,
      city:    safeHub.city,
      address: safeHub.address,
    } : null,
    donor: donor ? {
      _id:  donor._id,
      name: donor.name,
    } : null,
  } : null,
  });
};

export default { toPublicRequest };
