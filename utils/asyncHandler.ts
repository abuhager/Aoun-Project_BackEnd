import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type AounRequest = Request<
  Record<string, string>,
  unknown,
  Record<string, unknown>,
  Record<string, string | undefined>
>;

type AsyncRouteHandler = (
  request: AounRequest,
  response: Response,
  next: NextFunction
) => unknown | Promise<unknown>;

const asyncHandler = (handler: AsyncRouteHandler): RequestHandler => (
  request,
  response,
  next
) => {
  void Promise.resolve(handler(request as AounRequest, response, next)).catch(next);
};

export default asyncHandler;
