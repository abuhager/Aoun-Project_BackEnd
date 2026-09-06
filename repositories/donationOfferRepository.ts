import DonationOffer from '../models/DonationOffer.js';
import type {
  EntityId,
  RepositoryPayload,
  RepositorySession,
} from './repositoryTypes.js';

export const countPendingByHub = (hubId: EntityId) =>
  DonationOffer.countDocuments({ safeHub: hubId, status: 'pending' });

export const createOffer = async (
  payload: RepositoryPayload,
  session: RepositorySession = null
) => {
  if (!session) return DonationOffer.create(payload);
  const [offer] = await DonationOffer.create([payload], { session });
  return offer;
};

export const existsByRequestAndDonor = async (requestId: EntityId, donorId: EntityId) => {
  const result = await DonationOffer.exists({ request: requestId, donor: donorId });
  return !!result;
};

export const findViewerOffer = (requestId: EntityId, donorId: EntityId) =>
  DonationOffer.findOne({ request: requestId, donor: donorId })
    .select('_id status createdAt')
    .lean();

export const findOffersByRequest = (requestId: EntityId) =>
  DonationOffer.find({ request: requestId })
    .populate('donor',   'name avatar trustLevel trustScore')
    .populate('safeHub', 'name city address')
    .sort({ createdAt: -1 })
    .lean();

export const findOfferById = (offerId: EntityId) =>
  DonationOffer.findById(offerId)
    .populate('donor',   'name avatar trustLevel trustScore')
    .populate('safeHub', 'name city address')
    .lean();

export const rejectAllPendingExcept = (
  requestId: EntityId,
  acceptedOfferId: EntityId,
  session: RepositorySession
) =>
  DonationOffer.updateMany(
    { request: requestId, _id: { $ne: acceptedOfferId }, status: 'pending' },
    { $set: { status: 'rejected' } },
    { session: session ?? undefined }
  );

export const acceptOffer = (offerId: EntityId, session: RepositorySession) =>
  DonationOffer.findByIdAndUpdate(
    offerId,
    { $set: { status: 'accepted' } },
    { returnDocument: 'after', session: session ?? undefined }
  ).populate('donor',   'name email')
   .populate('safeHub', 'name city address');

export const countPendingOffersByDonor = async (donorId: EntityId) => {
  return DonationOffer.countDocuments({ donor: donorId, status: 'pending' });
};

export const countPendingByDonor = countPendingOffersByDonor;

export default { countPendingByHub, createOffer, existsByRequestAndDonor, findViewerOffer, findOffersByRequest, findOfferById, rejectAllPendingExcept, acceptOffer, countPendingOffersByDonor, countPendingByDonor };
