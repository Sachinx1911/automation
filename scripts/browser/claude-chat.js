// वापर (CLI): node claude-chat.js "इथे मजकूर"
// किंवा दुसऱ्या स्क्रिप्टमधून: const { chatClaude } = require("./claude-chat");
//
// तुमच्या आधीच बनवलेल्या, विशिष्ट Claude chat tab मध्ये मजकूर जसाच्या तसा पाठवतो
// (इथे Grok कडून आलेले उत्तर पाठवले जाते). या tab मध्ये तुम्ही आधीच सूचना दिलेल्या
// आहेत की अंतिम output कसे तयार करायचे — इथून आलेले उत्तर हेच अंतिम निकाल आहे.

const { runChat, closeAllContexts } = require("./chat-runner");
const { SHARED_PROFILE, URLS, assertConfigured } = require("./profile-paths");

async function chatClaude(text) {
  assertConfigured();
  return runChat({
    name: "claude",
    profileDir: SHARED_PROFILE,
    url: URLS.claude,
    prompt: text,
    headless: process.env.HEADLESS === "true",
    // संदेश टाइप करणे/पाठवणे यासाठी accessibility (aria-label) आणि data-testid
    // वापरतो — हे CSS class पेक्षा खूप स्थिर असतात.
    inputSelectors: [
      'div[aria-label="Write your prompt to Claude"]',
      '[data-testid="chat-input"]',
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"]',
    ],
    sendSelectors: [
      'button[aria-label="Send message"]:not([disabled])',
      '[data-testid="chat-input-send"]:not([disabled])',
    ],

    // ---- उत्तर वाचणे: DOM नाही, थेट network ----
    // Claude चे उत्तर या endpoint वर SSE (text/event-stream) म्हणून येते:
    //   POST /api/organizations/{orgId}/chat_conversations/{chatId}/completion
    // (हे probe-claude.js ने प्रत्यक्ष तपासून काढले आहे.)
    //
    // यामुळे यापैकी काहीही लागत नाही: responseSelectors, font-claude-response,
    // Copy बटण, hover, scroll, clipboard परवानगी. शिवाय मिळणारा मजकूर कच्चा
    // markdown असतो (DOM मधल्या innerText मध्ये formatting हरवत होते), आणि
    // "उत्तर संपले" हे stop_reason वरून नक्की कळते — अंदाज लावावा लागत नाही.
    completionUrlPattern: /\/chat_conversations\/[^/]+\/completion(\?|$)/,

    // तुमच्या Claude chat ला सूचना दिलेली आहे की उत्तराच्या शेवटी "Done" लिहायचे.
    // उत्तर कधी संपले हे आता stop_reason वरून कळते, म्हणून marker ची त्यासाठी
    // गरज नाही — पण अंतिम मजकुरातून तो शब्द काढून टाकण्यासाठी ठेवला आहे.
    completionMarker: "Done",

    // usageLimitPatterns ची गरज उरली नाही — Claude स्वतः त्याच stream मध्ये
    // `message_limit` इव्हेंट पाठवतो ({type, resetsAt, remaining}). तो
    // "within_limit" नसेल तर chat-runner आपोआप CREDIT_LIMIT error टाकतो.
  });
}

module.exports = { chatClaude };

if (require.main === module) {
  const text = process.argv[2];
  if (!text) {
    console.error("मजकूर द्यावा लागेल. वापर: node claude-chat.js \"...\"");
    process.exit(1);
  }
  // CLI टेस्ट म्हणून चालवताना शेवटी ब्राउझर बंद करणे आवश्यक — नाहीतर उत्तर
  // मिळूनही process संपत नाही (server मध्ये मात्र तो मुद्दाम उघडा ठेवला जातो,
  // कारण पुढच्या प्रत्येक title साठी तोच tab पुन्हा वापरायचा असतो).
  const started = Date.now();
  chatClaude(text)
    .then(async (response) => {
      process.stdout.write(response + "\n");
      console.error(`\n(वेळ: ${((Date.now() - started) / 1000).toFixed(1)}s)`);
      await closeAllContexts();
    })
    .catch(async (err) => {
      console.error("Claude chat error:", err.message);
      await closeAllContexts();
      process.exit(1);
    });
}
