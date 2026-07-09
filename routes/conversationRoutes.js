const express = require("express");
const auth = require("../middlewares/auth");
const controller = require("../controllers/conversationController");

const router = express.Router();

router.use(auth.requireAuth);

router
  .route("/")
  .get(controller.listConversations)
  .post(controller.openConversation);

// Read-only history endpoint. There is intentionally no POST here —
// sending a message goes through the "send_message" socket event only.
router
  .route("/:conversationId/messages")
  .get(controller.getMessages);

router
  .route("/:conversationId/read")
  .put(controller.markConversationRead);

module.exports = router;
