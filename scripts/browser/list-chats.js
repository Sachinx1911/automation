// Claude मधल्या तुमच्या सर्व chats ची यादी + प्रत्येकीची पूर्ण URL दाखवते.
// (फक्त वाचते — काहीही बदलत नाही, कोणताही संदेश पाठवत नाही.)
//
// कशासाठी: profile-paths.js मधली chat URL जुनी/चुकीची झाली की Claude
// "Conversation not found" देऊन /new वर नेतो. तेव्हा इथून खरी URL घ्यायची.
//
// वापर:  node scripts/browser/list-chats.js

const { chromium } = require("patchright");
const { SHARED_PROFILE } = require("./profile-paths");

async function main() {
  const context = await chromium.launchPersistentContext(SHARED_PROFILE, {
    channel: "chrome",
    headless: false,
    viewport: null,
  });

  const page = context.pages().length ? context.pages()[0] : await context.newPage();
  await page.goto("https://claude.ai/new", { waitUntil: "load" });
  await page.waitForTimeout(4000);

  // Claude च्या स्वतःच्या API मधून यादी घेतो (login cookies आधीच browser मध्ये
  // असल्याने वेगळे authentication लागत नाही) — DOM/selectors वर अवलंबून नाही.
  const result = await page.evaluate(async () => {
    const orgsRes = await fetch("/api/organizations", { credentials: "include" });
    if (!orgsRes.ok) return { error: `organizations: HTTP ${orgsRes.status}` };
    const orgs = await orgsRes.json();
    if (!Array.isArray(orgs) || !orgs.length) return { error: "एकही organization मिळाले नाही" };

    const out = [];
    for (const org of orgs) {
      const res = await fetch(
        `/api/organizations/${org.uuid}/chat_conversations?limit=100`,
        { credentials: "include" }
      );
      if (!res.ok) {
        out.push({ org: org.name, orgId: org.uuid, error: `HTTP ${res.status}` });
        continue;
      }
      const chats = await res.json();
      out.push({
        org: org.name,
        orgId: org.uuid,
        chats: (Array.isArray(chats) ? chats : []).map((c) => ({
          name: c.name || "(नाव नाही)",
          uuid: c.uuid,
          updatedAt: c.updated_at,
        })),
      });
    }
    return { orgs: out };
  });

  if (result.error) {
    console.error("यादी मिळाली नाही:", result.error);
  } else {
    for (const org of result.orgs) {
      console.log(`\n=== Organization: ${org.org} ===`);
      if (org.error) {
        console.log(`  मिळाले नाही: ${org.error}`);
        continue;
      }
      if (!org.chats.length) {
        console.log("  एकही chat नाही.");
        continue;
      }
      org.chats
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .forEach((c, i) => {
          console.log(`\n  ${i + 1}. ${c.name}`);
          console.log(`     शेवटचा बदल : ${c.updatedAt}`);
          console.log(`     URL        : https://claude.ai/chat/${c.uuid}`);
        });
    }
    console.log("\nयातली योग्य URL scripts/browser/profile-paths.js मध्ये claude: च्या पुढे टाका.\n");
  }

  await context.close();
}

main().catch((err) => {
  console.error("list-chats error:", err.message);
  process.exit(1);
});
