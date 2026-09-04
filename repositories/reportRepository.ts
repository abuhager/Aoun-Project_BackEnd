// repositories/reportRepository.js
const Report = require('../models/Report');
const Item   = require('../models/Item');
import type { EntityId, RepositoryPayload } from './repositoryTypes';

type AppealUpdate = {
  reportId: EntityId;
  userId: EntityId;
  appealText: string;
  appealedAt: Date;
};

// ── قراءة ─────────────────────────────────────────────────────
exports.createReport = (payload: RepositoryPayload) => Report.create(payload);

exports.findById = (reportId: EntityId) => Report.findById(reportId);

exports.findContextItem = (itemId: EntityId) =>
  Item.findById(itemId)
    .select('donor bookedBy status')
    .lean();

exports.findByIdPopulated = (reportId: EntityId) =>
  Report.findById(reportId)
    .populate('reportedUser', 'name email isBanned role')
    .populate('reporter',     'name email')
    .populate('relatedItem',  'title');

// ✅ FIX [REPORT-01]: guard صريح ضد التكرار قبل الإنشاء
exports.findExistingPending = (
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

exports.countByReportedUser = (userId: EntityId) =>
  Report.countDocuments({ reportedUser: userId });

exports.countActionedByReportedUser = (userId: EntityId) =>
  Report.countDocuments({ reportedUser: userId, status: 'actioned' });

// ── تحديث ─────────────────────────────────────────────────────
exports.submitAppeal = ({ reportId, userId, appealText, appealedAt }: AppealUpdate) =>
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
