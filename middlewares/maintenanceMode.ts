import SystemSettings from '../models/SystemSettings.js';
import AppError from '../utils/AppError.js';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getBearerToken, resolveAccessIdentity } from './auth.js';

const ALLOWED_PATH_PREFIXES = Object.freeze([
  '/auth',
  '/settings/public',
]);

const isAllowedPath = (path = '') => ALLOWED_PATH_PREFIXES.some(
  (prefix) => path === prefix || path.startsWith(`${prefix}/`)
);

type MaintenanceSettings = { maintenanceMode?: boolean };
type MaintenanceOptions = {
  getSettings?: () => Promise<MaintenanceSettings | null>;
  resolveIdentity?: (token: string) => Promise<Express.AuthenticatedUser>;
};

const createMaintenanceMode = ({
  getSettings = () => SystemSettings.getCached(),
  resolveIdentity = resolveAccessIdentity,
}: MaintenanceOptions = {}): RequestHandler => async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
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
};const maintenanceMode = createMaintenanceMode();
export default maintenanceMode;

export { ALLOWED_PATH_PREFIXES };

export { createMaintenanceMode };

export { isAllowedPath };
