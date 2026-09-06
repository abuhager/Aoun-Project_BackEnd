import User from '../models/User.js';
import type {
  EntityId,
  PersistedDocument,
  RepositoryPayload,
} from './repositoryTypes.js';

type LeaderboardUser = {
  _id: EntityId;
  trustScore: number;
  totalDonations: number;
};

// ✅ [DUP-REPO-01] ثوابت مشتركة — تعديل واحد يُحدِّث كل الدوال
const BASE_USER_FIELDS =
  'name email phone avatar role trustScore trustLevel ' +
  'quota isVerified isVerifiedStudent isBanned isFrozen ' + // ← isFrozen هنا للجميع
  'totalDonations badges createdAt';

const USER_FIELDS  = BASE_USER_FIELDS + ' phoneVerified';       // للمستخدم نفسه
const ADMIN_FIELDS = BASE_USER_FIELDS + ' reportedBy';          // للأدمن

const activeAccountEligibility = () => ({
  isVerified: true,
  // الحسابات القديمة قد لا تحتوي هذين الحقلين؛ نمنع true فقط.
  isBanned: { $ne: true },
  isFrozen: { $ne: true },
});

const leaderboardEligibility = () => ({
  ...activeAccountEligibility(),
});

export const findByEmail = (
  email: string,
  options: { selectOtp?: boolean } = {}
) => {
  let query = User.findOne({ email });
  if (options.selectOtp) {
    query = query.select('+verificationOtp +verificationOtpExpiry +otpAttempts');
  }
  return query;
};

export const findByEmailWithPassword = (email: string) =>
  User.findOne({ email }).select(
    '+password +verificationOtpExpiry +otpAttempts +sessionVersion'
  );

export const createUser = (data: RepositoryPayload) => User.create(data);

export const saveUser = (user: PersistedDocument) => user.save();

export const findById = (id: EntityId) =>
  User.findById(id).select(USER_FIELDS);

export const findByIdWithRefreshToken = (id: EntityId) =>
  User.findById(id).select(
    '+refreshToken +previousRefreshToken +previousRefreshTokenExpire ' +
    '+sessionVersion +sessionIssuedAt'
  );

export const findAuthStateById = (id: EntityId) =>
  User.findById(id)
    .select(
      'name role trustLevel phoneVerified isVerified isBanned isFrozen ' +
      '+sessionVersion +sessionIssuedAt'
    )
    .lean();

export const findByResetToken = (hashedToken: string) =>
  User.findOne({
    resetPasswordToken:  hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  }).select('+password');

export const updateUser = (id: EntityId, update: RepositoryPayload) =>
  User.findByIdAndUpdate(id, update, { returnDocument: 'after' });

export const beginUserSession = (id: EntityId) =>
  User.findByIdAndUpdate(
    id,
    {
      $inc: { sessionVersion: 1 },
      $set: { sessionIssuedAt: new Date() },
      $unset: {
        refreshToken: 1,
        previousRefreshToken: 1,
        previousRefreshTokenExpire: 1,
      },
    },
    { returnDocument: 'after' }
  ).select('+sessionVersion');

export const storeRefreshToken = (
  id: EntityId,
  sessionVersion: number,
  refreshHash: string
) =>
  User.findOneAndUpdate(
    { _id: id, sessionVersion },
    { $set: { refreshToken: refreshHash } },
    { returnDocument: 'after' }
  ).select('+sessionVersion');

export const rotateRefreshToken = (
  userId: EntityId,
  sessionVersion: number,
  oldHash: string,
  newHash: string,
  newIssuedAt: Date,
  previousTokenExpire: Date
) =>
  User.findOneAndUpdate(
    { _id: userId, sessionVersion, refreshToken: oldHash },
    {
      $set: {
        refreshToken: newHash,
        previousRefreshToken: oldHash,
        previousRefreshTokenExpire: previousTokenExpire,
        sessionIssuedAt: newIssuedAt,
      },
    },
    { returnDocument: 'after' }
  ).select('+sessionVersion');

export const findByIdWithSession = (id: EntityId) =>
  User.findById(id).select('+refreshToken +sessionVersion +sessionIssuedAt');

export const findByIdForAdmin = (id: EntityId) =>
  User.findById(id).select(ADMIN_FIELDS);

export const setTrustLevelAndQuota = (id: EntityId, level: number, quota: number) =>
  User.findByIdAndUpdate(
    id,
    { trustLevel: level, quota, promotedByAdmin: true },
    { returnDocument: 'after' }
  ).select(
    'name email phone avatar role trustLevel trustScore quota totalDonations ' +
    'isVerified isVerifiedStudent phoneVerified isBanned isFrozen banReason ' +
    'createdAt updatedAt'
  );

export const setTrustLevel = (id: EntityId, level: number) =>
  User.findByIdAndUpdate(id, { trustLevel: level }, { returnDocument: 'after' })
    .select('name email trustLevel isVerifiedStudent phoneVerified isBanned');

