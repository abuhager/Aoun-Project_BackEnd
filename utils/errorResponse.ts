import AppError from './AppError.js';

const INTERNAL_ERROR_MESSAGE =
  'حدث خطأ داخلي في الخادم. يرجى المحاولة لاحقاً.';

const isHttpErrorStatus = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 400 && Number(value) <= 599;

type ErrorResponseOptions = {
  requestId?: string;
  isProduction?: boolean;
};

type ErrorBody = {
  status: string;
  message: string;
  msg: string;
  code: string;
  requestId?: string;
  stack?: string;
};

type ErrorResponse = {
  statusCode: number;
  isOperational: boolean;
  body: ErrorBody;
};

type ErrorLike = {
  status?: unknown;
  message?: unknown;
  stack?: unknown;
};

const asErrorLike = (error: unknown): ErrorLike =>
  typeof error === 'object' && error !== null ? error as ErrorLike : {};

/** يحوّل أي خطأ إلى عقد HTTP ثابت وآمن للواجهة. */
const buildErrorResponse = (
  error: unknown,
  {
    requestId,
    isProduction = process.env.NODE_ENV === 'production',
  }: ErrorResponseOptions = {}
): ErrorResponse => {
  const isAppError = error instanceof AppError;
  const errorLike = asErrorLike(error);
  const requestedStatus = isAppError ? error.statusCode : errorLike.status;
  const statusCode = isHttpErrorStatus(requestedStatus) ? requestedStatus : 500;
  const isOperational = isAppError && error.isOperational === true;
  const originalMessage =
    typeof errorLike.message === 'string' && errorLike.message.trim()
      ? errorLike.message
      : INTERNAL_ERROR_MESSAGE;
  const message =
    isProduction && (!isOperational || statusCode >= 500)
      ? INTERNAL_ERROR_MESSAGE
      : originalMessage;

  const body: ErrorBody = {
    status: statusCode >= 500 ? 'error' : 'fail',
    message,
    msg: message,
    code: isAppError ? error.code : 'INTERNAL_SERVER_ERROR',
    ...(requestId ? { requestId } : {}),
  };

  if (!isProduction && typeof errorLike.stack === 'string') {
    body.stack = errorLike.stack;
  }

  return { statusCode, isOperational, body };
};

const errorResponse = {
  INTERNAL_ERROR_MESSAGE,
  buildErrorResponse,
};

export { INTERNAL_ERROR_MESSAGE, buildErrorResponse };
export default errorResponse;
