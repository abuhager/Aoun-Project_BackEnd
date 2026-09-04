// تحقق شكل الطلبات موحّد في middlewares/validateBody.js.
import { asRecord, toPlainRecord } from './dtoTypes';

exports.toPublicOffer = (rawOffer: unknown) => {
  const offer = toPlainRecord(rawOffer);
  if (!offer) return null;
  const donor = asRecord(offer.donor);
  const safeHub = asRecord(offer.safeHub);

  return ({
  _id:         offer._id,
  request:     offer.request,
  condition:   offer.condition,
  description: offer.description ?? null,
  imageUrl:    offer.imageUrl     ?? null,
  status:      offer.status,
  createdAt:   offer.createdAt,
  donor: donor ? {
    _id:        donor._id,
    name:       donor.name,
    avatar:     donor.avatar     ?? null,
    trustLevel: donor.trustLevel ?? null,
    trustScore: donor.trustScore ?? null,
  } : null,
  safeHub: safeHub ? {
    _id:     safeHub._id,
    name:    safeHub.name,
    city:    safeHub.city,
    address: safeHub.address,
  } : null,
  });
};
