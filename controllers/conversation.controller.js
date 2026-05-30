const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Item = require('../models/Item');
const Notification = require('../models/Notification');

const emitMessageToConversation = (req, conversationId, payload) => {
  const io = req.app.get('io');
  if (!io) return;
  io.to(`conv_${conversationId}`).emit('newMessage', payload);
};

const emitNotificationToUser = (req, userId, payload) => {
  const io = req.app.get('io');
  if (!io || !userId) return;
  io.to(`user_${userId}`).emit('notification:new', payload);
};

const markIncomingMessagesRead = async (conversation, userId) => {
  let changed = false;

  conversation.messages.forEach((m) => {
    if (m.sender.toString() !== userId.toString() && !m.read) {
      m.read = true;
      changed = true;
    }
  });

  if (changed) {
    conversation.lastActivity = new Date();
    await conversation.save();
  }

  return changed;
};

exports.listConversations = async (req, res) => {
  try {
    const convs = await Conversation.find({
      participants: req.user.id,
    })
      .populate('item', 'title imageUrl')
      .populate('participants', 'name avatar')
      .sort({ lastActivity: -1 })
      .select('-messages')
      .lean();

    const withUnread = await Promise.all(
      convs.map(async (c) => {
        const full = await Conversation.findById(c._id);
        const unread = full
          ? full.messages.filter(
              (m) => m.sender.toString() !== req.user.id.toString() && !m.read
            ).length
          : 0;

        return { ...c, unread };
      })
    );

    res.json(withUnread);
  } catch (err) {
    console.error('listConversations error:', err);
    res.status(500).json({ message: 'فشل في جلب المحادثات' });
  }
};

exports.openConversation = async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.user.id.toString();

    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ message: 'itemId غير صالح' });
    }

    const item = await Item.findById(itemId).populate('donor', '_id name');
    if (!item) {
      return res.status(404).json({ message: 'الغرض غير موجود' });
    }

    const donorId = item.donor?._id?.toString?.() || item.donor?.toString?.();
    const bookedById =
      typeof item.bookedBy === 'object'
        ? item.bookedBy?._id?.toString?.()
        : item.bookedBy?.toString?.();

    if (!bookedById) {
      return res.status(400).json({ message: 'لا توجد محادثة قبل حجز الغرض' });
    }

    const allowed = userId === donorId || userId === bookedById;
    if (!allowed) {
      return res.status(403).json({ message: 'غير مصرح لك بفتح هذه المحادثة' });
    }

    let conversation = await Conversation.findOne({
      item: itemId,
      participants: { $all: [donorId, bookedById] },
    });

    if (!conversation) {
      conversation = await Conversation.create({
        item: itemId,
        participants: [donorId, bookedById],
        messages: [],
        lastActivity: new Date(),
      });
    }

    res.json({
      _id: conversation._id,
      item: conversation.item,
      participants: conversation.participants,
    });
  } catch (err) {
    console.error('openConversation error:', err);
    res.status(500).json({ message: 'فشل في فتح المحادثة' });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: 'conversationId غير صالح' });
    }

    const conversation = await Conversation.findById(conversationId)
      .populate('messages.sender', 'name avatar');

    if (!conversation) {
      return res.status(404).json({ message: 'المحادثة غير موجودة' });
    }

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === req.user.id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({ message: 'غير مصرح لك' });
    }

    await markIncomingMessagesRead(conversation, req.user.id);

    res.json({
      messages: conversation.messages.map((m) => ({
        _id: m._id,
        sender:
          typeof m.sender === 'object' && m.sender?._id
            ? m.sender._id.toString()
            : m.sender.toString(),
        senderName: typeof m.sender === 'object' ? m.sender?.name : undefined,
        text: m.text,
        read: m.read,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    console.error('getMessages error:', err);
    res.status(500).json({ message: 'فشل في جلب الرسائل' });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { text } = req.body;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: 'conversationId غير صالح' });
    }

    if (!text || !text.trim() || text.trim().length > 1000) {
      return res.status(400).json({ message: 'نص الرسالة غير صالح' });
    }

    const conversation = await Conversation.findById(conversationId).populate('item', 'title _id');
    if (!conversation) {
      return res.status(404).json({ message: 'المحادثة غير موجودة' });
    }

    const senderId = req.user.id.toString();
    const isParticipant = conversation.participants.some(
      (p) => p.toString() === senderId
    );

    if (!isParticipant) {
      return res.status(403).json({ message: 'غير مصرح لك' });
    }

    const newMessage = {
      _id: new mongoose.Types.ObjectId(),
      sender: req.user.id,
      text: text.trim(),
      createdAt: new Date(),
      read: false,
    };

    conversation.messages.push(newMessage);
    conversation.lastActivity = new Date();
    await conversation.save();

    const receiverId = conversation.participants.find(
      (p) => p.toString() !== senderId
    )?.toString();

    const payload = {
      _id: newMessage._id,
      sender: senderId,
      senderName: req.user.name,
      text: newMessage.text,
      read: false,
      createdAt: newMessage.createdAt,
    };

    emitMessageToConversation(req, conversation._id.toString(), payload);

    if (receiverId && Notification) {
      try {
        const notif = await Notification.create({
          user: receiverId,
          type: 'new_message',
          title: 'رسالة جديدة',
          body: `لديك رسالة جديدة بخصوص: ${conversation.item?.title || 'أحد الأغراض'}`,
          itemId: conversation.item?._id || null,
          isRead: false,
        });

        emitNotificationToUser(req, receiverId, {
          _id: notif._id,
          type: 'new_message',
          title: notif.title,
          body: notif.body,
          itemId: notif.itemId,
          isRead: false,
          createdAt: notif.createdAt,
        });
      } catch (notifErr) {
        console.error('notification error:', notifErr);
      }
    }

    res.status(201).json({ message: payload });
  } catch (err) {
    console.error('sendMessage error:', err);
    res.status(500).json({ message: 'فشل في إرسال الرسالة' });
  }
};

exports.markConversationRead = async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: 'conversationId غير صالح' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'المحادثة غير موجودة' });
    }

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === req.user.id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({ message: 'غير مصرح لك' });
    }

    await markIncomingMessagesRead(conversation, req.user.id);

    const io = req.app.get('io');
    if (io) {
      io.to(`conv_${conversationId}`).emit('messagesRead', { by: req.user.id });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('markConversationRead error:', err);
    res.status(500).json({ message: 'فشل في تعليم الرسائل كمقروءة' });
  }
};