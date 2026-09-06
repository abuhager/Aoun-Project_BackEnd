import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import AppError from '../utils/AppError.js';

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

export const verifyFirebasePhoneToken = async (idToken: string): Promise<string> => {
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

export default { verifyFirebasePhoneToken };