export const findByIdWithPassword = (id: EntityId) =>
  User.findById(id).select('+password');

export const findProfileUpdateState = (id: EntityId) =>
  User.findById(id)
    .select(
      'phone phoneVerified trustLevel isVerifiedStudent promotedByAdmin avatar +avatarPublicId'
    )
    .lean();

export const findAndIncrementOtpAttempts = (email: string, maxAttempts = 5) =>
  User.findOneAndUpdate(
    {
      email,
      isVerified: false,
      $or: [
        { otpAttempts: { $lt: maxAttempts } },
        { otpAttempts: { $exists: false } },
      ],
    },
    { $inc: { otpAttempts: 1 } },
    {
      returnDocument: 'after',
      select: '+verificationOtp +verificationOtpExpiry +otpAttempts +trustLevel +role +quota',
    }
  ).lean();

export const findEmailStatus = (email: string) =>
  User.findOne({ email }).select('isVerified otpAttempts').lean();

export const atomicVerifyAndComplete = (
  userId: EntityId,
  currentOtpHash: string,
  updateData: RepositoryPayload
) =>
  User.findOneAndUpdate(
    { _id: userId, verificationOtp: currentOtpHash },
    updateData,
    { returnDocument: 'after' }
  ).select('+sessionVersion');

export const resetOtpAttemptsAfterLock = (email: string) =>
  User.updateOne(
    { email },
    {
      $unset: { verificationOtp: 1, verificationOtpExpiry: 1 },
      $set:   { otpAttempts: 0 },
    }
  );

export const findByPhoneExcluding = (phone: string, excludeUserId: EntityId) =>
  User.findOne({
    phone,
    phoneVerified: true,
    _id: { $ne: excludeUserId },
  }).select('_id').lean();

export const consumeResetToken = (hashedToken: string, hashedPassword: string) =>
  User.findOneAndUpdate(
    {
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
    },
    {
      $set: { password: hashedPassword, sessionIssuedAt: new Date() },
      $inc: { sessionVersion: 1 },
      $unset: {
        resetPasswordToken: 1,
        resetPasswordExpire: 1,
        refreshToken: 1,
        previousRefreshToken: 1,
        previousRefreshTokenExpire: 1,
      },
    },
    { returnDocument: 'after' }
  ).select('_id +sessionVersion');

export const changePassword = (userId: EntityId, hashedPassword: string) =>
  User.findByIdAndUpdate(
    userId,
    {
      $set: { password: hashedPassword, sessionIssuedAt: new Date() },
      $inc: { sessionVersion: 1 },
      $unset: {
        refreshToken: 1,
        previousRefreshToken: 1,
        previousRefreshTokenExpire: 1,
      },
    },
    { returnDocument: 'after' }
  ).select('_id +sessionVersion');

export const invalidateUserSession = (userId: EntityId) =>
  User.findByIdAndUpdate(userId, {
    $inc: { sessionVersion: 1 },
    $set: { sessionIssuedAt: new Date() },
    $unset: {
      refreshToken: 1,
      previousRefreshToken: 1,
      previousRefreshTokenExpire: 1,
    },
  });

export const findPublicProfile = (id: EntityId) =>
  User.findOne({
    _id: id,
    ...activeAccountEligibility(),
  })
    .select(
      'name avatar role trustScore trustLevel totalDonations badges ' +
      'isVerifiedStudent createdAt'
    )
    .lean();

export const findLeaderboardUsers = (limit: number) =>
  User.find(leaderboardEligibility())
    .select('name avatar trustScore totalDonations')
    .sort({ trustScore: -1, totalDonations: -1, _id: 1 })
    .limit(limit)
    .lean();

export const findLeaderboardUser = (userId: EntityId) =>
  User.findOne({ _id: userId, ...leaderboardEligibility() })
    .select('trustScore totalDonations')
    .lean();

export const countLeaderboardUsersAhead = (user: LeaderboardUser) =>
  User.countDocuments({
    ...leaderboardEligibility(),
    $or: [
      { trustScore: { $gt: user.trustScore } },
      {
        trustScore: user.trustScore,
        totalDonations: { $gt: user.totalDonations },
      },
      {
        trustScore: user.trustScore,
        totalDonations: user.totalDonations,
        _id: { $lt: user._id },
      },
    ],
  });

export default { findByEmail, findByEmailWithPassword, createUser, saveUser, findById, findByIdWithRefreshToken, findAuthStateById, findByResetToken, updateUser, beginUserSession, storeRefreshToken, rotateRefreshToken, findByIdWithSession, findByIdForAdmin, setTrustLevelAndQuota, setTrustLevel, findByIdWithPassword, findProfileUpdateState, findAndIncrementOtpAttempts, findEmailStatus, atomicVerifyAndComplete, resetOtpAttemptsAfterLock, findByPhoneExcluding, consumeResetToken, changePassword, invalidateUserSession, findPublicProfile, findLeaderboardUsers, findLeaderboardUser, countLeaderboardUsersAhead };
