import type { Request, Response, NextFunction } from 'express';
import SystemSettings from '../models/SystemSettings.js';
import AppError from '../utils/AppError.js';
export default async function donationRequestsFeature(_req: Request, _res: Response, next: NextFunction) {
  try {
    if ((await SystemSettings.getCached()).donationRequestsEnabled === false) {
      throw new AppError('طلبات التبرع متوقفة مؤقتاً بقرار الإدارة. بيانات الطلبات محفوظة.', 403, 'DONATION_REQUESTS_DISABLED');
    }
    next();
  } catch (error) { next(error); }
}
