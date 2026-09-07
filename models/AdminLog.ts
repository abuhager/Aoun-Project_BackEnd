import mongoose from 'mongoose';

const adminLogSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'targetModel',
    default: null,
  },
  targetModel: {
    type: String,
    enum: ['User', 'Item', 'Report', 'SafeHub', null],
    default: null,
  },

  action: {
    type: String,
    enum: [
      'PROMOTE',
      'DEMOTE',
      'BAN',
      'UNBAN',
      'REPORT_ACTION',
      'ITEM_HIDE',
      'HUB_MANAGE',
      'SETTINGS_UPDATE',
    ],
    required: true,
  },

  reason:     { type: String, default: null },
  targetName: { type: String, default: null },
  adminNote:  { type: String, default: null },

  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

adminLogSchema.index({ createdAt: -1 }, { name: 'createdAt_desc' });
adminLogSchema.index({ adminId: 1, createdAt: -1 }, { name: 'adminId_createdAt_desc' });
adminLogSchema.index({ action: 1, createdAt: -1 }, { name: 'action_createdAt_desc' });

const AdminLog = mongoose.model('AdminLog', adminLogSchema);
export default AdminLog;
