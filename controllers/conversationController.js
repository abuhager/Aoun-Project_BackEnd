// controllers/conversationController.js
const svc = require('../services/conversationService');
const uid = (req) => (req.user._id || req.user.id).toString();

exports.listConversations  = async (req, res, next) => { try { res.json(await svc.listConversationsLogic(uid(req))); } catch (e) { next(e); } };
exports.openConversation   = async (req, res, next) => { try { res.json(await svc.openConversationLogic({ itemId: req.body.itemId, userId: uid(req) })); } catch (e) { next(e); } };
exports.getMessages        = async (req, res, next) => { try { res.json(await svc.getMessagesLogic({ conversationId: req.params.conversationId, userId: uid(req), io: req.io })); } catch (e) { next(e); } };
exports.sendMessage        = async (req, res, next) => { try { res.status(201).json(await svc.sendMessageLogic({ conversationId: req.params.conversationId, text: req.body.text, correlationId: req.body.correlationId, user: { id: uid(req), name: req.user.name }, io: req.io })); } catch (e) { next(e); } };
exports.markConversationRead = async (req, res, next) => { try { res.json(await svc.markConversationReadLogic({ conversationId: req.params.conversationId, userId: uid(req), io: req.io })); } catch (e) { next(e); } };
