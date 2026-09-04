const DonationRequest = require('../models/DonationRequest');
import type {
  EntityId,
  RepositoryFilter,
  RepositoryPayload,
} from './repositoryTypes';

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

// عدد الطلبات في الشهر (بغض النظر عن الحالة) — للحد الأقصى عند الإنشاء
exports.countAllMonthlyRequests = ({ userId, month }: MonthlyRequestQuery) =>
  DonationRequest.countDocuments({ requester: userId, month });

// عدد الطلبات النشطة في الشهر — للعرض في صفحة "طلباتي"
exports.countActiveMonthlyRequests = ({ userId, month, now }: ActiveMonthlyRequestQuery) =>
  DonationRequest.countDocuments({
    requester: userId,
    month,
    status:    'active',
    expiresAt: { $gt: now },
  });

exports.createRequest = (payload: RepositoryPayload) =>
  DonationRequest.create(payload);

exports.findRequests = ({ filter, skip, limit }: RequestListQuery) =>
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

exports.countRequests = (filter: RepositoryFilter) =>
  DonationRequest.countDocuments(filter);

exports.cancelOwnedActiveRequest = ({ requestId, userId }: OwnedRequestQuery) =>
  DonationRequest.findOneAndUpdate(
    { _id: requestId, requester: userId, status: 'active' },
    { $set: { status: 'cancelled' } },
    { returnDocument: 'after' }
  );

exports.findUserRequests = (userId: EntityId) =>
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

exports.findActiveRequestById = (requestId: EntityId) =>
  DonationRequest.findOne({
    _id:       requestId,
    status:    'active',
    expiresAt: { $gt: new Date() },
  })
    .populate('requester', 'name avatar trustLevel trustScore')
    .lean();

exports.findRequestByIdWithItem = (requestId: EntityId) =>
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

exports.findRequestById = (requestId: EntityId) =>
  DonationRequest.findById(requestId)
    .populate('requester', 'name avatar trustLevel trustScore')
    .lean();

exports.findExpiredActiveIds = ({
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
