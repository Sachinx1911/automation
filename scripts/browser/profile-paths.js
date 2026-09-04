// तिन्ही AI साठी एकच, सामायिक (shared) Chrome profile — त्यामुळे सर्व एकाच
// ब्राउझर विंडोमध्ये वेगवेगळ्या tabs म्हणून उघडतात (३ वेगळ्या विंडो उघडत नाहीत).
// एकदा ह्या profile मध्ये manually login केले (तिन्ही सेवांमध्ये) की पुढच्या
// प्रत्येक automated run मध्ये तेच login session (cookies) वापरले जाते.

const path = require("path");

const PROFILE_ROOT = path.join(__dirname, "..", "..", ".browser-profiles");
const SHARED_PROFILE = path.join(PROFILE_ROOT, "shared");

// ==========================================================================
// महत्त्वाचे — इथे तुमच्या स्वतःच्या, आधीच बनवलेल्या विशिष्ट chat tabs च्या
// लिंक्स टाका (नवीन chat सुरू करायचे नाही — त्याच conversation मध्ये दरवेळी
// संदेश जोडायचे आहेत, कारण त्या conversation मध्ये तुम्ही आधीच सूचना/संदर्भ दिलेला आहे).
//
// लिंक अशी मिळेल: त्या विशिष्ट chat वर जा -> ब्राउझरच्या ॲड्रेस बार मधली पूर्ण URL कॉपी करा.
// उदा. Gemini: https://gemini.google.com/app/xxxxxxxxxxxxxxxx
//      Grok:   https://grok.com/c/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
//      Claude: https://claude.ai/chat/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
// ==========================================================================
const URLS = {
  gemini: "https://gemini.google.com/app/da06efc242925252",
  grok: "https://grok.com/c/5b8debc2-8368-45ac-a24c-c6d74dcc33a3",
  claude: "https://claude.ai/chat/887f9197-e276-4491-8685-8dea9bdae1da",
};

function assertConfigured() {
  const missing = Object.entries(URLS)
    .filter(([, url]) => !url || url.startsWith("PASTE_YOUR_"))
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(
      `scripts/browser/profile-paths.js मध्ये या AI च्या chat tab लिंक्स अजून टाकलेल्या नाहीत: ${missing.join(", ")}`
    );
  }
}

module.exports = { PROFILE_ROOT, SHARED_PROFILE, URLS, assertConfigured };
