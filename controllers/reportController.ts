import reportService from '../services/reportService.js';
import type { CreateReportInput } from '../services/reportService.js';
import asyncHandler from '../utils/asyncHandler.js';
import { toReportResponse } from '../dtos/reportDto.js';

export const createReport = asyncHandler(async (req, res) => {
  const report = await reportService.createReport(req.user!.id, req.body as CreateReportInput);

  return res.status(201).json({
    msg: 'تم إرسال البلاغ ✅',
    report: toReportResponse(report),
  });
});

export const submitAppeal = asyncHandler(async (req, res) => {
  const report = await reportService.submitAppeal(
    req.params.id,
    req.user!.id,
    req.body as { appealText: string }
  );

  return res.status(200).json({
    msg: 'تم تقديم الطعن ✅',
    report: toReportResponse(report),
  });
});

export default { createReport, submitAppeal };
