const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const Item = require('../models/Item');
const Message = require('../models/Message');
const repo = require('../repositories/conversationRepository');
const conversationService = require('../services/conversationService');
const conversationController = require('../controllers/conversationController');
const {
  assertParticipant,
  canSendInConversation,
  registerChatHandlers,
} = require('../socket/chatHandlers');

const ITEM_ID = '507f1f77bcf86cd799439101';
const OWNER_ID = '507f1f77bcf86cd799439102';
const REQUESTER_ID = '507f1f77bcf86cd799439103';
const OUTSIDER_ID = '507f1f77bcf86cd799439104';
const CONVERSATION_ID = '507f1f77bcf86cd799439105';
const MESSAGE_ID = '507f1f77bcf86cd799439106';

const queryReturning = (value) => ({
  select() { return this; },
  lean() { return Promise.resolve(value); },
});

const conversationFixture = () => ({
  _id: CONVERSATION_ID,
  item: {
    _id: ITEM_ID,
    title: 'حاسوب للدراسة',
    status: 'محجوز',
    donor: OWNER_ID,
    bookedBy: REQUESTER_ID,
  },
  owner: { _id: OWNER_ID, name: 'المتبرع' },
  requester: { _id: REQUESTER_ID, name: 'المستلم' },
  participants: [
    { _id: OWNER_ID, name: 'المتبرع' },
    { _id: REQUESTER_ID, name: 'المستلم' },
  ],
  lastMessage: '',
  lastMessageAt: null,
});

test('فتح المحادثة يستخرج الطرفين من الحجز ولا يحتاج donorId من الواجهة', async (t) => {
  const originals = {
    findItem: Item.findById,
    findPair: repo.findConversationByPair,
  };
  t.after(() => {
    Item.findById = originals.findItem;
    repo.findConversationByPair = originals.findPair;
  });

  Item.findById = () => queryReturning({ donor: OWNER_ID, bookedBy: REQUESTER_ID });
  repo.findConversationByPair = async (filter) => {
    assert.deepEqual(filter, {
      itemId: ITEM_ID,
      owner: OWNER_ID,
      requester: REQUESTER_ID,
    });
    return conversationFixture();
  };

  const result = await conversationService.openConversationLogic({
    itemId: ITEM_ID,
    userId: OWNER_ID,
    io: null,
  });

  assert.equal(result.isNew, false);
  assert.equal(result.conversation._id, CONVERSATION_ID);
  assert.deepEqual(
    result.conversation.participants.map((participant) => participant._id),
    [OWNER_ID, REQUESTER_ID]
  );
});

test('لا يستطيع طرف الحجز تمرير مستخدم ثالث كهدف للمحادثة', async (t) => {
  const original = Item.findById;
  t.after(() => { Item.findById = original; });
  Item.findById = () => queryReturning({ donor: OWNER_ID, bookedBy: REQUESTER_ID });

  await assert.rejects(
    conversationService.openConversationLogic({
      itemId: ITEM_ID,
      userId: OWNER_ID,
      targetUserId: OUTSIDER_ID,
      io: null,
    }),
    (error) => error.statusCode === 403 && error.code === 'CHAT_TARGET_MISMATCH'
  );
});

test('لا تُنشأ محادثة قبل وجود حجز فعلي', async (t) => {
  const original = Item.findById;
  t.after(() => { Item.findById = original; });
  Item.findById = () => queryReturning({ donor: OWNER_ID, bookedBy: null });

  await assert.rejects(
    conversationService.openConversationLogic({
      itemId: ITEM_ID,
      userId: OWNER_ID,
      io: null,
    }),
    (error) => error.statusCode === 409 && error.code === 'CHAT_REQUIRES_BOOKING'
  );
});

test('Controller يعيد DTO الخدمة مرة واحدة دون تحويل مزدوج', async (t) => {
  const original = conversationService.listConversationsLogic;
  t.after(() => { conversationService.listConversationsLogic = original; });
  const expected = [{
    _id: CONVERSATION_ID,
    item: { _id: ITEM_ID, title: 'حاسوب للدراسة' },
    participants: [],
    unreadCount: 2,
  }];
  conversationService.listConversationsLogic = async () => expected;

  let responseBody;
  const response = {
    status(code) {
      assert.equal(code, 200);
      return this;
    },
    json(body) { responseBody = body; },
  };
  await conversationController.listConversations(
    { user: { id: OWNER_ID } },
    response,
    (error) => { throw error; }
  );

  assert.equal(responseBody.data, expected);
  assert.equal(responseBody.results, 1);
});

test('Socket لا يعامل itemId كبديل خفي لمعرّف المحادثة', async (t) => {
  const original = repo.findConversationById;
  t.after(() => { repo.findConversationById = original; });
  repo.findConversationById = async (conversationId) => {
    assert.equal(conversationId, ITEM_ID);
    return null;
  };

  await assert.rejects(
    assertParticipant(ITEM_ID, OWNER_ID),
    (error) => error.code === 'CHAT_NOT_FOUND'
  );
});

test('Socket يرفض مستخدماً ليس ضمن participants حتى لو عرف conversationId', async (t) => {
  const original = repo.findConversationById;
  t.after(() => { repo.findConversationById = original; });
  repo.findConversationById = async () => conversationFixture();

  await assert.rejects(
    assertParticipant(CONVERSATION_ID, OUTSIDER_ID),
    (error) => error.code === 'CHAT_FORBIDDEN' && error.statusCode === 403
  );
});

