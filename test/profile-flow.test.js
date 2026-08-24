const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-that-is-long-enough-123456';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-12345';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '30d';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

const authService = require('../services/authService');
const leaderboardService = require('../services/leaderboardService');
const profileRepository = require('../repositories/profileRepository');
const userRepository = require('../repositories/userRepository');
const SystemSettings = require('../models/SystemSettings');
const User = require('../models/User');
const validateBody = require('../middlewares/validateBody');
const { buildGamificationProfile } = require('../utils/gamification');

const runValidation = (schemaName, body) => new Promise((resolve) => {
  const req = { body };
  const response = { statusCode: 200, payload: null };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(payload) { response.payload = payload; resolve({ req, response }); },
  };
  validateBody(schemaName)(req, res, () => resolve({ req, response }));
});

const safeUser = (overrides = {}) => ({
  _id: '507f1f77bcf86cd799439011',
  name: 'Test User',
  email: 'test@example.com',
  phone: '+962791234567',
  phoneVerified: true,
  avatar: '',
  role: 'user',
  trustScore: 70,
  trustLevel: 2,
  quota: 4,
  totalDonations: 3,
  isVerified: true,
  isVerifiedStudent: false,
  promotedByAdmin: false,
  isBanned: false,
  isFrozen: false,
  badges: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

test('gamification normalizes invalid scores and clamps progress', () => {
  const invalid = buildGamificationProfile('not-a-number', -4);
  assert.equal(invalid.trustScore, 0);
  assert.equal(invalid.totalDonations, 0);
  assert.equal(invalid.level, 1);
  assert.equal(invalid.progress, 0);

  const top = buildGamificationProfile(999, 12);
  assert.equal(top.level, 5);
  assert.equal(top.progress, 100);
  assert.equal(top.pointsToNext, null);
});

test('unchanged phone keeps verification and trust level', async (t) => {
  const originals = {
    getCached: SystemSettings.getCached,
    findState: userRepository.findProfileUpdateState,
    findPhone: userRepository.findByPhoneExcluding,
    updateUser: userRepository.updateUser,
  };
  t.after(() => {
    SystemSettings.getCached = originals.getCached;
    userRepository.findProfileUpdateState = originals.findState;
    userRepository.findByPhoneExcluding = originals.findPhone;
    userRepository.updateUser = originals.updateUser;
  });

  const current = safeUser();
  let persisted = null;
  SystemSettings.getCached = async () => ({ defaultUserQuota: 2 });
  userRepository.findProfileUpdateState = async () => current;
  userRepository.findByPhoneExcluding = async () => {
    throw new Error('duplicate lookup must not run for an unchanged phone');
  };
  userRepository.updateUser = async (_id, updates) => {
    persisted = { ...updates };
    return { ...current, ...updates };
  };

  const result = await authService.updateMeLogic(
    current._id,
    { name: 'Updated User', phone: current.phone }
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(persisted, { name: 'Updated User' });
  assert.equal(result.body.user.phoneVerified, true);
  assert.equal(result.body.user.trustLevel, 2);
});

test('changing a phone-only proof downgrades level until re-verification', async (t) => {
  const originals = {
    getCached: SystemSettings.getCached,
    findState: userRepository.findProfileUpdateState,
    findPhone: userRepository.findByPhoneExcluding,
    updateUser: userRepository.updateUser,
  };
  t.after(() => {
    SystemSettings.getCached = originals.getCached;
    userRepository.findProfileUpdateState = originals.findState;
    userRepository.findByPhoneExcluding = originals.findPhone;
    userRepository.updateUser = originals.updateUser;
  });

  const current = safeUser();
  let persisted = null;
  SystemSettings.getCached = async () => ({ defaultUserQuota: 2 });
  userRepository.findProfileUpdateState = async () => current;
  userRepository.findByPhoneExcluding = async () => null;
  userRepository.updateUser = async (_id, updates) => {
    persisted = { ...updates };
    return { ...current, ...updates };
  };

  const result = await authService.updateMeLogic(
    current._id,
    { phone: '+962781234567' }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(persisted.phoneVerified, false);
  assert.equal(persisted.trustLevel, 1);
  assert.equal(persisted.quota, 2);
});

test('public profile returns the privacy-safe activity contract', async (t) => {
  const originals = {
    getCached: SystemSettings.getCached,
    findProfile: userRepository.findPublicProfile,
    findDonations: profileRepository.findPublicDonations,
    findReceived: profileRepository.findPublicReceivedItems,
    countDonations: profileRepository.countPublicDonations,
    countReceived: profileRepository.countPublicReceivedItems,
    ratingSummary: profileRepository.getRatingSummary,
  };
  t.after(() => {
    SystemSettings.getCached = originals.getCached;
    userRepository.findPublicProfile = originals.findProfile;
    profileRepository.findPublicDonations = originals.findDonations;
    profileRepository.findPublicReceivedItems = originals.findReceived;
    profileRepository.countPublicDonations = originals.countDonations;
    profileRepository.countPublicReceivedItems = originals.countReceived;
    profileRepository.getRatingSummary = originals.ratingSummary;
  });

  const deliveredAt = new Date('2026-05-03T00:00:00.000Z');
  SystemSettings.getCached = async () => ({ profilePageSize: 10 });
  userRepository.findPublicProfile = async () => safeUser();
  profileRepository.findPublicDonations = async () => [{
    _id: 'donation', title: 'Book', category: 'كتب', status: 'تم التسليم',
    imageUrl: 'https://example.com/book.jpg', createdAt: deliveredAt, deliveredAt,
  }];
  profileRepository.findPublicReceivedItems = async () => [{
    _id: 'received', title: 'Desk', category: 'أثاث', status: 'تم التسليم',
    imageUrl: 'https://example.com/desk.jpg', createdAt: deliveredAt, deliveredAt,
  }];
  profileRepository.countPublicDonations = async () => 11;
  profileRepository.countPublicReceivedItems = async () => 3;
  profileRepository.getRatingSummary = async () => ({ totalRatings: 4, averageRating: 8.5 });

  const result = await authService.getPublicProfileLogic(safeUser()._id, 1);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.stats.averageRating, 8.5);
  assert.equal(result.body.stats.donationsCount, 11);
  assert.equal(result.body.pagination.totalDonationPages, 2);
  assert.equal(result.body.donations[0].imageUrl, 'https://example.com/book.jpg');
  assert.equal(result.body.received[0].createdAt, deliveredAt);
  assert.equal(Object.hasOwn(result.body.user, 'email'), false);
  assert.equal(Object.hasOwn(result.body.user, 'phone'), false);
});

test('legacy users and every active role remain eligible for public profile and leaderboard', async (t) => {
  const originalFindOne = User.findOne;
  const filters = [];
  t.after(() => {
    User.findOne = originalFindOne;
  });

  User.findOne = (filter) => {
    filters.push(filter);
    return {
      select() { return this; },
      lean() { return Promise.resolve(null); },
    };
  };

  await userRepository.findPublicProfile(safeUser()._id);
  await userRepository.findLeaderboardUser(safeUser()._id);

  assert.equal(filters.length, 2);
  for (const filter of filters) {
    assert.deepEqual(filter.isBanned, { $ne: true });
    assert.deepEqual(filter.isFrozen, { $ne: true });
    assert.equal(filter.isVerified, true);
  }
  assert.equal(Object.hasOwn(filters[1], 'role'), false);
});

test('leaderboard rank uses the same deterministic tie breakers', async (t) => {
  const originals = {
    findUser: userRepository.findLeaderboardUser,
    countAhead: userRepository.countLeaderboardUsersAhead,
  };
  t.after(() => {
    userRepository.findLeaderboardUser = originals.findUser;
    userRepository.countLeaderboardUsersAhead = originals.countAhead;
  });

  userRepository.findLeaderboardUser = async () => ({
    _id: safeUser()._id,
    trustScore: 80,
    totalDonations: 7,
  });
  userRepository.countLeaderboardUsersAhead = async (user) => {
    assert.equal(user.trustScore, 80);
    assert.equal(user.totalDonations, 7);
    return 4;
  };

  const result = await leaderboardService.getUserRank(safeUser()._id);
  assert.equal(result.eligible, true);
  assert.equal(result.rank, 5);
  assert.equal(result.trustScore, 80);
  assert.equal(result.totalDonations, 7);
});

test('ineligible leaderboard users return a normal state instead of a 404 error', async (t) => {
  const original = userRepository.findLeaderboardUser;
  t.after(() => {
    userRepository.findLeaderboardUser = original;
  });

  userRepository.findLeaderboardUser = async () => null;

  const result = await leaderboardService.getUserRank(safeUser()._id);
  assert.deepEqual(result, {
    eligible: false,
    reason: 'لوحة المتصدرين مخصصة للمستخدمين المفعّلين غير المحظورين',
  });
});

test('leaderboard list and personal rank both require authentication', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../routes/leaderboard.js'),
    'utf8'
  );
  assert.match(
    source,
    /router\.get\('\/'\s*,\s*meLimiter\s*,\s*requireAuth\s*,\s*leaderboardController\.getLeaderboard/
  );
  assert.match(
    source,
    /router\.get\('\/me'\s*,\s*meLimiter\s*,\s*requireAuth\s*,\s*leaderboardController\.getUserRank/
  );
  assert.doesNotMatch(source, /publicLimiter/);
});

test('profile repositories use the real Item and Rating fields', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../repositories/profileRepository.js'),
    'utf8'
  );
  assert.match(source, /bookedBy/);
  assert.match(source, /تم التسليم/);
  assert.match(source, /imageUrl/);
  assert.match(source, /ratee/);
  assert.doesNotMatch(source, /recipient:/);
  assert.doesNotMatch(source, /rated:/);
});

test('avatar-only profile requests pass body validation; empty requests are rejected by controller', async () => {
  const { response } = await runValidation('updateMe', {});
  assert.equal(response.statusCode, 200);

  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../controllers/authController.js'),
    'utf8'
  );
  assert.match(controllerSource, /Object\.keys\(updates\)\.length === 0 && !req\.file/);
  assert.match(controllerSource, /NO_PROFILE_CHANGES/);

  const settingsServiceSource = fs.readFileSync(
    path.join(__dirname, '../services/settingsService.js'),
    'utf8'
  );
  assert.match(settingsServiceSource, /maxAvatarSizeMb:\s*projected\.maxAvatarSizeMb \?\? 5/);
});
