const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-that-is-long-enough-123456';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-12345';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '7d';
const { requireAuth, requireAdmin } = require('../middlewares/auth');
const { generateAccessToken } = require('../utils/tokenUtils');
const userRepo = require('../repositories/userRepository').default;
const cache = require('../utils/sessionCache').default;
const { isDemoAccount } = require('../utils/demoPolicy');
const feature = require('../middlewares/donationRequestsFeature').default;
const Settings = require('../models/SystemSettings').default;
const Conversation = require('../models/Conversation').default;
const repo = require('../repositories/conversationRepository').default;
const support = require('../services/supportService');
const adminRepo = require('../repositories/adminRepository').default;
const { canSendInConversation, assertParticipant, registerChatHandlers } = require('../socket/chatHandlers');
const { SOCKET_EVENTS } = require('../socket/contracts');
const { toAdminItem } = require('../dtos/adminDto');
const id = '507f1f77bcf86cd799439101';
const other = '507f1f77bcf86cd799439102';
const conv = '507f1f77bcf86cd799439103';
const query = value => ({ lean: async () => value, select() { return this; } });
const mockTransaction = (t, events = []) => {
  const original = mongoose.startSession;
  const session = {
    async withTransaction(work) {
      try { await work(); events.push('commit'); }
      catch (error) { events.push('abort'); throw error; }
    },
    async endSession() { events.push('end'); },
  };
  mongoose.startSession = async () => session;
  t.after(() => { mongoose.startSession = original; });
  return session;
};

test('demo API blocks all mutations, permits browsing and logout; real admin remains writable', async t => {
  const original = userRepo.findAuthStateById;
  t.after(() => { userRepo.findAuthStateById = original; cache.invalidate(id); });
  let demo = true;
  userRepo.findAuthStateById = async () => ({ name: 'demo', role: 'admin', isVerified: true, isDemo: demo, sessionVersion: 0 });
  const token = generateAccessToken({ _id: id, sessionVersion: 0 });
  const run = async (method, url) => {
    cache.invalidate(id);
    let result;
    await requireAuth({ method, originalUrl: url, headers: { authorization: `Bearer ${token}` } }, { setHeader() {} }, error => { result = error; });
    return result;
  };
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await run(method, '/api/admin/users/x/ban')).code, 'DEMO_READ_ONLY');
    assert.equal((await run(method, '/api/support')).code, 'DEMO_READ_ONLY');
  }
  assert.equal(await run('GET', '/api/admin/items'), undefined);
  assert.equal(await run('POST', '/api/auth/logout'), undefined);
  demo = false;
  assert.equal(await run('POST', '/api/admin/users/x/ban'), undefined);
});

test('demo identity is controlled by persisted flag or configured email', () => {
  const old = process.env.DEMO_ADMIN_EMAIL;
  process.env.DEMO_ADMIN_EMAIL = 'demo@example.test';
  try {
    assert.equal(isDemoAccount({ email: 'DEMO@example.test' }), true);
    assert.equal(isDemoAccount({ isDemo: true }), true);
    assert.equal(isDemoAccount({ email: 'admin@example.test' }), false);
  } finally { if (old === undefined) delete process.env.DEMO_ADMIN_EMAIL; else process.env.DEMO_ADMIN_EMAIL = old; }
});

test('ordinary users cannot initiate administrative conversations', () => {
  let error;
  requireAdmin({ user: { role: 'user' } }, {}, e => { error = e; });
  assert.equal(error.code, 'FORBIDDEN_ADMIN_ONLY');
});

test('feature gate rejects reads and writes when disabled and propagates settings failure', async t => {
  const old = Settings.getCached;
  t.after(() => { Settings.getCached = old; });
  for (const enabled of [false, true]) {
    Settings.getCached = async () => ({ donationRequestsEnabled: enabled });
    for (const method of ['GET', 'POST', 'PATCH']) {
      let error;
      await feature({ method }, {}, e => { error = e; });
      assert.equal(error?.code, enabled ? undefined : 'DONATION_REQUESTS_DISABLED');
    }
  }
  Settings.getCached = async () => { throw new Error('offline'); };
  let error; await feature({}, {}, e => { error = e; }); assert.equal(error.message, 'offline');
});

test('booking and support write eligibility preserve closure rules', () => {
  assert.equal(canSendInConversation({ kind: 'support', supportStatus: 'open' }), true);
  assert.equal(canSendInConversation({ kind: 'support', supportStatus: 'resolved' }), false);
  assert.equal(canSendInConversation({ kind: 'admin', archivedAt: new Date() }), false);
  assert.equal(canSendInConversation({ owner: id, requester: other, item: { donor: id, bookedBy: other } }), true);
  assert.equal(canSendInConversation({ owner: id, requester: other, item: { donor: id, bookedBy: null } }), false);
});

test('nonparticipants cannot read support messages even if they know the conversation ID', async t => {
  const old = repo.findConversationById;
  t.after(() => { repo.findConversationById = old; });
  repo.findConversationById = async () => ({ _id: conv, kind: 'support', participants: [id] });
  await assert.rejects(assertParticipant(conv, other), { code: 'CHAT_FORBIDDEN' });
});

