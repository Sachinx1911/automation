// एकदाच चालवायची स्क्रिप्ट: खराखुरा Chrome (Playwright automation नाही) एकाच
// विंडोत Gemini, Grok, Claude — तिन्ही tabs म्हणून उघडतो (सामायिक profile).
// तिन्ही tabs मध्ये manually login करा, नंतर विंडो बंद करून टर्मिनल मध्ये Enter
// दाबा -> सर्व sessions एकाच profile मध्ये कायमचे save होतात.
//
// खरा Chrome (automation-controlled नाही) वापरण्याचे कारण: Google/इतर साईट्स
// Playwright/automated ब्राउझरवरून login करू देत नाहीत ("This browser or app
// may not be secure" असा इशारा देतात). एकदा ह्या profile मध्ये खऱ्या Chrome ने
// login झाले, की नंतर automation तेच saved session (cookies) वापरून चॅट करू
// शकते — तिथे login flow पुन्हा येतच नाही.
//
// वापर:
//   node scripts/browser/login-setup.js

const { spawn } = require("child_process");
const fs = require("fs");
const readline = require("readline");
const { SHARED_PROFILE, URLS, assertConfigured } = require("./profile-paths");

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function findChrome() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  assertConfigured();

  const chromePath = findChrome();
  if (!chromePath) {
    console.error(
      "Google Chrome सापडला नाही. आधी https://www.google.com/chrome/ वरून इन्स्टॉल करा."
    );
    process.exit(1);
  }

  fs.mkdirSync(SHARED_PROFILE, { recursive: true });

  console.log("\nखराखुरा Chrome एका विंडोत Gemini, Grok, Claude — तिन्ही tabs सह उघडत आहे...");
  console.log("कृपया तिन्ही tabs मध्ये manually login करा (प्रत्येक tab वर क्लिक करून).\n");

  const child = spawn(
    chromePath,
    [
      `--user-data-dir=${SHARED_PROFILE}`,
      "--no-first-run",
      "--no-default-browser-check",
      URLS.gemini,
      URLS.grok,
      URLS.claude,
    ],
    { detached: true, stdio: "ignore" }
  );
  child.unref();

  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      "\nतिन्ही tabs मध्ये login पूर्ण झाल्यावर, ती Chrome विंडो पूर्णपणे बंद करा (महत्त्वाचे), मग इथे Enter दाबा... ",
      () => {
        rl.close();
        resolve();
      }
    );
  });

  console.log(`login session save झाले: ${SHARED_PROFILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
