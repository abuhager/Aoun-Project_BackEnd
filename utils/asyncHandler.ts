import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRouteHandler = (
  request: Request,
  response: Response,
  next: NextFunction
) => unknown | Promise<unknown>;

const asyncHandler = (handler: AsyncRouteHandler): RequestHandler => (
  request,
  response,
  next
) => {
  void Promise.resolve(handler(request, response, next)).catch(next);
};

export = asyncHandler;
