// तिन्ही AI च्या chat URLs खरंच उघडतात का ते तपासते.
// (फक्त वाचते — कोणताही संदेश पाठवत नाही, काहीही बदलत नाही.)
//
// का: URL जुनी/चुकीची झाली तर साईट गुपचूप "नवीन chat" वर नेते आणि automation
// भलत्याच रिकाम्या chat मध्ये संदेश टाकत राहते. ते आधीच पकडण्यासाठी.
//
// वापर:  node scripts/browser/check-urls.js

const path = require("path");
const { chromium } = require("patchright");
const { SHARED_PROFILE, URLS } = require("./profile-paths");

const OUTPUT_DIR = path.join(__dirname, "..", "..", "output");

async function main() {
  const context = await chromium.launchPersistentContext(SHARED_PROFILE, {
    channel: "chrome",
    headless: false,
    viewport: null,
  });

  const page = context.pages().length ? context.pages()[0] : await context.newPage();
  let anyProblem = false;

  for (const [name, url] of Object.entries(URLS)) {
    process.stdout.write(`\n=== ${name} ===\n`);
    try {
      await page.goto(url, { waitUntil: "load", timeout: 45000 });
      await page.waitForTimeout(5000);

      const landed = page.url();
      // query/hash सोडून तुलना — साईट स्वतः ?rid=... वगैरे जोडू शकते
      const same = landed.split("?")[0].replace(/\/$/, "") === url.split("?")[0].replace(/\/$/, "");

      const info = await page.evaluate(() => {
        const t = (document.body.innerText || "").slice(0, 4000);
        return {
          notFound: /conversation not found|chat not found|couldn'?t find|does not exist/i.test(t),
          loggedOut: /sign in|log in|continue with google|create account/i.test(t.slice(0, 1500)),
          // संभाषणात आधीचे संदेश दिसतायत का (रिकामी/नवी chat नाही ना)
          hasHistory:
            document.querySelectorAll("article").length > 0 ||
            document.querySelectorAll('[data-testid*="message"]').length > 0 ||
            document.querySelectorAll('[class*="message"]').length > 3,
        };
      });

      console.log(`  हवी होती : ${url}`);
      console.log(`  पोहोचलो  : ${landed}`);
      console.log(`  तीच chat उघडली? ${same ? "होय ✅" : "नाही ⚠️"}`);
      console.log(`  "not found" संदेश? ${info.notFound ? "होय ⚠️" : "नाही ✅"}`);
      console.log(`  login आहे?        ${info.loggedOut ? "नाही ⚠️" : "होय ✅"}`);
      console.log(`  जुने संदेश दिसतात? ${info.hasHistory ? "होय ✅" : "नाही ⚠️"}`);

      if (!same || info.notFound || info.loggedOut || !info.hasHistory) {
        anyProblem = true;
        console.log(`  >> ${name} ची URL/login तपासा.`);
      }

      await page
        .screenshot({ path: path.join(OUTPUT_DIR, `check-${name}.png`) })
        .catch(() => {});
    } catch (err) {
      anyProblem = true;
      console.log(`  उघडता आली नाही: ${err.message}`);
    }
  }

  console.log(
    anyProblem
      ? "\nकाही URLs मध्ये अडचण दिसते — वरचे स्क्रीनशॉट output/check-*.png मध्ये आहेत.\n"
      : "\nतिन्ही URLs व्यवस्थित उघडतात. ✅\n"
  );

  await context.close();
}

main().catch((err) => {
  console.error("check-urls error:", err.message);
  process.exit(1);
});
