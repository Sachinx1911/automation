// वापर (CLI): node grok-chat.js "इथे मजकूर"
// किंवा दुसऱ्या स्क्रिप्टमधून: const { chatGrok } = require("./grok-chat");
//
// तुमच्या आधीच बनवलेल्या, विशिष्ट Grok chat tab मध्ये मजकूर जसाच्या तसा पाठवतो
// (इथे Gemini कडून आलेले उत्तर पाठवले जाते).

const { runChat } = require("./chat-runner");
const { SHARED_PROFILE, URLS, assertConfigured } = require("./profile-paths");

async function chatGrok(text) {
  assertConfigured();
  return runChat({
    name: "grok",
    profileDir: SHARED_PROFILE,
    url: URLS.grok,
    prompt: text,
    headless: process.env.HEADLESS === "true",
    inputSelectors: [
      'textarea[aria-label="Ask Grok anything"]',
      'textarea[aria-label*="Ask Grok" i]',
      'div[contenteditable="true"][role="textbox"]',
    ],
    sendSelectors: [
      'button[aria-label="Send message" i]:not([disabled])',
      'button[type="submit"]:not([disabled])',
    ],
    responseSelectors: [
      'div[class*="message-bubble"]',
      'div[class*="response-content"]',
      "article",
    ],
  });
}

module.exports = { chatGrok };

if (require.main === module) {
  const text = process.argv[2];
  if (!text) {
    console.error("मजकूर द्यावा लागेल. वापर: node grok-chat.js \"...\"");
    process.exit(1);
  }
  chatGrok(text)
    .then((response) => process.stdout.write(response))
    .catch((err) => {
      console.error("Grok chat error:", err.message);
      process.exit(1);
    });
}
