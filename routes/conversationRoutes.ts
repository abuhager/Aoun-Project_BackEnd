import express from "express";
import auth from "../middlewares/auth.js";
import controller from "../controllers/conversationController.js";
import validateBody from '../middlewares/validateBody.js';
import validateObjectId from '../middlewares/validateObjectId.js';

const router = express.Router();

router.use(auth.requireAuth);

router.get('/unread-count', controller.getUnreadCount);

router
  .route("/")
  .get(controller.listConversations)
  .post(validateBody('openConversation'), controller.openConversation);

// Read-only history endpoint. There is intentionally no POST here —
// sending a message goes through the "send_message" socket event only.
router
  .route("/:conversationId/messages")
  .all(validateObjectId('conversationId'))
  .get(controller.getMessages);

router
  .route("/:conversationId/read")
  .all(validateObjectId('conversationId'))
  .put(controller.markConversationRead);

export default router;
