const express = require("express");
const auth = require("../middlewares/auth");
const controller = require("../controllers/conversationController");
const validateBody = require('../middlewares/validateBody');
const validateObjectId = require('../middlewares/validateObjectId');

const router = express.Router();

router.use(auth.requireAuth);

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

module.exports = router;
