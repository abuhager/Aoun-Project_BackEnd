const AppError = require('./AppError');

const INTERNAL_ERROR_MESSAGE =
  'حدث خطأ داخلي في الخادم. يرجى المحاولة لاحقاً.';

const isHttpErrorStatus = (value) =>
  Number.isInteger(value) && value >= 400 && value <= 599;

/**
 * يحوّل أي Error إلى عقد HTTP ثابت ومناسب للعرض.
 * يُرجع metadata يحتاجها الـ middleware للتسجيل، وجسم الاستجابة المتوافق
 * مع الواجهات القديمة (msg) والجديدة (message).
 */
const buildErrorResponse = (
  error,
  {
    requestId,
    isProduction = process.env.NODE_ENV === 'production',
  } = {}
) => {
  const isAppError = error instanceof AppError;
  const requestedStatus = isAppError ? error.statusCode : error?.status;
  const statusCode = isHttpErrorStatus(requestedStatus) ? requestedStatus : 500;
  const isOperational = isAppError && error.isOperational === true;
  const originalMessage =
    typeof error?.message === 'string' && error.message.trim()
      ? error.message
      : INTERNAL_ERROR_MESSAGE;
  const message =
    isProduction && (!isOperational || statusCode >= 500)
      ? INTERNAL_ERROR_MESSAGE
      : originalMessage;

  const body = {
    status: statusCode >= 500 ? 'error' : 'fail',
    message,
    msg: message,
    code: isAppError ? error.code : 'INTERNAL_SERVER_ERROR',
    requestId,
  };

  if (!isProduction && error?.stack) {
    body.stack = error.stack;
  }

  return {
    statusCode,
    isOperational,
    body,
  };
};

module.exports = {
  INTERNAL_ERROR_MESSAGE,
  buildErrorResponse,
};
