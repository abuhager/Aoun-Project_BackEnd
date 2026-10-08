import Conversation from '../models/Conversation.js';
import User from '../models/User.js';
import repo from '../repositories/conversationRepository.js';
import dto from '../dtos/conversationDto.js';
import AppError from '../utils/AppError.js';
import { isDemoAccount } from '../utils/demoPolicy.js';
import { emitToUser } from '../socket/emitter.js';
import { SOCKET_EVENTS, userRoom, conversationRoom } from '../socket/contracts.js';
import { getIOOrNull } from '../socket/registry.js';
import adminRepository from '../repositories/adminRepository.js';
import runMongoTransaction from '../utils/mongoTransaction.js';

const refresh = (ids: string[], conversationId: unknown) => ids.forEach(id =>
  emitToUser(id, SOCKET_EVENTS.CONVERSATION_UPDATED, { conversationId: String(conversationId) }));
const response = async (id: unknown) => dto.toConversationListItem(await repo.findConversationById(String(id)));

export async function openAdminConversation(actorId: string, targetId: string) {
  if (actorId === targetId) throw new AppError('لا يمكنك محادثة نفسك', 400, 'CHAT_SELF_CONVERSATION');
  const target = await User.findById(targetId).select('_id').lean();
  if (!target) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  const threadKey = `admin:${[actorId, targetId].sort().join(':')}`;
  const conversation = await runMongoTransaction(async session => {
    const created = await Conversation.findOneAndUpdate({ threadKey }, {
      $setOnInsert: { threadKey, kind: 'admin', owner: actorId, requester: targetId, participants: [actorId, targetId], subject: 'تواصل مع الإدارة' },
    }, { upsert: true, returnDocument: 'after', runValidators: true, session });
    await adminRepository.logAdminAction({
      adminId: actorId, action: 'ADMIN_CHAT_OPEN', targetId: created._id,
      targetModel: 'Conversation', reason: 'فتح محادثة إدارية خاصة',
      meta: { recipientId: targetId },
    }, session);
    return created;
  });
  refresh([actorId, targetId], conversation._id);
  return response(conversation._id);
}

export async function openSupport(userId: string, subject: string) {
  // One private support thread per user; reopening preserves the previous history.
  const threadKey = `support:${userId}`;
  const conversation = await Conversation.findOneAndUpdate({ threadKey }, {
    $setOnInsert: { threadKey, kind: 'support', owner: userId, requester: userId, participants: [userId], subject },
  }, { upsert: true, returnDocument: 'after', runValidators: true });
  if (conversation.supportStatus === 'resolved') {
    await Conversation.updateOne({ _id: conversation._id, supportStatus: 'resolved' }, { $set: { supportStatus: 'open', subject } });
  }
  return response(conversation._id);
}

export async function listSupport(userId: string, admin: boolean, page: number) {
  const filter = { kind: 'support' as const, ...(admin ? {} : { requester: userId }) };
  const [rows, total] = await Promise.all([
    Conversation.find(filter).populate('requester', 'name avatar').populate('owner', 'name avatar')
      .sort({ updatedAt: -1 }).skip((page - 1) * 20).limit(20).lean(),
    Conversation.countDocuments(filter),
  ]);
  // Inbox exposes ticket metadata only. Messages remain participant-only.
  return { tickets: rows.map(row => ({
    _id: String(row._id), subject: row.subject, status: row.supportStatus,
    requester: row.requester, assignedTo: String(row.owner?._id) === String(row.requester?._id) ? null : row.owner,
    updatedAt: row.updatedAt,
  })), page, pages: Math.ceil(total / 20), total };
}

export async function claimSupport(id: string, actorId: string) {
  const ticket = await Conversation.findOne({ _id: id, kind: 'support' }).lean();
  if (!ticket) throw new AppError('طلب الدعم غير موجود', 404, 'SUPPORT_NOT_FOUND');
  if (String(ticket.owner) !== String(ticket.requester) && String(ticket.owner) !== actorId) {
    const owner = await User.findById(ticket.owner).select('role isBanned isFrozen isDemo email').lean();
    if (owner && ['admin', 'super_admin'].includes(owner.role) && !owner.isBanned && !owner.isFrozen && !isDemoAccount(owner)) {
      throw new AppError('هذا الطلب لدى مشرف آخر', 409, 'SUPPORT_ALREADY_ASSIGNED');
    }
  }
  await runMongoTransaction(async session => {
    const updated = await Conversation.findOneAndUpdate({ _id: id, owner: ticket.owner, supportStatus: ticket.supportStatus }, {
      $set: { owner: actorId, participants: [actorId, String(ticket.requester)], supportStatus: 'in_progress' },
    }, { returnDocument: 'after', runValidators: true, session });
    if (!updated) throw new AppError('تغير الطلب لدى مشرف آخر. حدّث الصفحة.', 409, 'SUPPORT_ALREADY_ASSIGNED');
    await adminRepository.logAdminAction({
      adminId: actorId, action: 'SUPPORT_CLAIM', targetId: id,
      targetModel: 'Conversation', targetName: ticket.subject,
      reason: 'استلام طلب دعم', meta: { previousOwnerId: String(ticket.owner), requesterId: String(ticket.requester) },
    }, session);
  });
  if (String(ticket.owner) !== String(ticket.requester) && String(ticket.owner) !== actorId) {
    getIOOrNull()?.in(userRoom(String(ticket.owner))).socketsLeave(conversationRoom(id));
  }
  refresh([actorId, String(ticket.requester)], id);
  return response(id);
}

export async function resolveSupport(id: string, actorId: string) {
  const updated = await runMongoTransaction(async session => {
    const ticket = await Conversation.findOneAndUpdate({ _id: id, kind: 'support', owner: actorId, supportStatus: { $ne: 'resolved' } }, {
      $set: { supportStatus: 'resolved' },
    }, { returnDocument: 'after', runValidators: true, session });
    if (!ticket) throw new AppError('يجب استلام طلب مفتوح أولاً', 403, 'SUPPORT_NOT_ASSIGNED');
    await adminRepository.logAdminAction({
      adminId: actorId, action: 'SUPPORT_RESOLVE', targetId: id,
      targetModel: 'Conversation', targetName: ticket.subject,
      reason: 'إغلاق طلب دعم بعد حل المشكلة', meta: { requesterId: String(ticket.requester) },
    }, session);
    return ticket;
  });
  refresh([actorId, String(updated.requester)], id);
  return { success: true };
}
