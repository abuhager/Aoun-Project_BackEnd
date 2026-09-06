import mongoose from 'mongoose';
import type { NextFunction, Request, Response } from 'express';

/**
 * validateObjectId('id')           → يتحقق من req.params.id
 * validateObjectId('id', 'userId') → يتحقق من param متعدد
 */
const validateObjectId = (...params: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    for (const param of params) {
      const value = req.params[param];
      const normalizedValue = Array.isArray(value) ? value[0] : value;
      if (normalizedValue && !mongoose.Types.ObjectId.isValid(normalizedValue)) {
        const message = `المعرّف "${param}" غير صحيح`;
        return res.status(400).json({
          status:    'fail',
          message,
          msg:       message,
          code:      'INVALID_ID',
          field:     param,
          requestId: req.id ?? req.headers?.['x-request-id'] ?? null,
        });
      }
    }
    next();
  };

export default validateObjectId;
