// تحقق شكل الطلبات موحّد في middlewares/validateBody.js.

exports.toPublicOffer = (offer) => ({
  _id:         offer._id,
  request:     offer.request,
  condition:   offer.condition,
  description: offer.description ?? null,
  imageUrl:    offer.imageUrl     ?? null,
  status:      offer.status,
  createdAt:   offer.createdAt,
  donor: offer.donor ? {
    _id:        offer.donor._id,
    name:       offer.donor.name,
    avatar:     offer.donor.avatar     ?? null,
    trustLevel: offer.donor.trustLevel ?? null,
    trustScore: offer.donor.trustScore ?? null,
  } : null,
  safeHub: offer.safeHub ? {
    _id:     offer.safeHub._id,
    name:    offer.safeHub.name,
    city:    offer.safeHub.city,
    address: offer.safeHub.address,
  } : null,
});
