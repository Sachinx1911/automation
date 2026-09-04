// समान लॉजिक तिन्ही AI (Gemini/Grok/Claude) साठी वापरले जाते.
// प्रत्येक साईटचे selectors वेगळे असल्याने ते config म्हणून पाठवले जातात.
//
// महत्त्वाचे: Google/xAI/Anthropic त्यांच्या वेबसाईटचा UI वेळोवेळी बदलतात.
// स्क्रिप्ट काम करत नसेल तर खालील SELECTORS मध्ये बदल करावा लागेल
// (त्या साईटवर उजवे-क्लिक -> Inspect करून योग्य selector शोधा).
//
// आपण एका existing (आधीच संदेश असलेल्या) conversation मध्ये दरवेळी नवीन संदेश
// जोडतो, त्यामुळे "उत्तर आले" हे ओळखताना जुने उत्तर नाही तर खरंच नवीन उत्तर
// आले आहे याची खात्री करतो (पाठवण्याआधीचा response-count बेसलाइन धरून).
//
// ब्राउझर प्रत्येक संदेशासाठी नव्याने उघडत नाही — तिन्ही AI साठी **एकच** Chrome
// विंडो (एकच persistent context, एकच profile) उघडतो, आणि प्रत्येक AI साठी त्यात
// एक वेगळा tab (page) असतो. एकदा उघडलेले tabs पुढच्या सर्व संदेशांसाठी तसेच
// वापरले जातात, जोपर्यंत कोणी explicitly closeContext()/closeAllContexts()
// बोलावत नाही (उदा. संपूर्ण run संपल्यावर server.js मधून). यामुळे प्रत्येक
// वेळी नवीन Chrome उघडणे/बंद करणे टाळले जाते (जे खूप वेळ खात असे).

const { chromium } = require("patchright");

let sharedContext = null; // एकच browser विंडो, तिन्ही AI साठी सामायिक
const pages = new Map(); // name (gemini/grok/claude) -> page (tab)

// Gemini आणि Grok parallel सुरू होतात — दोघेही एकाच वेळी पहिल्यांदा tab/context
// उघडायचा प्रयत्न करू शकतात. यात कोणतेही locking नसेल तर दोघेही एकाच रिकाम्या
// (डीफॉल्ट) tab वर टक्कर देऊ शकतात, आणि एखादा AI चुकीच्या/रिकाम्या पेजवर राहून
// भलताच मजकूर वाचू शकतो. म्हणून "नवीन tab उघडणे" हा एकमेव भाग रांगेत (serialize)
// टाकतो — आधीच उघडलेला tab पुन्हा वापरताना मात्र कोणतेही थांबणे लागत नाही
// (त्यामुळे प्रत्यक्ष टायपिंग/उत्तर वाचणे अजूनही खऱ्या अर्थाने parallel चालते).
let bootstrapLock = Promise.resolve();

async function getSharedContext(profileDir, headless) {
  if (sharedContext) return sharedContext;
  sharedContext = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless,
    viewport: null,
  });
  // "Copy" बटणाने मिळालेला मजकूर clipboard वरून वाचण्यासाठी परवानगी लागते
  try {
    await sharedContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  } catch (err) {
    console.error("clipboard परवानगी देता आली नाही (दुर्लक्ष करा, DOM मधून वाचले जाईल):", err.message);
  }
  return sharedContext;
}

async function getPersistentPage(name, profileDir, url, headless) {
  const existing = pages.get(name);
  if (existing && !existing.isClosed()) {
    return existing; // आधीच उघडलेला tab — रांगेची गरज नाही
  }

  // पहिल्यांदाच उघडायचे असल्यास (bootstrap) — रांगेत टाकतो
  bootstrapLock = bootstrapLock.then(async () => {
    // रांगेत थांबताना दुसऱ्या कोणी आधीच हा tab उघडला असेल तर पुन्हा उघडायचे नाही
    const already = pages.get(name);
    if (already && !already.isClosed()) return;

    const context = await getSharedContext(profileDir, headless);
    // पहिल्या वेळी context च्या डीफॉल्ट (रिकाम्या) tab चा वापर करतो, नंतर नवीन tabs उघडतो
    const page = pages.size === 0 && context.pages().length ? context.pages()[0] : await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(4000); // पेज पूर्ण render/hydrate होण्यासाठी वेळ (काही साईट्स सुरुवातीला re-render करतात)

    pages.set(name, page);
  });

  await bootstrapLock;
  return pages.get(name);
}