test('demo socket rejects sending before any database or broadcast operation', async () => {
  const handlers = {};
  const socket = { data: { userId: id, isDemo: true }, on(name, fn) { handlers[name] = fn; } };
  registerChatHandlers({}, socket);
  let ack;
  await handlers[SOCKET_EVENTS.SEND_MESSAGE]({ convId: conv, text: 'test' }, value => { ack = value; });
  assert.equal(ack.code, 'DEMO_READ_ONLY');
  assert.equal(ack.ok, false);
});

test('support claim uses atomic owner comparison and rejects a concurrent claim', async t => {
  mockTransaction(t);
  const oldFind = Conversation.findOne, oldUpdate = Conversation.findOneAndUpdate;
  t.after(() => { Conversation.findOne = oldFind; Conversation.findOneAndUpdate = oldUpdate; });
  Conversation.findOne = () => query({ _id: conv, owner: id, requester: id });
  Conversation.findOneAndUpdate = async (filter, update) => {
    assert.equal(filter.owner, id);
    assert.deepEqual(update.$set.participants, [other, id]);
    return null;
  };
  await assert.rejects(support.claimSupport(conv, other), { code: 'SUPPORT_ALREADY_ASSIGNED' });
});

test('only assigned admin can resolve a support request', async t => {
  mockTransaction(t);
  const old = Conversation.findOneAndUpdate;
  t.after(() => { Conversation.findOneAndUpdate = old; });
  Conversation.findOneAndUpdate = async filter => { assert.equal(filter.owner, other); assert.equal(filter.kind, 'support'); return null; };
  await assert.rejects(support.resolveSupport(conv, other), { code: 'SUPPORT_NOT_ASSIGNED' });
});

test('support resolution and its audit entry share a transaction; audit failure aborts it', async t => {
  const events = [];
  const session = mockTransaction(t, events);
  const oldUpdate = Conversation.findOneAndUpdate, oldLog = adminRepo.logAdminAction;
  t.after(() => { Conversation.findOneAndUpdate = oldUpdate; adminRepo.logAdminAction = oldLog; });
  Conversation.findOneAndUpdate = async (filter, _update, options) => {
    assert.equal(options.session, session);
    assert.equal(filter.owner, other);
    events.push('update');
    return { _id: conv, requester: id, subject: 'مشكلة' };
  };
  adminRepo.logAdminAction = async (entry, receivedSession) => {
    assert.equal(receivedSession, session);
    assert.equal(entry.action, 'SUPPORT_RESOLVE');
    assert.equal(entry.targetId, conv);
    assert.equal(entry.targetModel, 'Conversation');
    events.push('audit');
    throw new Error('audit unavailable');
  };
  await assert.rejects(support.resolveSupport(conv, other), /audit unavailable/);
  assert.deepEqual(events, ['update', 'audit', 'abort', 'end']);
});

test('support claim commits the assignment with its audit entry before returning chat data', async t => {
  const events = [];
  const session = mockTransaction(t, events);
  const oldFind = Conversation.findOne, oldUpdate = Conversation.findOneAndUpdate;
  const oldLog = adminRepo.logAdminAction, oldResponse = repo.findConversationById;
  t.after(() => {
    Conversation.findOne = oldFind; Conversation.findOneAndUpdate = oldUpdate;
    adminRepo.logAdminAction = oldLog; repo.findConversationById = oldResponse;
  });
  Conversation.findOne = () => query({ _id: conv, owner: id, requester: id, supportStatus: 'open', subject: 'مشكلة' });
  Conversation.findOneAndUpdate = async (filter, _update, options) => {
    assert.equal(filter.supportStatus, 'open');
    assert.equal(options.session, session); events.push('update');
    return { _id: conv };
  };
  adminRepo.logAdminAction = async (entry, receivedSession) => {
    assert.equal(entry.action, 'SUPPORT_CLAIM');
    assert.equal(receivedSession, session); events.push('audit');
  };
  repo.findConversationById = async () => {
    events.push('response');
    return { _id: conv, kind: 'support', participants: [id, other] };
  };
  assert.equal((await support.claimSupport(conv, other))._id, conv);
  assert.deepEqual(events, ['update', 'audit', 'commit', 'end', 'response']);
});

test('personal support filtering applies even to an admin; the inbox does not expose messages', async t => {
  const oldFind = Conversation.find, oldCount = Conversation.countDocuments;
  t.after(() => { Conversation.find = oldFind; Conversation.countDocuments = oldCount; });
  const filters = [];
  Conversation.find = filter => {
    filters.push(filter);
    return { populate() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [{ _id: conv, requester: { _id: id }, owner: { _id: id }, lastMessage: 'private contents' }] };
  };
  Conversation.countDocuments = async () => 1;
  const personal = await support.listSupport(id, false, 1);
  await support.listSupport(id, true, 1);
  assert.deepEqual(filters, [{ kind: 'support', requester: id }, { kind: 'support' }]);
  assert.equal('lastMessage' in personal.tickets[0], false);
  assert.equal(personal.tickets[0].assignedTo, null);
});

test('admin booking DTO retains queue order and account links', () => {
  const item = toAdminItem({ _id: conv, bookedBy: { _id: id, name: 'حاجز' }, waitlist: [{ user: { _id: other, name: 'التالي' }, joinedAt: new Date('2026-01-01') }] });
  assert.equal(item.bookedBy._id, id);
  assert.equal(item.waitlist[0].user._id, other);
  assert.equal(item.waitlist[0].position, 1);
});
