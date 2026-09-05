const DISABLED_RESPONSE = Object.freeze({
  msg: 'التحقق من الهاتف متوقف مؤقتاً',
  code: 'PHONE_VERIFICATION_DISABLED',
});

const isPhoneVerificationEnabled = (env = process.env) =>
  String(env.PHONE_VERIFICATION_ENABLED ?? 'false').trim().toLowerCase() === 'true';

const requirePhoneVerificationEnabled = (_req: Request, res: Response, next: NextFunction) => {
  if (isPhoneVerificationEnabled()) return next();
  return res.status(503).json(DISABLED_RESPONSE);
};

module.exports = {
  DISABLED_RESPONSE,
  isPhoneVerificationEnabled,
  requirePhoneVerificationEnabled,
};
import type { NextFunction, Request, Response } from 'express';
