// integrations/smsService.js
// المسؤولية: التحقق من رموز OTP عبر Firebase Admin SDK
// ✅ تم استبدال Twilio بـ Firebase Phone Auth
//    السبب: Firebase مجاني (10,000 تحقق/شهر) ويدعم الأرقام الأردنية بشكل كامل
//
// ─── آلية العمل الجديدة ──────────────────────────────────────
// 1. Frontend: يستخدم Firebase Client SDK لإرسال OTP مباشرة للمستخدم
// 2. Frontend: بعد إدخال المستخدم للرمز، يحصل على idToken من Firebase
// 3. Frontend: يرسل idToken للـ Backend عبر /api/phone/verify-token
// 4. Backend (هنا): يتحقق من idToken باستخدام Firebase Admin SDK
//    ويستخرج رقم الهاتف المؤكد منه مباشرة

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth }                       = require('firebase-admin/auth');
const AppError                          = require('../utils/AppError');

// ─── تهيئة Firebase Admin (مرة واحدة فقط) ───────────────────
const initFirebase = () => {
  if (getApps().length > 0) return;

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase غير مضبوط — تأكد من وجود FIREBASE_PROJECT_ID و FIREBASE_CLIENT_EMAIL و FIREBASE_PRIVATE_KEY في .env'
    );
  }

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
};

// ─── التحقق من idToken وإرجاع رقم الهاتف ─────────────────────
// idToken: يأتي من Firebase Client SDK بعد تأكيد OTP
// يُرجع: رقم الهاتف بصيغة E.164 (مثل +96279xxxxxxx)
exports.verifyFirebasePhoneToken = async (idToken) => {
  initFirebase();

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(idToken, true);
  } catch {
    throw new AppError(
      'رمز التحقق من الهاتف غير صالح أو منتهي الصلاحية',
      401,
      'INVALID_PHONE_TOKEN'
    );
  }

  if (decoded.firebase?.sign_in_provider !== 'phone') {
    throw new AppError(
      'يجب استخدام Firebase Phone Auth للتحقق من الرقم',
      400,
      'INVALID_PHONE_AUTH_PROVIDER'
    );
  }

  // decoded.phone_number موجود فقط إذا تم التوثيق عبر Phone Auth
  if (!decoded.phone_number) {
    throw new AppError(
      'الـ Token لا يحتوي على رقم هاتف — تأكد من استخدام Firebase Phone Auth',
      400,
      'NO_PHONE_IN_TOKEN'
    );
  }

  return decoded.phone_number; // مثال: "+96279xxxxxxx"
};
