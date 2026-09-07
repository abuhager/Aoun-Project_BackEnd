import User from '../models/User.js';
import SystemSettings from '../models/SystemSettings.js';
import { escapeHtml, getClientOrigin } from './emailService.js';
import sendEmailClient from '../utils/sendEmail.js';
import type { CriticalNotificationEmailPayload } from './outboxService.js';

const toAbsoluteClientUrl = (actionUrl: string | null): string | null => {
  if (!actionUrl) return null;
  const clientOrigin = getClientOrigin();
  const target = new URL(actionUrl, clientOrigin);
  return target.origin === clientOrigin ? target.toString() : null;
};

export const sendCriticalNotificationEmail = async (
  payload: CriticalNotificationEmailPayload
) => {
  let recipient = payload.email ?? null;
  if (!recipient) {
    const user = await User.findById(payload.userId).select('email').lean();
    recipient = user?.email ?? null;
  }
  if (!recipient) throw new Error('OUTBOX_RECIPIENT_NOT_FOUND');

  const settings = await SystemSettings.getCached();
  const platformName = settings?.platformName ?? 'عون';
  const safePlatformName = escapeHtml(platformName);
  const safeTitle = escapeHtml(payload.title);
  const safeBody = escapeHtml(payload.body);
  const absoluteActionUrl = toAbsoluteClientUrl(payload.actionUrl);
  const safeActionUrl = absoluteActionUrl ? escapeHtml(absoluteActionUrl) : null;

  await sendEmailClient.sendEmail({
    email: recipient,
    subject: payload.title,
    message: `
      <div dir="rtl" style="font-family:sans-serif;line-height:1.8;color:#191c1d;max-width:560px;margin:auto;">
        <h2 style="color:#c0392b;margin-bottom:8px;">${safeTitle}</h2>
        <p style="margin:0 0 16px;">${safeBody}</p>
        ${safeActionUrl
          ? `<a href="${safeActionUrl}"
                style="display:inline-block;padding:10px 20px;background:#01696f;
                       color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
               فتح منصة ${safePlatformName}
             </a>`
          : ''}
        <hr style="border:none;border-top:1px solid #edeeef;margin:20px 0;" />
        <p style="font-size:11px;color:#747775;">
          هذا إشعار إداري رسمي من منصة ${safePlatformName}.
        </p>
      </div>
    `,
  });
};

export default { sendCriticalNotificationEmail };
