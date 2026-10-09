import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';
import AdminLog from '../models/AdminLog.js';
import SystemSettings from '../models/SystemSettings.js';
import userRepository from '../repositories/userRepository.js';
import runMongoTransaction from '../utils/mongoTransaction.js';

if (!process.env.MONGO_URI) throw new Error('MONGO_URI required');
const apply = process.argv.includes('--apply');
await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
try {
  const settings = await SystemSettings.getCached();
  const decisions = await AdminLog.aggregate([
    { $match: { action: { $in: ['PROMOTE', 'DEMOTE'] }, targetModel: 'User' } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $group: { _id: '$targetId', action: { $first: '$action' } } },
  ]);
  let eligible = 0; let updated = 0;
  for (const decision of decisions) {
    const candidate = await User.findOne({ _id: decision._id, trustLevelOverride: null }).select('_id');
    if (!candidate) continue;
    eligible += 1;
    if (!apply) continue;
    const changed = await runMongoTransaction(async session => {
      const current = await User.findOne({ _id: decision._id, trustLevelOverride: null }).session(session).select('_id');
      if (!current) return false;
      const latest = await AdminLog.findOne({ targetId: decision._id, targetModel: 'User', action: { $in: ['PROMOTE', 'DEMOTE'] } })
        .sort({ createdAt: -1, _id: -1 }).session(session).lean();
      if (!latest) return false;
      const level = latest.action === 'DEMOTE' ? 1 : 2;
      await userRepository.setTrustLevelAndQuota(current._id, level,
        level === 1 ? settings.defaultUserQuota : settings.level2Quota, level === 2, session);
      await userRepository.invalidateUserSession(current._id, session);
      return true;
    });
    if (changed) updated += 1;
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', eligible, updated }));
} finally { await mongoose.disconnect(); }