async function closeContext(name) {
  const page = pages.get(name);
  if (page) {
    pages.delete(name);
    await page.close().catch(() => {});
  }
}

async function closeAllContexts() {
  await Promise.all([...pages.keys()].map(closeContext));
  if (sharedContext) {
    const ctx = sharedContext;
    sharedContext = null;
    await ctx.close().catch(() => {});
  }
}

/**
 * @param {object} opts
 * @param {string} opts.name - "gemini" | "grok" | "claude" (ब्राउझर session cache करण्यासाठी)
 * @param {string} opts.profileDir - persistent chrome profile path
 * @param {string} opts.url - existing chat conversation ची पूर्ण URL
 * @param {string} opts.prompt - पाठवायचा मजकूर (जसाच्या तसा, कोणताही wrapper न लावता)
 * @param {string[]} opts.inputSelectors - text इनपुट साठी fallback selectors
 * @param {string[]} opts.sendSelectors - send बटणासाठी fallback selectors (नसेल तर Enter दाबतो)
 * @param {string[]} opts.responseSelectors - उत्तराचा मजकूर वाचण्यासाठी fallback selectors
 * @param {boolean} [opts.headless=false]
 * @param {number} [opts.stableChecks=6] - उत्तर येणे थांबले आहे हे किती वेळा सलग तपासायचे (completionMarker नसेल तरच वापरले जाते)
 * @param {number} [opts.pollInterval=1500] - ms
 * @param {number} [opts.maxWaitMs=180000] - जास्तीत जास्त किती वेळ उत्तराची वाट पाहायची
 * @param {string} [opts.completionMarker] - दिलेला असल्यास, उत्तराचा मजकूर या शब्दाने
 *   संपताच लगेच "पूर्ण झाले" असे समजतो (स्थिरता तपासण्याची वाट बघत नाही — जास्त
 *   वेगवान, आणि मध्ये web-search सारखा थांबा आला तरी अर्धवट मजकूर घेतला जात नाही).
 *   अंतिम उत्तरातून हा marker काढून टाकला जातो.
 * @param {string} [opts.copyButtonSelector] - दिलेला असल्यास, उत्तर पूर्ण झाल्यावर
 *   हे "Copy" बटण दाबून clipboard मधून मजकूर वाचतो (DOM मधून वाचण्यापेक्षा जास्त
 *   विश्वासार्ह — sidebar/unrelated elements चा गोंधळ टळतो). अयशस्वी झाल्यास
 *   आधीच DOM मधून वाचलेला मजकूर वापरतो (fallback).
 */
