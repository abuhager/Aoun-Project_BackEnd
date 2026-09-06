import Report from '../models/Report.js';
import Item from '../models/Item.js';
import type { EntityId, RepositoryPayload } from './repositoryTypes.js';

type AppealUpdate = {
  reportId: EntityId;
  userId: EntityId;
  appealText: string;
  appealedAt: Date;
};

export const createReport = (payload: RepositoryPayload) => Report.create(payload);

export const findById = (reportId: EntityId) => Report.findById(reportId);

export const findContextItem = (itemId: EntityId) =>
  Item.findById(itemId)
    .select('donor bookedBy status')
    .lean();

export const findByIdPopulated = (reportId: EntityId) =>
  Report.findById(reportId)
    .populate('reportedUser', 'name email isBanned role')
    .populate('reporter',     'name email')
    .populate('relatedItem',  'title');

export const findExistingPending = (
  reporterId: EntityId,
  reportedUserId: EntityId,
  itemId: EntityId | null
) =>
  Report.findOne({
    reporter:     reporterId,
    reportedUser: reportedUserId,
    relatedItem:  itemId ?? null,
    status:       'pending',
  }).select('_id').lean();

export const countByReportedUser = (userId: EntityId) =>
  Report.countDocuments({ reportedUser: userId });

export const countActionedByReportedUser = (userId: EntityId) =>
  Report.countDocuments({ reportedUser: userId, status: 'actioned' });

export const submitAppeal = ({ reportId, userId, appealText, appealedAt }: AppealUpdate) =>
  Report.findOneAndUpdate(
    {
      _id:          reportId,
      reportedUser: userId,
      status:       'pending',
      appealText:   null,
      $or: [
        { appealDeadline: { $gte: appealedAt } },
        { appealDeadline: null },
      ],
    },
    { $set: { appealText, appealedAt } },
    { returnDocument: 'after' }
  );

export default { createReport, findById, findContextItem, findByIdPopulated, findExistingPending, countByReportedUser, countActionedByReportedUser, submitAppeal };
