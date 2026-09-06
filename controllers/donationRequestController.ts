import drService from '../services/donationRequestService.js';
import type { OfferInput, RequestCreateInput } from '../services/donationRequestService.js';
import asyncHandler from '../utils/asyncHandler.js';

export const getRequests = asyncHandler(async (req, res) => {
  const result = await drService.getDonationRequestsLogic(
    req.query,
    req.user?.id ?? null
  );
  res.json(result);
});

export const getMyRequests = asyncHandler(async (req, res) => {
  const result = await drService.getMyRequestsLogic(req.user!.id);
  res.json(result);
});

export const createRequest = asyncHandler(async (req, res) => {
  const result = await drService.createRequestLogic(req.body as RequestCreateInput, req.user!.id);
  res.status(201).json(result);
});

export const cancelRequest = asyncHandler(async (req, res) => {
  const result = await drService.cancelRequestLogic(req.params.id, req.user!.id);
  res.json(result);
});

export const getRequestById = asyncHandler(async (req, res) => {
  const request = await drService.getRequestByIdLogic(
    req.params.id,
    req.user?.id ?? null,
    req.user?.role ?? 'user'
  );
  res.json({ request });
});

export const submitOffer = asyncHandler(async (req, res) => {
  const result = await drService.submitOfferLogic(
    req.params.id,
    req.user!.id,
    req.body as OfferInput,
    req.file ?? undefined
  );
  res.status(201).json(result);
});

export const getOffers = asyncHandler(async (req, res) => {
  const result = await drService.getOffersLogic(req.params.id, req.user!.id);
  res.json(result);
});

export const acceptOffer = asyncHandler(async (req, res) => {
  const result = await drService.acceptOfferLogic(
    req.params.id,
    req.params.offerId,
    req.user!.id
  );
  res.json(result);
});

export const rejectOffer = asyncHandler(async (req, res) => {
  const result = await drService.rejectOfferLogic(
    req.params.id,
    req.params.offerId,
    req.user!.id
  );
  res.json(result);
});

export const withdrawOffer = asyncHandler(async (req, res) => {
  const result = await drService.withdrawOfferLogic(
    req.params.id,
    req.params.offerId,
    req.user!.id
  );
  res.json(result);
});

export default { getRequests, getMyRequests, createRequest, cancelRequest, getRequestById, submitOffer, getOffers, acceptOffer, rejectOffer, withdrawOffer };
