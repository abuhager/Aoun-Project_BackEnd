import { sendCustomEmail } from '../services/emailService.js';

type EmailOptions = {
  email: string;
  subject: string;
  message: string;
  replyTo?: string;
};

const sendEmail = async (options: EmailOptions) => sendCustomEmail({
  to: options.email,
  subject: options.subject,
  htmlContent: options.message,
  ...(options.replyTo ? { replyTo: options.replyTo } : {}),
});

const fireSendEmail = (options: EmailOptions): Promise<void> => sendEmail(options).catch(() => {
  console.error('[fireSendEmail] تعذر تجهيز رسالة البريد');
});

const emailClient = Object.assign(sendEmail, { sendEmail, fireSendEmail });

export default emailClient;

export { sendEmail };

export { fireSendEmail };
