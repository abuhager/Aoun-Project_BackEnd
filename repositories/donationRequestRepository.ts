import DonationRequest from '../models/DonationRequest.js';
import type {
  EntityId,
  RepositoryFilter,
  RepositoryPayload,
} from './repositoryTypes.js';

type MonthlyRequestQuery = { userId: EntityId; month: string };
type ActiveMonthlyRequestQuery = MonthlyRequestQuery & { now: Date };
type RequestListQuery = {
  filter: RepositoryFilter;
  skip: number;
  limit: number;
};
type OwnedRequestQuery = { requestId: EntityId; userId: EntityId };
type ExpiredRequestQuery = {
  now: Date;
  requester?: EntityId | null;
  limit?: number;
};

export const countAllMonthlyRequests = ({ userId, month }: MonthlyRequestQuery) =>
  DonationRequest.countDocuments({ requester: userId, month });

export const countActiveMonthlyRequests = ({ userId, month, now }: ActiveMonthlyRequestQuery) =>
  DonationRequest.countDocuments({
    requester: userId,
    month,
    status:    'active',
    expiresAt: { $gt: now },
  });

export const createRequest = (payload: RepositoryPayload) =>
  DonationRequest.create(payload);

export const findRequests = ({ filter, skip, limit }: RequestListQuery) =>
  DonationRequest.find(filter)
    .populate('requester', 'name avatar trustLevel trustScore')
    .populate({
      path:   'fulfilledByItem',
      select: '_id condition status safeHub donor',
      populate: [
        { path: 'safeHub', select: 'name city address' },
        { path: 'donor',   select: 'name' },
      ],
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

export const countRequests = (filter: RepositoryFilter) =>
  DonationRequest.countDocuments(filter);

export const cancelOwnedActiveRequest = ({ requestId, userId }: OwnedRequestQuery) =>
  DonationRequest.findOneAndUpdate(
    { _id: requestId, requester: userId, status: 'active' },
    { $set: { status: 'cancelled' } },
    { returnDocument: 'after' }
  );

export const findUserRequests = (userId: EntityId) =>
  DonationRequest.find({ requester: userId })
    .sort({ createdAt: -1 })
    .populate('requester', 'name avatar trustLevel trustScore')
    .populate({
      path:   'fulfilledByItem',
      select: '_id condition status safeHub donor',
      populate: [
        { path: 'safeHub', select: 'name city address' },
        { path: 'donor',   select: 'name' },
      ],
    })
    .lean();

export const findActiveRequestById = (requestId: EntityId) =>
  DonationRequest.findOne({
    _id:       requestId,
    status:    'active',
    expiresAt: { $gt: new Date() },
  })
    .populate('requester', 'name avatar trustLevel trustScore')
    .lean();

export const findRequestByIdWithItem = (requestId: EntityId) =>
  DonationRequest.findById(requestId)
    .populate('requester', 'name avatar trustLevel trustScore')
    .populate({
      path:   'fulfilledByItem',
      select: '_id condition status safeHub donor recipientConfirmed donorConfirmed',
      populate: [
        { path: 'safeHub', select: 'name city address' },
        { path: 'donor',   select: 'name' },
      ],
    })
    .lean();

export const findRequestById = (requestId: EntityId) =>
  DonationRequest.findById(requestId)
    .populate('requester', 'name avatar trustLevel trustScore')
    .lean();

export const findExpiredActiveIds = ({
  now,
  requester,
  limit = 200,
}: ExpiredRequestQuery) => {
  const filter: Record<string, unknown> = {
    status: 'active',
    expiresAt: { $lte: now },
  };
  if (requester) filter.requester = requester;

  return DonationRequest.find(filter)
    .select('_id')
    .sort({ expiresAt: 1 })
    .limit(limit)
    .lean();
};

export default { countAllMonthlyRequests, countActiveMonthlyRequests, createRequest, findRequests, countRequests, cancelOwnedActiveRequest, findUserRequests, findActiveRequestById, findRequestByIdWithItem, findRequestById, findExpiredActiveIds };
