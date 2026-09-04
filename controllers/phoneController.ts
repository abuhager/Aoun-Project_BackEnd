// controllers/phoneController.js
// المسؤولية: استقبال طلبات التحقق من الهاتف عبر Firebase Phone Auth
// ✅ تم استبدال Twilio بـ Firebase
//
// ─── الـ Endpoints المتاحة ────────────────────────────────────
// POST /api/phone/verify-token  ← الجديد (Firebase idToken)
//
// ─── الـ Endpoints المحذوفة ───────────────────────────────────
// POST /api/phone/send-otp    ← محذوف (كان لـ Twilio)
// POST /api/phone/verify-otp  ← محذوف (كان لـ Twilio)
//
// ─── آلية عمل Frontend الجديدة ───────────────────────────────
// 1. أضف Firebase Client SDK للـ Frontend
// 2. استخدم signInWithPhoneNumber(auth, phone, recaptchaVerifier)
// 3. بعد تأكيد المستخدم للرمز: result.confirm(otp)
// 4. احصل على idToken: await result.user.getIdToken()
// 5. أرسل idToken لـ POST /api/phone/verify-token

const { verifyPhoneWithFirebase } = require('../services/phoneService');
import type { Request, Response } from 'express';

type ControllerError = {
  status?: unknown;
  code?: unknown;
  message?: unknown;
};

const normalizeControllerError = (error: unknown): ControllerError => (
  typeof error === 'object' && error !== null ? error : {}
);

// ─── POST /api/phone/verify-token ────────────────────────────
// Body: { idToken: string }  ← صادر من Firebase Client SDK
exports.verifyToken = async (req: Request, res: Response) => {
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

// ─── Deprecated: send-otp و verify-otp (كانا لـ Twilio) ──────
exports.sendOtp = (_req: Request, res: Response) =>
  res.status(410).json({
    msg:  'هذا الـ endpoint محذوف — الرجاء استخدام Firebase Phone Auth في الـ Frontend ثم أرسل idToken لـ /api/phone/verify-token',
    code: 'ENDPOINT_REMOVED',
    docs: 'https://firebase.google.com/docs/auth/web/phone-auth',
  });

exports.verifyOtp = (_req: Request, res: Response) =>
  res.status(410).json({
    msg:  'هذا الـ endpoint محذوف — الرجاء استخدام Firebase Phone Auth في الـ Frontend ثم أرسل idToken لـ /api/phone/verify-token',
    code: 'ENDPOINT_REMOVED',
    docs: 'https://firebase.google.com/docs/auth/web/phone-auth',
  });
