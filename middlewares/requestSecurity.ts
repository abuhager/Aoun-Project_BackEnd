import AppError from '../utils/AppError.js';
import { isOriginAllowed } from '../config/cors.js';
import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'same-site', 'none']);

const setPrivateNoStore = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
};

/**
 * حماية endpoints التي تنشئ/تستهلك cookies من CSRF وLogin CSRF:
 * - متصفح cross-site يُرفض من Sec-Fetch-Site/Origin.
 * - JSON فقط، لذلك HTML forms البسيطة لا تستطيع تنفيذ الطلب.
 * - عملاء server-to-server بلا Origin يبقون مدعومين عند إرسال JSON.
 */
const requireTrustedBrowserRequest = (req: Request, _res: Response, next: NextFunction) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const fetchSite = String(req.headers['sec-fetch-site'] ?? '').toLowerCase();
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
    return next(new AppError(
      'تم رفض طلب صادر من موقع غير موثوق',
      403,
      'CROSS_SITE_REQUEST_BLOCKED'
    ));
  }

  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!isOriginAllowed(origin)) {
        return next(new AppError(
          'تم رفض Origin غير موثوق',
          403,
          'UNTRUSTED_REQUEST_ORIGIN'
        ));
      }
    } catch {
      return next(new AppError(
        'تعذر التحقق من Origin بسبب إعدادات الخادم',
        500,
        'CORS_MISCONFIGURED'
      ));
    }
  }

  if (!req.is('application/json')) {
    return next(new AppError(
      'نوع المحتوى غير مدعوم؛ أرسل application/json',
      415,
      'JSON_CONTENT_TYPE_REQUIRED'
    ));
  }

  return next();
};

export { requireTrustedBrowserRequest, setPrivateNoStore };
export default {
  requireTrustedBrowserRequest,
  setPrivateNoStore,
};
