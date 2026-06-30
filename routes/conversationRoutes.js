const express = require("express");
const auth = require("../middlewares/auth");
const controller = require("../controllers/conversationController");

const router = express.Router();

router.use(auth.requireAuth);

router
  .route("/")
  .get(controller.listConversations)
  .post(controller.openConversation);

router
  .route("/:conversationId/messages")
  .get(controller.getMessages)
  .post(controller.sendMessage);

router
  .route("/:conversationId/read")
  .put(controller.markConversationRead);

module.exports = router;