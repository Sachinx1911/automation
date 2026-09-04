// Gemini च्या sidebar मधल्या "Recents" chats ची यादी + प्रत्येकीची खरी URL.
// (फक्त वाचते — कोणताही संदेश पाठवत नाही, काहीही बदलत नाही.)
//
// का: Gemini च्या chat URLs जुन्या झाल्या की गुपचूप /app वर (नव्या रिकाम्या
// chat वर) ढकलले जाते. तेव्हा इथून खरी URL घ्यायची आणि profile-paths.js
// मध्ये टाकायची.
//
// वापर:  node scripts/browser/list-gemini-chats.js

const { chromium } = require("patchright");
const { SHARED_PROFILE } = require("./profile-paths");

async function main() {
  const context = await chromium.launchPersistentContext(SHARED_PROFILE, {
    channel: "chrome",
    headless: false,
    viewport: null,
  });

  const page = context.pages().length ? context.pages()[0] : await context.newPage();
  await page.goto("https://gemini.google.com/app", { waitUntil: "load" });
  await page.waitForTimeout(6000);

  // आधी सोपा मार्ग: sidebar मधले प्रत्येक conversation एक <a href> असेल तर
  // क्लिक न करताच URL मिळते.
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/app/"]')]
      .map((a) => ({ name: (a.innerText || "").trim().split("\n")[0], href: a.href }))
      .filter((x) => x.name && /\/app\/[0-9a-f]{6,}/i.test(x.href))
  );

  if (links.length) {
    console.log("\n=== Gemini chats (href वरून) ===");
    links.forEach((l, i) => {
      console.log(`\n  ${i + 1}. ${l.name}`);
      console.log(`     URL: ${l.href}`);
    });
  } else {
    // sidebar मधले items <a> नसतील (button/div) — तर एक-एक क्लिक करून
    // पत्ता बदलतो का बघतो.
    console.log("\n(href सापडले नाहीत — एक-एक उघडून URL घेतो)\n");

    const itemSel =
      '[data-test-id="conversation"], [role="listitem"], .conversation-title, .conversation';
    const count = await page.locator(itemSel).count().catch(() => 0);
    console.log(`sidebar मध्ये ${count} conversations दिसतात.\n`);

    for (let i = 0; i < Math.min(count, 15); i++) {
      try {
        const item = page.locator(itemSel).nth(i);
        const name = (await item.innerText().catch(() => "")).trim().split("\n")[0];
        await item.click({ timeout: 8000 });
        await page.waitForTimeout(2500);
        console.log(`  ${i + 1}. ${name || "(नाव नाही)"}`);
        console.log(`     URL: ${page.url()}`);
      } catch (err) {
        console.log(`  ${i + 1}. उघडता आले नाही: ${err.message}`);
      }
    }
  }

  console.log("\nयोग्य URL scripts/browser/profile-paths.js मध्ये gemini: च्या पुढे टाका.\n");
  await context.close();
}

main().catch((err) => {
  console.error("list-gemini-chats error:", err.message);
  process.exit(1);
});
