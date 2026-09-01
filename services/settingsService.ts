const AdminLog = require('../models/AdminLog');
const SystemSettings = require('../models/SystemSettings');
const AppError = require('../utils/AppError');
const { SOCKET_EVENTS } = require('../socket/contracts');
const { emitToAll } = require('../socket/emitter');
const {
  EDITABLE_SETTING_FIELDS,
  assertSettingsInvariants,
} = require('../dtos/settingsDto');

const PUBLIC_SETTING_FIELDS = Object.freeze([
  'categories',
  'locations',
  'reportReasons',
  'platformName',
  'contactEmail',
  'maxAvatarSizeMb',
  'requireHubForBooking',
  'maintenanceMode',
  'updatedAt',
]);

const editableFieldSet = new Set(EDITABLE_SETTING_FIELDS);

const normalizeList = (values, { lowercase = false } = {}) => {
  if (!Array.isArray(values)) return values;
  const normalized = values
    .map((value) => String(value).trim())
    .filter(Boolean)
    .map((value) => (lowercase ? value.toLowerCase() : value));
  return [...new Map(normalized.map((value) => [value.toLocaleLowerCase('en'), value])).values()];
};

const normalizeSettingValue = (key, value) => {
  if (['categories', 'locations', 'reportReasons'].includes(key)) return normalizeList(value);
  if (key === 'universityEmailDomains') return normalizeList(value, { lowercase: true });
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return key === 'contactEmail' ? trimmed.toLowerCase() : trimmed;
  }
  return value;
};

const valuesEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const toPublicSettings = (settings) => {
  const source = settings ?? {};
  const projected = Object.fromEntries(
    PUBLIC_SETTING_FIELDS.map((field) => [field, source[field]])
  );

  return {
    categories: projected.categories ?? [],
    locations: projected.locations ?? [],
    reportReasons: projected.reportReasons ?? [],
    platformName: projected.platformName ?? 'عون',
    contactEmail: projected.contactEmail ?? 'aoun.help.center@gmail.com',
    maxAvatarSizeMb: projected.maxAvatarSizeMb ?? 5,
    requireHubForBooking: Boolean(projected.requireHubForBooking),
    maintenanceMode: Boolean(projected.maintenanceMode),
    updatedAt: projected.updatedAt
      ? new Date(projected.updatedAt).toISOString()
      : null,
  };
};

exports.getSettings = () => SystemSettings.getCached();

exports.getPublicSettings = async () => toPublicSettings(await SystemSettings.getCached());

exports.updateSettings = async (updates, actorId) => {
  const unknownFields = Object.keys(updates).filter((key) => !editableFieldSet.has(key));
  if (unknownFields.length > 0) {
    throw new AppError(
      `حقول إعدادات غير مسموحة: ${unknownFields.join(', ')}`,
      422,
      'UNKNOWN_SETTINGS_FIELDS'
    );
  }

  const sanitized = Object.fromEntries(
    Object.entries(updates).map(([key, value]) => [key, normalizeSettingValue(key, value)])
  );
  if (Object.keys(sanitized).length === 0) {
    throw new AppError('لا توجد حقول صالحة للتحديث', 400, 'EMPTY_SETTINGS_UPDATE');
  }

  const current = await SystemSettings.getInstance();
  const merged = { ...current, ...sanitized };
  assertSettingsInvariants(merged);

  const changedFields = Object.keys(sanitized).filter(
    (key) => !valuesEqual(current[key], sanitized[key])
  );
  if (changedFields.length === 0) {
    return {
      settings: current,
      publicSettings: toPublicSettings(current),
      changedFields,
    };
  }

  const changedUpdates = Object.fromEntries(
    changedFields.map((key) => [key, sanitized[key]])
  );
  const updated = await SystemSettings.findOneAndUpdate(
    { _id: 'global' },
    { $set: changedUpdates },
    {
      returnDocument: 'after',
      runValidators: true,
      context: 'query',
    }
  ).lean();

  if (!updated) {
    throw new AppError('تعذر العثور على إعدادات النظام', 500, 'SETTINGS_NOT_FOUND');
  }

  SystemSettings.invalidateCache(changedFields);
  const publicSettings = toPublicSettings(updated);

  emitToAll(SOCKET_EVENTS.SETTINGS_UPDATED, publicSettings);

  try {
    await AdminLog.create({
      adminId: actorId,
      action: 'SETTINGS_UPDATE',
      targetId: null,
      targetModel: null,
      targetName: 'إعدادات المنصة',
      reason: `تعديل ${changedFields.length} إعداد/إعدادات`,
      meta: {
        changedFields,
        changes: Object.fromEntries(
          changedFields.map((key) => [key, { before: current[key], after: updated[key] }])
        ),
      },
    });
  } catch (error) {
    console.error('[Settings Audit] تعذر تسجيل تعديل الإعدادات:', error.message);
  }

  return { settings: updated, publicSettings, changedFields };
};

exports.PUBLIC_SETTING_FIELDS = PUBLIC_SETTING_FIELDS;
exports.normalizeSettingValue = normalizeSettingValue;
exports.toPublicSettings = toPublicSettings;
