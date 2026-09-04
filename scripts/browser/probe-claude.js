// पडताळणी (diagnostic) स्क्रिप्ट — काहीही बदलत नाही, फक्त निरीक्षण करून नोंदवते.
//
// उद्देश: Claude चे उत्तर वाचण्यासाठी Copy बटण / CSS class वापरणे बंद करून
// **network मधून** वाचता येईल का, हे अंदाज न लावता प्रत्यक्ष तपासणे. म्हणून
// एक छोटा test संदेश पाठवून दोन गोष्टी नोंदवते:
//
//   (अ) उत्तर आल्यावर पेजवरच्या उत्तर-container वर कोणते role / data-testid /
//       aria-* attributes आहेत (semantic selector मिळतो का)
//   (ब) उत्तर network वर कोणत्या URL ने, कोणत्या format मध्ये येते
//
// वापर:
//   node scripts/browser/probe-claude.js
//   node scripts/browser/probe-claude.js "स्वतःचा test संदेश"
//
// अट: `npm run server` ने ब्राउझर आधीच उघडलेला नसावा (एकच Chrome profile दोनदा
// उघडता येत नाही). तसे असल्यास आधी server थांबवा.

const fs = require("fs");
const path = require("path");
const { chromium } = require("patchright");
const { SHARED_PROFILE, URLS, assertConfigured } = require("./profile-paths");

const OUTPUT_DIR = path.join(__dirname, "..", "..", "output");
const REPORT_FILE = path.join(OUTPUT_DIR, "probe-claude.json");

const TEST_MESSAGE = process.argv[2] || "ping (हा फक्त automation चा test संदेश आहे)";
const SETTLE_MS = 4000; // network शांत झाल्याचे ठरवण्यासाठी इतका वेळ काहीच न आल्यास
const MAX_WAIT_MS = 180000;
const BODY_PREVIEW = 1200; // प्रत्येक response body चा किती भाग नोंदवायचा

// उत्तर वाहून नेणारी URL ओळखण्यासाठी — यापैकी काही जुळले तर "उमेदवार" म्हणून खूण
const INTERESTING = /completion|message|chat_conversation|conversation|stream|sse|append/i;

function short(s, n) {
  if (typeof s !== "string") return s;
  return s.length > n ? s.slice(0, n) + `\n…(अजून ${s.length - n} अक्षरे)` : s;
}

