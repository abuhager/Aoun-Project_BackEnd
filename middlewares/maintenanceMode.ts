const SystemSettings = require('../models/SystemSettings');
const AppError = require('../utils/AppError');
const {
  getBearerToken,
  resolveAccessIdentity,
} = require('./auth');

const ALLOWED_PATH_PREFIXES = Object.freeze([
  '/auth',
  '/settings/public',
]);

const isAllowedPath = (path = '') => ALLOWED_PATH_PREFIXES.some(
  (prefix) => path === prefix || path.startsWith(`${prefix}/`)
);

const createMaintenanceMode = ({
  getSettings = () => SystemSettings.getCached(),
  resolveIdentity = resolveAccessIdentity,
} = {}) => async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings?.maintenanceMode || isAllowedPath(req.path)) return next();

    const token = getBearerToken(req.headers.authorization);
    if (token) {
      try {
        const identity = await resolveIdentity(token);
        if (['admin', 'super_admin'].includes(identity.role)) return next();
      } catch {
        // خلال الصيانة لا نكشف سبب فشل جلسة المستخدم على مسار غير مسموح.
      }
    }

    res.setHeader('Retry-After', '300');
    return next(new AppError(
      'المنصة تحت الصيانة حالياً، حاول مرة أخرى بعد قليل 🛠️',
      503,
      'MAINTENANCE_MODE'
    ));
  } catch (error) {
    return next(error);
  }
};

module.exports = createMaintenanceMode();
module.exports.ALLOWED_PATH_PREFIXES = ALLOWED_PATH_PREFIXES;
module.exports.createMaintenanceMode = createMaintenanceMode;
module.exports.isAllowedPath = isAllowedPath;
