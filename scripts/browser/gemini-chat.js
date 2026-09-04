// वापर (CLI): node gemini-chat.js "इथे मजकूर"
// किंवा दुसऱ्या स्क्रिप्टमधून: const { chatGemini } = require("./gemini-chat");
//
// तुमच्या आधीच बनवलेल्या, विशिष्ट Gemini chat tab मध्ये मजकूर जसाच्या तसा
// (कोणताही wrapper प्रॉम्प्ट न लावता) पाठवतो — कारण त्या conversation मध्ये
// तुम्ही आधीच सूचना/संदर्भ दिलेला आहे.

const { runChat } = require("./chat-runner");
const { SHARED_PROFILE, URLS, assertConfigured } = require("./profile-paths");

async function chatGemini(text) {
  assertConfigured();
  return runChat({
    name: "gemini",
    profileDir: SHARED_PROFILE,
    url: URLS.gemini,
    prompt: text,
    headless: process.env.HEADLESS === "true",
    inputSelectors: [
      'div.ql-editor[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[aria-label="Enter a prompt here"]',
    ],
    sendSelectors: [
      'button.send-button:not([disabled])',
      'button[aria-label="Send message"]:not([disabled])',
    ],
    responseSelectors: [
      "message-content .markdown",
      "model-response .markdown",
      "div.model-response-text",
    ],
  });
}

module.exports = { chatGemini };

if (require.main === module) {
  const text = process.argv[2];
  if (!text) {
    console.error("मजकूर द्यावा लागेल. वापर: node gemini-chat.js \"...\"");
    process.exit(1);
  }
  chatGemini(text)
    .then((response) => process.stdout.write(response))
    .catch((err) => {
      console.error("Gemini chat error:", err.message);
      process.exit(1);
    });
}
