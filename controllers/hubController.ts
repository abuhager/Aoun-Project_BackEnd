import hubService from '../services/hubService.js';
import asyncHandler from '../utils/asyncHandler.js';

export const getHubs = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.getAllHubs();
  res.status(statusCode).json(body);
});

export const getAllAdmin = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.getAllHubsAdmin();
  res.status(statusCode).json(body);
});

export const createHub = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.createHub(req.body, req.user!.id);
  res.status(statusCode).json(body);
});

export const updateHub = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.updateHub(req.params.id, req.body, req.user!.id);
  res.status(statusCode).json(body);
});

export const deactivateHub = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.deactivateHub(req.params.id, req.user!.id);
  res.status(statusCode).json(body);
});

export const reactivateHub = asyncHandler(async (req, res) => {
  const { statusCode, body } = await hubService.reactivateHub(req.params.id, req.user!.id);
  res.status(statusCode).json(body);
});

export default { getHubs, getAllAdmin, createHub, updateHub, deactivateHub, reactivateHub };