async function main() {
  assertConfigured();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("Chrome उघडतोय (shared profile)…");
  const context = await chromium.launchPersistentContext(SHARED_PROFILE, {
    channel: "chrome",
    headless: false,
    viewport: null,
  });

  const page = context.pages().length ? context.pages()[0] : await context.newPage();

  console.log(`Claude chat उघडतोय: ${URLS.claude}`);
  await page.goto(URLS.claude, { waitUntil: "load" });
  await page.waitForTimeout(4000);

  // ---- आधी: खरंच हवी तीच chat उघडली का, आणि login आहे का? ----
  const landedUrl = page.url();
  const redirected = landedUrl.split("?")[0] !== URLS.claude.split("?")[0];
  const loginState = await page.evaluate(() => {
    const t = document.body.innerText || "";
    return {
      looksLoggedOut: /sign in|log in|continue with google|welcome back/i.test(t.slice(0, 3000)),
      userMenuPresent: !!document.querySelector('[data-testid="user-menu-button"]'),
      userMessages: document.querySelectorAll('[data-testid="user-message"]').length,
      articles: document.querySelectorAll("article").length,
      transcriptRows: document.querySelectorAll('[data-testid="transcript-row"]').length,
    };
  });

  console.log("\n---- chat / login स्थिती ----");
  console.log(`  हवी होती : ${URLS.claude}`);
  console.log(`  पोहोचलो  : ${landedUrl}`);
  console.log(`  redirect झाला? ${redirected ? "होय ⚠️" : "नाही ✅"}`);
  console.log(`  user-menu दिसतो (login)? ${loginState.userMenuPresent ? "होय ✅" : "नाही ⚠️"}`);
  console.log(`  logged-out दिसतंय? ${loginState.looksLoggedOut ? "होय ⚠️" : "नाही ✅"}`);
  console.log(`  transcript-row: ${loginState.transcriptRows}, user-message: ${loginState.userMessages}, article: ${loginState.articles}`);
  console.log("-----------------------------\n");

  await page.screenshot({ path: path.join(OUTPUT_DIR, "probe-claude.png") }).catch(() => {});

  if (process.argv.includes("--no-send")) {
    fs.writeFileSync(
      REPORT_FILE,
      JSON.stringify({ ranAt: new Date().toISOString(), mode: "no-send", wanted: URLS.claude, landedUrl, redirected, loginState }, null, 2),
      "utf-8"
    );
    console.log(`स्क्रीनशॉट: ${path.join(OUTPUT_DIR, "probe-claude.png")}`);
    console.log(`अहवाल: ${REPORT_FILE}`);
    await context.close();
    return;
  }

  // ---- (ब) network नोंदवणे ----
  const netLog = [];
  let lastActivityAt = Date.now();
  let sendStartedAt = null;

  // image/css/font सोडून सर्व प्रकार पकडतो — streaming completion कोणत्या
  // resourceType ने येईल हे आधी माहीत नाही, म्हणून जाळे रुंद ठेवतो.
  const SKIP = new Set(["image", "stylesheet", "font", "media"]);

  page.on("request", (req) => {
    const type = req.resourceType();
    if (SKIP.has(type)) return;
    lastActivityAt = Date.now();
    netLog.push({
      phase: sendStartedAt ? "after-send" : "before-send",
      at: Date.now(),
      kind: "request",
      method: req.method(),
      url: req.url(),
      resourceType: type,
      candidate: INTERESTING.test(req.url()),
      postDataPreview: short(req.postData() || "", 300),
    });
  });

  page.on("response", async (res) => {
    const req = res.request();
    const type = req.resourceType();
    if (SKIP.has(type)) return;
    lastActivityAt = Date.now();

    const entry = {
      phase: sendStartedAt ? "after-send" : "before-send",
      at: Date.now(),
      msAfterSend: sendStartedAt ? Date.now() - sendStartedAt : null,
      kind: "response",
      status: res.status(),
      method: req.method(),
      url: res.url(),
      resourceType: type,
      contentType: (res.headers()["content-type"] || "").split(";")[0],
      candidate: INTERESTING.test(res.url()),
    };

    // उमेदवार वाटणाऱ्या responses चा मजकूर वाचून बघतो (streaming असल्यास
    // stream संपेपर्यंत थांबते — म्हणून guard सह)
    if (entry.candidate && sendStartedAt) {
      try {
        const body = await Promise.race([
          res.text(),
          new Promise((r) => setTimeout(() => r("<टाइमआउट — बहुधा streaming चालू>"), 20000)),
        ]);
        entry.bodyLength = typeof body === "string" ? body.length : null;
        entry.bodyPreview = short(body, BODY_PREVIEW);
        lastActivityAt = Date.now();
      } catch (err) {
        entry.bodyError = err.message;
      }
    }

    netLog.push(entry);
  });

  // ---- test संदेश पाठवणे (आत्ताचेच accessibility selectors वापरून) ----
  const inputSelectors = [
    'div[aria-label="Write your prompt to Claude"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"]',
  ];

  let input = null;
  for (const sel of inputSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) {
      input = loc;
      console.log(`Input सापडला: ${sel}`);
      break;
    }
  }
  if (!input) throw new Error("Input box सापडला नाही — Claude पेज उघडले आहे का तपासा.");

  const beforeCount = await page
    .locator('xpath=//div[contains(concat(" ", normalize-space(@class), " "), " font-claude-response ")][not(ancestor::a)]')
    .count()
    .catch(() => 0);

  await input.click();
  await page.keyboard.insertText(TEST_MESSAGE);

  sendStartedAt = Date.now();
  lastActivityAt = Date.now();

  const sendBtn = page.locator('button[aria-label="Send message"]:not([disabled])').first();
  if (await sendBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await sendBtn.click();
    console.log("Send बटणाने पाठवले.");
  } else {
    await page.keyboard.press("Enter");
    console.log("Enter दाबून पाठवले.");
  }

  // उत्तराची वाट — आधी उत्तर *सुरू* झाल्याची खात्री (DOM मध्ये नवीन response
  // किंवा network वर उमेदवार request), मगच "शांत झाले का" बघतो. नाहीतर
  // पाठवल्यानंतरच्या पहिल्या २-३ सेकंदांतच चुकीने थांबतो.
  console.log("उत्तराची वाट बघतोय…");
  const respXpath =
    'xpath=//div[contains(concat(" ", normalize-space(@class), " "), " font-claude-response ")][not(ancestor::a)]';
  const deadline = Date.now() + MAX_WAIT_MS;
  let started = false;
  let lastLen = -1;
  let stableSince = null;

  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);

    const count = await page.locator(respXpath).count().catch(() => 0);
    const curLen = count
      ? (await page.locator(respXpath).nth(count - 1).innerText().catch(() => "")).length
      : 0;
    const sawCandidate = netLog.some((e) => e.kind === "request" && e.phase === "after-send" && e.candidate);

    if (!started && (count > beforeCount || curLen > 0 || sawCandidate)) {
      started = true;
      console.log("  उत्तर सुरू झाले…");
    }
    if (!started) continue;

    // मजकूर वाढणे थांबले + network शांत => पूर्ण झाले
    if (curLen === lastLen && Date.now() - lastActivityAt > SETTLE_MS) {
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince > 3000) break;
    } else {
      stableSince = null;
    }
    lastLen = curLen;
  }
  console.log(
    `थांबलो (${Math.round((Date.now() - sendStartedAt) / 1000)}s, उत्तर सुरू झाले: ${started ? "होय" : "नाही ⚠️"}).`
  );

  // ---- (अ) उत्तर-container चे attributes तपासणे ----
  const domFindings = await page.evaluate(() => {
    const out = { responseContainers: [], testIdSample: [], roleSample: [] };

    const attrsOf = (el) => {
      const a = {};
      for (const at of el.attributes) {
        // class खूप लांब असतो — फक्त सुरुवात ठेवतो
        a[at.name] = at.name === "class" ? at.value.slice(0, 160) : at.value;
      }
      return { tag: el.tagName.toLowerCase(), attrs: a };
    };

    // font-claude-response वाले (आत्ता वापरात असलेले) — त्यांचे व त्यांच्या
    // ४ पूर्वजांचे attributes, म्हणजे semantic पर्याय दिसेल
    const nodes = [...document.querySelectorAll(".font-claude-response")].filter(
      (el) => !el.closest("a")
    );
    const last = nodes[nodes.length - 1];
    if (last) {
      const chain = [];
      let cur = last;
      for (let i = 0; i < 5 && cur; i++) {
        chain.push(attrsOf(cur));
        cur = cur.parentElement;
      }
      out.responseContainers = chain;
      out.lastResponseTextPreview = (last.innerText || "").slice(0, 300);
    }
    out.totalFontClaudeResponse = nodes.length;

    // पेजवरचे सर्व data-testid (वेगळे) — यात उत्तरासाठी काही आहे का ते बघायला
    out.testIdSample = [
      ...new Set([...document.querySelectorAll("[data-testid]")].map((el) => el.getAttribute("data-testid"))),
    ].slice(0, 60);

    // role असलेले elements
    out.roleSample = [
      ...new Set([...document.querySelectorAll("[role]")].map((el) => el.getAttribute("role"))),
    ].slice(0, 40);

    return out;
  });

  const afterCount = await page
    .locator('xpath=//div[contains(concat(" ", normalize-space(@class), " "), " font-claude-response ")][not(ancestor::a)]')
    .count()
    .catch(() => 0);

  const report = {
    ranAt: new Date().toISOString(),
    testMessage: TEST_MESSAGE,
    claudeUrl: URLS.claude,
    responseCountBefore: beforeCount,
    responseCountAfter: afterCount,
    dom: domFindings,
    network: netLog,
  };

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), "utf-8");

  // ---- सारांश ----
  const candidates = netLog.filter((e) => e.kind === "response" && e.phase === "after-send" && e.candidate);
  console.log("\n================ सारांश ================");
  console.log(`उत्तरे: आधी ${beforeCount} -> नंतर ${afterCount}`);
  console.log(`\nसंदेश पाठवल्यानंतरचे network responses: ${netLog.filter((e) => e.kind === "response" && e.phase === "after-send").length}`);
  console.log(`त्यातले उमेदवार (उत्तर वाहून नेणारे असू शकतात): ${candidates.length}`);
  candidates.forEach((c) => {
    console.log(`  [${c.status}] ${c.method} ${c.contentType}  +${c.msAfterSend}ms`);
    console.log(`      ${c.url}`);
    if (c.bodyLength != null) console.log(`      body: ${c.bodyLength} अक्षरे`);
  });
  console.log(`\nपेजवरचे data-testid (${domFindings.testIdSample.length}): ${domFindings.testIdSample.join(", ")}`);
  console.log(`पेजवरचे role (${domFindings.roleSample.length}): ${domFindings.roleSample.join(", ")}`);
  console.log(`\nपूर्ण अहवाल: ${REPORT_FILE}`);
  console.log("========================================\n");

  await context.close();
}

main().catch((err) => {
  console.error("probe error:", err.message);
  process.exit(1);
});
