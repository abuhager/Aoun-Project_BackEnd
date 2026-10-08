import AppError from './AppError.js';
export const isDemoAccount = (user: { isDemo?: unknown; email?: unknown }) => Boolean(user.isDemo)
  || (typeof user.email === 'string' && Boolean(process.env.DEMO_ADMIN_EMAIL?.trim())
    && user.email.toLowerCase() === process.env.DEMO_ADMIN_EMAIL?.trim().toLowerCase());
export const assertDemoWritable = (isDemo: boolean | undefined) => {
  if (isDemo) throw new AppError('حساب عرض تجريبي: يمكنك استكشاف الواجهة، لكن الحفظ والإرسال غير متاحين.', 403, 'DEMO_READ_ONLY');
};
