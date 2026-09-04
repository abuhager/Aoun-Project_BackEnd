const AdminLog = require('../models/AdminLog');
const SystemSettings = require('../models/SystemSettings');
const AppError = require('../utils/AppError');
const { SOCKET_EVENTS } = require('../socket/contracts');
const { emitToAll } = require('../socket/emitter');
const {
  EDITABLE_SETTING_FIELDS,
  assertSettingsInvariants,
} = require('../dtos/settingsDto');
import type { EntityId, ServicePayload, ServiceRecord } from './serviceTypes';
import { getErrorMessage } from './serviceTypes';

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

const editableFieldSet = new Set<string>(EDITABLE_SETTING_FIELDS);

const normalizeList = (
  values: unknown,
  { lowercase = false }: { lowercase?: boolean } = {}
) => {
  if (!Array.isArray(values)) return values;
  const normalized = values
    .map((value) => String(value).trim())
    .filter(Boolean)
    .map((value) => (lowercase ? value.toLowerCase() : value));
  return [...new Map(normalized.map((value) => [value.toLocaleLowerCase('en'), value])).values()];
};

const normalizeSettingValue = (key: string, value: unknown) => {
  if (['categories', 'locations', 'reportReasons'].includes(key)) return normalizeList(value);
  if (key === 'universityEmailDomains') return normalizeList(value, { lowercase: true });
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return key === 'contactEmail' ? trimmed.toLowerCase() : trimmed;
  }
  return value;
};

const valuesEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const toPublicSettings = (settings: ServiceRecord | null | undefined) => {
  const source = settings ?? {};
  const projected = Object.fromEntries(
    PUBLIC_SETTING_FIELDS.map((field) => [field, source[field]])
  );

  return {
    categories: Array.isArray(projected.categories) ? projected.categories : [],
    locations: Array.isArray(projected.locations) ? projected.locations : [],
    reportReasons: Array.isArray(projected.reportReasons) ? projected.reportReasons : [],
    platformName: typeof projected.platformName === 'string' ? projected.platformName : 'عون',
    contactEmail: typeof projected.contactEmail === 'string'
      ? projected.contactEmail
      : 'aoun.help.center@gmail.com',
    maxAvatarSizeMb: typeof projected.maxAvatarSizeMb === 'number'
      ? projected.maxAvatarSizeMb
      : 5,
    requireHubForBooking: Boolean(projected.requireHubForBooking),
    maintenanceMode: Boolean(projected.maintenanceMode),
    updatedAt: projected.updatedAt
      ? new Date(String(projected.updatedAt)).toISOString()
      : null,
  };
};

exports.getSettings = () => SystemSettings.getCached();

exports.getPublicSettings = async () => (
  toPublicSettings(await SystemSettings.getCached() as ServiceRecord)
);

exports.updateSettings = async (updates: ServicePayload, actorId: EntityId) => {
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
      publicSettings: toPublicSettings(current as ServiceRecord),
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
  const publicSettings = toPublicSettings(updated as ServiceRecord);

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
  } catch (error: unknown) {
    console.error('[Settings Audit] تعذر تسجيل تعديل الإعدادات:', getErrorMessage(error));
  }

  return { settings: updated, publicSettings, changedFields };
};

exports.PUBLIC_SETTING_FIELDS = PUBLIC_SETTING_FIELDS;
exports.normalizeSettingValue = normalizeSettingValue;
exports.toPublicSettings = toPublicSettings;
