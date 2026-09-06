import { verifyPhoneWithFirebase } from '../services/phoneService.js';
import type { Request, Response } from 'express';

type ControllerError = {
  status?: unknown;
  code?: unknown;
  message?: unknown;
};

const normalizeControllerError = (error: unknown): ControllerError => (
  typeof error === 'object' && error !== null ? error : {}
);

export const verifyToken = async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({
        msg:  'idToken مطلوب — أرسله من Firebase بعد تأكيد OTP',
        code: 'MISSING_ID_TOKEN',
      });
    }

    // ✅ الشرط الصحيح: phoneVerified وليس trustLevel
    // مستخدم Level 2 قد يغيّر رقمه → يحتاج إعادة تحقق
    if (req.user!.phoneVerified) {
      return res.status(400).json({
        msg:  'رقمك محقق بالفعل ✅',
        code: 'ALREADY_VERIFIED',
      });
    }

    const { phone } = await verifyPhoneWithFirebase(req.user!.id, idToken);

    return res.status(200).json({
      msg:             'تم التحقق بنجاح 🎉 يمكنك الآن حجز العناصر',
      phone,
      requiresRefresh: true,
    });

  } catch (error: unknown) {
    const err = normalizeControllerError(error);
    const status = typeof err.status === 'number' && Number.isInteger(err.status)
      ? err.status
      : 500;
    const errorCode = typeof err.code === 'string' ? err.code : null;
    const errorMessage = typeof err.message === 'string'
      ? err.message
      : 'تعذر التحقق من الهاتف حالياً';
    const isFeatureDisabled = errorCode === 'PHONE_VERIFICATION_DISABLED';
    const isSafeError = status < 500 || isFeatureDisabled;
    return res.status(status).json({
      msg:  isSafeError ? errorMessage : 'تعذر التحقق من الهاتف حالياً',
      code: isSafeError ? (errorCode ?? 'PHONE_VERIFICATION_FAILED') : 'SERVER_ERROR',
    });
  }
};

export const sendOtp = (_req: Request, res: Response) =>
  res.status(410).json({
    msg:  'هذا الـ endpoint محذوف — الرجاء استخدام Firebase Phone Auth في الـ Frontend ثم أرسل idToken لـ /api/phone/verify-token',
    code: 'ENDPOINT_REMOVED',
    docs: 'https://firebase.google.com/docs/auth/web/phone-auth',
  });

export const verifyOtp = (_req: Request, res: Response) =>
  res.status(410).json({
    msg:  'هذا الـ endpoint محذوف — الرجاء استخدام Firebase Phone Auth في الـ Frontend ثم أرسل idToken لـ /api/phone/verify-token',
    code: 'ENDPOINT_REMOVED',
    docs: 'https://firebase.google.com/docs/auth/web/phone-auth',
  });

export default { verifyToken, sendOtp, verifyOtp };
