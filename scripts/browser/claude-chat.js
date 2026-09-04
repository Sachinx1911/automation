// वापर (CLI): node claude-chat.js "इथे मजकूर"
// किंवा दुसऱ्या स्क्रिप्टमधून: const { chatClaude } = require("./claude-chat");
//
// तुमच्या आधीच बनवलेल्या, विशिष्ट Claude chat tab मध्ये मजकूर जसाच्या तसा पाठवतो
// (इथे Grok कडून आलेले उत्तर पाठवले जाते). या tab मध्ये तुम्ही आधीच सूचना दिलेल्या
// आहेत की अंतिम output कसे तयार करायचे — इथून आलेले उत्तर हेच अंतिम निकाल आहे.

const { runChat } = require("./chat-runner");
const { SHARED_PROFILE, URLS, assertConfigured } = require("./profile-paths");

async function chatClaude(text) {
  assertConfigured();
  return runChat({
    name: "claude",
    profileDir: SHARED_PROFILE,
    url: URLS.claude,
    prompt: text,
    headless: process.env.HEADLESS === "true",
    inputSelectors: [
      'div.ProseMirror[contenteditable="true"]',
      'div[data-placeholder][contenteditable="true"]',
      'div[aria-label="Write your prompt to Claude"]',
      'div[contenteditable="true"]',
    ],
    sendSelectors: [
      'button[aria-label="Send message"]:not([disabled])',
    ],
    responseSelectors: [
      // "font-claude-response" हा class खऱ्या उत्तराव्यतिरिक्त sidebar मधल्या
      // related-chat suggestion links मध्येही वापरला जातो (त्या <a> टॅगच्या आत
      // असतात) — म्हणून <a> च्या आतले वगळतो, फक्त प्रत्यक्ष chat उत्तर धरतो.
      'xpath=//div[contains(concat(" ", normalize-space(@class), " "), " font-claude-response ")][not(ancestor::a)]',
    ],
    // तुमच्या Claude tab ला सूचना दिलेली आहे की उत्तराच्या शेवटी "Done" लिहायचे —
    // तेच वापरून उत्तर नक्की कधी पूर्ण झाले हे ओळखतो (मध्ये web-search सारखा
    // थांबा आला तरी गोंधळ होत नाही, आणि उगाच जास्त वेळ थांबावे लागत नाही).
    completionMarker: "Done",
    // पेजवर एकाच वेळी फक्त एकच "Copy" बटण असते — शेवटच्या (नवीन) संदेशासाठी आपोआप
    // दिसते (hover लागत नाही). id ऐवजी data-testid वापरतो — id प्रत्येक वेळी
    // बदलते (React auto-generated), data-testid स्थिर असते.
    copyButtonSelector: '[data-testid="action-bar-copy"]',
  });
}

module.exports = { chatClaude };

if (require.main === module) {
  const text = process.argv[2];
  if (!text) {
    console.error("मजकूर द्यावा लागेल. वापर: node claude-chat.js \"...\"");
    process.exit(1);
  }
  chatClaude(text)
    .then((response) => process.stdout.write(response))
    .catch((err) => {
      console.error("Claude chat error:", err.message);
      process.exit(1);
    });
}