async function runChat(opts) {
  const {
    name,
    profileDir,
    url,
    prompt,
    inputSelectors,
    sendSelectors = [],
    responseSelectors,
    headless = false,
    stableChecks = 6,
    pollInterval = 1500,
    maxWaitMs = 180000,
    completionMarker,
    copyButtonSelector,
  } = opts;

  const page = await getPersistentPage(name, profileDir, url, headless);

  // जो AI सध्या काम करतोय त्याचा tab विंडोत पुढे आणतो — त्यामुळे Gemini सुरू
  // असताना Gemini tab दिसतो, मग Grok सुरू झाला की Grok tab, मग Claude.
  await page.bringToFront().catch(() => {});

  // सुरक्षा-तपासणी: page खरंच योग्य साईटवर आहे ना (चुकीच्या/रिकाम्या पेजवरून
  // भलताच मजकूर वाचला जाऊ नये म्हणून) — फक्त domain (origin) जुळतो का बघतो,
  // कारण साईट स्वतःच URL मध्ये छोटे बदल (redirect, trailing params) करू शकते.
  try {
    const currentOrigin = new URL(page.url()).origin;
    const targetOrigin = new URL(url).origin;
    if (currentOrigin !== targetOrigin) {
      throw new Error(
        `"${name}" tab चुकीच्या पेजवर आहे (अपेक्षित: ${targetOrigin}, सध्या: ${currentOrigin}). ` +
          `पुन्हा प्रयत्न करा; सतत होत असल्यास server पुन्हा सुरू करा.`
      );
    }
  } catch (err) {
    if (err.message.includes("चुकीच्या पेजवर")) throw err;
    // page.url()/URL parsing मध्ये इतर काही अडचण आली तर दुर्लक्ष करून पुढे जातो
  }

  let input = await firstVisible(page, inputSelectors, 30000);
    if (!input) {
      throw new Error(
        "चॅट इनपुट सापडला नाही. आधी 'npm run login:<gemini|grok|claude>' चालवून login केले आहे का ते तपासा, chat tab ची URL बरोबर आहे का तपासा, किंवा selectors बदलले असतील."
      );
    }

    // पेज सुरुवातीला re-render/remount होत असेल तर click अडकू शकते, म्हणून retry करतो
    let clicked = false;
    let lastErr;
    for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
      try {
        await input.click({ timeout: 15000 });
        clicked = true;
      } catch (err) {
        lastErr = err;
        await page.waitForTimeout(2000);
        input = (await firstVisible(page, inputSelectors, 10000)) || input;
      }
    }
    if (!clicked) {
      throw lastErr || new Error("चॅट इनपुटवर क्लिक करता आले नाही.");
    }

    // पाठवण्याआधी सध्या किती जुनी उत्तरे आहेत ते मोजून ठेवतो (baseline)
    const { count: baselineCount } = await countMatches(page, responseSelectors);

    // keyboard.type() प्रत्येक अक्षर वेगळे टाईप करत असल्याने संथ असते;
    // insertText() संपूर्ण मजकूर एकाच वेळी टाकतो (तरीही contenteditable/rich-text
    // editors ला योग्य तो input event मिळतो, त्यामुळे editor बरोबर काम करतो) — खूप वेगवान.
    await page.keyboard.insertText(prompt);

    const sendBtn = sendSelectors.length ? await firstVisible(page, sendSelectors, 5000) : null;
    if (sendBtn) {
      await sendBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    let text = await waitForStableResponse(page, responseSelectors, {
      baselineCount,
      stableChecks,
      pollInterval,
      maxWaitMs,
      completionMarker,
    });

    if (!text || !text.trim()) {
      throw new Error("उत्तर रिकामे मिळाले. responseSelectors तपासा.");
    }

    if (copyButtonSelector) {
      const copied = await copyViaButton(page, responseSelectors, copyButtonSelector);
      if (copied && copied.trim()) {
        text = stripCompletionMarker(copied.trim(), completionMarker);
      }
    }

    return text.trim();
}