test('المحادثة القديمة تصبح للقراءة فقط بعد انتقال الحجز لمستخدم آخر', () => {
  const conversation = conversationFixture();
  assert.equal(canSendInConversation(conversation), true);

  conversation.item.bookedBy = OUTSIDER_ID;
  assert.equal(canSendInConversation(conversation), false);
});

test('إعادة إرسال clientMessageId نفسه تُؤكَّد دون بث نسخة ثانية', async (t) => {
  const originals = {
    findConversation: repo.findConversationById,
    findMessages: repo.findMessagesPage,
    markRead: repo.markMessagesRead,
    markNotificationsRead: repo.markMessageNotificationsRead,
    createMessage: repo.createMessage,
  };
  t.after(() => {
    repo.findConversationById = originals.findConversation;
    repo.findMessagesPage = originals.findMessages;
    repo.markMessagesRead = originals.markRead;
    repo.markMessageNotificationsRead = originals.markNotificationsRead;
    repo.createMessage = originals.createMessage;
  });

  repo.findConversationById = async () => conversationFixture();
  repo.findMessagesPage = async () => ({ messages: [], page: 1, totalPages: 1 });
  repo.markMessagesRead = async () => 0;
  repo.markMessageNotificationsRead = async () => 0;
  repo.createMessage = async ({ clientMessageId }) => ({
    created: false,
    message: {
      _id: MESSAGE_ID,
      sender: OWNER_ID,
      text: 'موعدنا غداً',
      read: false,
      createdAt: new Date('2026-08-24T10:00:00Z'),
      clientMessageId,
    },
  });

  const handlers = new Map();
  const directEvents = [];
  const roomEvents = [];
  const socket = {
    userId: OWNER_ID,
    userName: 'المتبرع',
    rooms: new Set([`user_${OWNER_ID}`]),
    on(event, handler) { handlers.set(event, handler); },
    emit(event, payload) { directEvents.push({ event, payload }); },
    join(room) { this.rooms.add(room); },
    leave(room) { this.rooms.delete(room); },
    to(room) { return { emit: (event, payload) => roomEvents.push({ room, event, payload }) }; },
  };
  const io = {
    to(room) { return { emit: (event, payload) => roomEvents.push({ room, event, payload }) }; },
  };
  registerChatHandlers(io, socket);

  let joinAck;
  await handlers.get('join_room')({ convId: CONVERSATION_ID }, (payload) => { joinAck = payload; });
  assert.equal(joinAck.ok, true);

  let sendAck;
  await handlers.get('send_message')({
    convId: CONVERSATION_ID,
    text: 'موعدنا غداً',
    correlationId: 'retry-message-1234',
  }, (payload) => { sendAck = payload; });

  assert.equal(sendAck.ok, true);
  assert.equal(sendAck.message._id, MESSAGE_ID);
  assert.equal(roomEvents.some((event) => event.event === 'receive_message'), false);
  assert.equal(directEvents.some((event) => event.event === 'chat_error'), false);
});

test('فهرس الرسائل يمنع تكرار clientMessageId لنفس المرسل والمحادثة', () => {
  const indexes = Message.schema.indexes();
  const idempotencyIndex = indexes.find(([key]) => (
    key.conversation === 1 && key.sender === 1 && key.clientMessageId === 1
  ));

  assert.ok(idempotencyIndex);
  assert.equal(idempotencyIndex[1].unique, true);
  assert.deepEqual(
    idempotencyIndex[1].partialFilterExpression,
    { clientMessageId: { $type: 'string' } }
  );
});

test('تعليم المحادثة كمقروءة ينظف رسائلها وإشعاراتها معاً', async (t) => {
  const originals = {
    findConversation: repo.findConversationById,
    markRead: repo.markMessagesRead,
    markNotificationsRead: repo.markMessageNotificationsRead,
  };
  t.after(() => {
    repo.findConversationById = originals.findConversation;
    repo.markMessagesRead = originals.markRead;
    repo.markMessageNotificationsRead = originals.markNotificationsRead;
  });

  repo.findConversationById = async () => conversationFixture();
  repo.markMessagesRead = async () => 2;
  repo.markMessageNotificationsRead = async () => 1;
  const events = [];
  const io = {
    to(room) {
      return { emit: (event, payload) => events.push({ room, event, payload }) };
    },
  };

  const result = await conversationService.markConversationReadLogic({
    conversationId: CONVERSATION_ID,
    userId: REQUESTER_ID,
    io,
  });

  assert.deepEqual(result, {
    success: true,
    markedCount: 2,
    markedNotificationCount: 1,
  });
  assert.ok(events.some((entry) => entry.event === 'messages_read'));
  assert.ok(events.some((entry) => (
    entry.room === `user_${REQUESTER_ID}` && entry.event === 'notification:refresh'
  )));
});

test('Routes تتحقق من body ومعرّف المحادثة ولا توفر POST للرسائل', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../routes/conversationRoutes.js'),
    'utf8'
  );
  assert.match(source, /validateBody\('openConversation'\)/);
  assert.match(source, /validateObjectId\('conversationId'\)/);
  assert.doesNotMatch(source, /messages[^;]*\.post\(/s);
});

test('Flow 7 يستخدم إشعار new_message الدائم وحدث notification:new الموحد', () => {
  const [chatSource, notifySource] = [
    fs.readFileSync(path.join(__dirname, '../socket/chatHandlers.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../utils/notifyUser.js'), 'utf8'),
  ];

  assert.match(chatSource, /type:\s*'new_message'/);
  assert.match(chatSource, /notifyUser\(participantId/);
  assert.match(notifySource, /emit\('notification:new'/);
  assert.match(chatSource, /notification:refresh/);
  assert.doesNotMatch(chatSource, /notification_new/);
});