async function copyViaButton(page, responseSelectors, copyButtonSelector) {
  try {
    // "Copy" बटण डीफॉल्टने लपलेले असते (फक्त hover केल्यावर दिसते — fade-in),
    // म्हणून आधी शेवटच्या उत्तरावर hover करणे आवश्यक आहे.
    const { sel: matchedSel, count: responseCount } = await countMatches(page, responseSelectors);
    if (responseCount === 0 || !matchedSel) return null;
    const lastResponse = page.locator(matchedSel).nth(responseCount - 1);
    await lastResponse.scrollIntoViewIfNeeded().catch(() => {});
    await lastResponse.hover().catch(() => {});
    await page.waitForTimeout(400); // fade-in अ‍ॅनिमेशनसाठी थोडा वेळ

    let buttons = page.locator(copyButtonSelector);
    let count = await buttons.count().catch(() => 0);

    if (count === 0) {
      // बटण अजून दिसत नसेल तर थोडे scroll करून (खाली-वर) पुन्हा hover करून बघतो —
      // कधीकधी नुसत्या hover ने reveal होत नाही, scroll मुळे होते.
      await page.mouse.wheel(0, 120).catch(() => {});
      await page.waitForTimeout(300);
      await page.mouse.wheel(0, -120).catch(() => {});
      await page.waitForTimeout(300);
      await lastResponse.hover().catch(() => {});
      await page.waitForTimeout(400);
      buttons = page.locator(copyButtonSelector);
      count = await buttons.count().catch(() => 0);
    }

    if (count === 0) return null;

    const btn = buttons.nth(count - 1);
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(400); // clipboard मध्ये लिहिले जाण्यासाठी थोडा वेळ

    return await page.evaluate(() => navigator.clipboard.readText());
  } catch (err) {
    console.error("Copy बटणाने वाचता आले नाही, DOM मधले उत्तर वापरतो:", err.message);
    return null;
  }
}

async function firstVisible(page, selectors, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      try {
        if (await loc.isVisible({ timeout: 300 })) return loc;
      } catch (_) {
        /* ignore, try next selector */
      }
    }
    await page.waitForTimeout(300);
  }
  return null;
}

async function countMatches(page, responseSelectors) {
  for (const sel of responseSelectors) {
    const locs = page.locator(sel);
    const count = await locs.count().catch(() => 0);
    if (count > 0) return { sel, count };
  }
  return { sel: null, count: 0 };
}

function stripCompletionMarker(text, completionMarker) {
  if (!completionMarker) return text;
  const trimmed = text.trimEnd();
  if (trimmed.endsWith(completionMarker)) {
    return trimmed.slice(0, trimmed.length - completionMarker.length).trimEnd();
  }
  return text;
}

async function waitForStableResponse(
  page,
  responseSelectors,
  { baselineCount, stableChecks, pollInterval, maxWaitMs, completionMarker }
) {
  const deadline = Date.now() + maxWaitMs;
  let lastText = "";
  let stableCount = 0;
  let sawNew = false;

  // उत्तर streaming सुरू होण्यासाठी थोडा वेळ द्या
  await page.waitForTimeout(1500);

  while (Date.now() < deadline) {
    const { count } = await countMatches(page, responseSelectors);

    if (count > baselineCount) {
      sawNew = true;
      const currentText = await readLastResponse(page, responseSelectors);

      if (completionMarker) {
        // marker सापडला की लगेच पूर्ण झाले असे समजतो — स्थिरतेची वाट बघत नाही
        // (त्यामुळे मध्ये web-search सारखा थांबा आला तरी चुकीने अर्धवट मजकूर घेतला जात नाही)
        if (currentText && currentText.trimEnd().endsWith(completionMarker)) {
          return stripCompletionMarker(currentText, completionMarker);
        }
        lastText = currentText;
      } else if (currentText && currentText === lastText) {
        stableCount += 1;
        if (stableCount >= stableChecks) {
          return currentText;
        }
      } else {
        stableCount = 0;
        lastText = currentText;
      }
    }

    await page.waitForTimeout(pollInterval);
  }

  if (sawNew && lastText) return stripCompletionMarker(lastText, completionMarker); // वेळ संपला तरी जे मिळाले ते परत करा
  throw new Error("वेळेत नवीन उत्तर मिळाले नाही (timeout).");
}

async function readLastResponse(page, responseSelectors) {
  for (const sel of responseSelectors) {
    const locs = page.locator(sel);
    const count = await locs.count().catch(() => 0);
    if (count > 0) {
      const last = locs.nth(count - 1);
      const txt = await last.innerText().catch(() => "");
      if (txt) return txt;
    }
  }
  return "";
}

module.exports = { runChat, closeContext, closeAllContexts };
