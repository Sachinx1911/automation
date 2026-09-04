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
  // (clipboard परवानगीची गरज उरलेली नाही — Claude चे उत्तर आता "Copy" बटण
  //  दाबून clipboard मधून न वाचता थेट network stream मधून घेतले जाते.)
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
 * @param {RegExp} [opts.completionUrlPattern] - **दिलेला असल्यास DOM वाचणे पूर्णपणे
 *   वगळले जाते** आणि उत्तर थेट network stream मधून घेतले जाते (Claude साठी हेच
 *   वापरतो). यामुळे responseSelectors, "Copy" बटण, clipboard, hover — यापैकी
 *   काहीही लागत नाही, कच्चा markdown मिळतो, आणि उत्तर पूर्ण झाल्याची नक्की
 *   खूण (stop_reason) मिळते. सोबतच Claude चा `message_limit` इव्हेंट वाचून
 *   मर्यादा संपली का हेही खात्रीने कळते.
 * @param {RegExp[]} [opts.usageLimitPatterns] - दिलेले असल्यास, पेजवर यापैकी कोणताही
 *   मजकूर (उदा. "usage limit reached") दिसला की उत्तराची वाट न बघता लगेच
 *   "CREDIT_LIMIT: ..." ने सुरू होणारा वेगळा error टाकतो — जेणेकरून caller
 *   (server.js/n8n) याला सामान्य अपयशापासून वेगळे ओळखून workflow थांबवू शकेल,
 *   उगाच पुढच्या प्रत्येक title साठी वेळ वाया न घालवता.
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
    completionUrlPattern,
    usageLimitPatterns,
  } = opts;

  const page = await getPersistentPage(name, profileDir, url, headless);

  // जो AI सध्या काम करतोय त्याचा tab विंडोत पुढे आणतो — त्यामुळे Gemini सुरू
  // असताना Gemini tab दिसतो, मग Grok सुरू झाला की Grok tab, मग Claude.
  await page.bringToFront().catch(() => {});

  // पाठवण्याआधीच "usage limit reached" सारखा बॅनर दिसत असेल (आधीच्या टायटलनंतर
  // credit संपलेले असू शकते) तर वेळ वाया न घालवता लगेच वेगळा error देतो.
  if (usageLimitPatterns) {
    const preExisting = await detectUsageLimit(page, usageLimitPatterns);
    if (preExisting) {
      throw new Error(`CREDIT_LIMIT: ${preExisting}`);
    }
  }

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

    // Network मार्ग वापरायचा असल्यास (Claude) — listener पाठवण्या*आधी* लावतो
    const capture = completionUrlPattern
      ? captureCompletionStream(page, completionUrlPattern, maxWaitMs)
      : null;

    // पाठवण्याआधी सध्या किती जुनी उत्तरे आहेत ते मोजून ठेवतो (baseline)
    const { count: baselineCount } = capture
      ? { count: 0 }
      : await countMatches(page, responseSelectors);

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

    // ---- Network मार्ग: उत्तर थेट stream मधून ----
    if (capture) {
      let result;
      try {
        result = await capture.promise;
      } catch (err) {
        capture.cancel();
        // stream आलाच नाही — credit पूर्ण संपले असल्यास Claude संदेश पाठवूच
        // देत नाही, त्यामुळे इथे पोहोचतो. अशा वेळी पेजवर मर्यादेचा बॅनर दिसतो
        // का ते तपासतो, म्हणजे हे सामान्य अपयश नसून CREDIT_LIMIT आहे हे
        // ओळखता येते (नाहीतर n8n उगाच ३ वेळा पुन्हा प्रयत्न करत राहील).
        const banner = await detectUsageLimit(page, CLAUDE_LIMIT_FALLBACK_PATTERNS);
        if (banner) {
          const limitErr = new Error(`CREDIT_LIMIT: ${banner}`);
          limitErr.resetsAt = null;
          throw limitErr;
        }
        throw err;
      }

      // Claude ने स्वतः सांगितलेली मर्यादा — शब्द शोधण्याची गरज नाही
      if (result.streamError) {
        throw new Error(`Claude stream error: ${result.streamError}`);
      }

      // stream पूर्ण झाला — आता खरा मजकूर पेजच्या आतून (बरोबर encoding सह)
      const finalText = await fetchLastAssistantText(page, result.completionUrl);
      const limit = result.limit;

      // ---- मर्यादेचा निर्णय ----
      // महत्त्वाचे: `message_limit.type` फक्त "within_limit" नाही म्हणजे credits
      // संपले असे **नाही**. उदा. "approaching_limit" म्हणजे नुसता इशारा —
      // Claude तेव्हा उत्तर देतोच. आधी असे उत्तरही फेकून देऊन workflow थांबत होता.
      //
      // म्हणून खरा निकष मजकूर आहे: उत्तर मिळाले असेल तर ते वापरायचे (इशारा
      // असला तरी). उत्तर मिळालेच नाही आणि मर्यादा सांगितली असेल, तरच थांबायचे.
      const gotText = Boolean(finalText && finalText.trim());

      if (!gotText) {
        if (limit && limit.type && limit.type !== "within_limit") {
          const err = new Error(
            `CREDIT_LIMIT: ${limit.type}${limit.resetsAt ? ` (रीसेट: ${formatResetTime(limit.resetsAt)})` : ""}`
          );
          err.resetsAt = limit.resetsAt || null;
          err.remaining = limit.remaining ?? null;
          throw err;
        }
        throw new Error(
          `उत्तर रिकामे मिळाले (stop_reason: ${result.stopReason || "अज्ञात"}).`
        );
      }

      // उत्तर मिळाले — पण मर्यादा जवळ आली असल्यास फक्त इशारा नोंदवतो
      if (limit && limit.type && limit.type !== "within_limit") {
        console.log(
          `  इशारा: Claude ची मर्यादा जवळ आली आहे (${limit.type}` +
            `${limit.remaining != null ? `, शिल्लक: ${limit.remaining}` : ""}` +
            `${limit.resetsAt ? `, रीसेट: ${formatResetTime(limit.resetsAt)}` : ""}). काम चालू आहे.`
        );
      }

      return stripCompletionMarker(finalText.trim(), completionMarker).trim();
    }

    let text;
    try {
      text = await waitForStableResponse(page, responseSelectors, {
        baselineCount,
        stableChecks,
        pollInterval,
        maxWaitMs,
        completionMarker,
      });
    } catch (err) {
      // उत्तर आलेच नाही (timeout) — बहुतेकदा credit/usage limit मुळे संदेश
      // पाठवला गेला तरी नवीन उत्तर सुरूच होत नाही. देण्याआधी एकदा तपासतो.
      if (usageLimitPatterns) {
        const limitHit = await detectUsageLimit(page, usageLimitPatterns);
        if (limitHit) throw new Error(`CREDIT_LIMIT: ${limitHit}`);
      }
      throw err;
    }

    if (!text || !text.trim()) {
      if (usageLimitPatterns) {
        const limitHit = await detectUsageLimit(page, usageLimitPatterns);
        if (limitHit) throw new Error(`CREDIT_LIMIT: ${limitHit}`);
      }
      throw new Error("उत्तर रिकामे मिळाले. responseSelectors तपासा.");
    }

    return text.trim();
}

// पेजवरचा दृश्य मजकूर दिलेल्या patterns पैकी कोणाशी जुळतो का ते तपासतो
// (उदा. "usage limit reached", "try again later"). जुळल्यास तोच वाक्यांश परत करतो,
// नाहीतर null. साईटने शब्दरचना बदलल्यास वरच्या usageLimitPatterns मध्ये अपडेट करावे.
async function detectUsageLimit(page, patterns) {
  try {
    const bodyText = await page.locator("body").innerText({ timeout: 2000 });
    for (const pattern of patterns) {
      const match = bodyText.match(pattern);
      if (match) return match[0];
    }
  } catch (_) {
    // पेज सध्या उपलब्ध नसेल (navigation चालू वगैरे) तर दुर्लक्ष करून पुढे जातो
  }
  return null;
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

// ---------------------------------------------------------------------------
// Network मधून उत्तर वाचणे (Claude साठी) — DOM/selectors/Copy बटण/clipboard
// यापैकी काहीही न वापरता.
//
// का: उत्तर पेजवर दिसण्याआधी network वरून येते. ते थेट वाचल्याने —
//   • कोणताही CSS class किंवा बटण लागत नाही (UI बदलले तरी तुटत नाही)
//   • कच्चा **markdown** मिळतो (DOM च्या innerText मध्ये formatting हरवते)
//   • उत्तर पूर्ण झाल्याची **नक्की** खूण मिळते (stop_reason) — "मजकूर वाढणे
//     थांबले का" असा अंदाज लावत poll करावे लागत नाही
//   • Claude स्वतः **उरलेल्या मर्यादेची** माहिती देतो (message_limit), त्यामुळे
//     "usage limit reached" असे शब्द शोधण्याची गरजच उरत नाही
//
// (हे probe-claude.js ने प्रत्यक्ष पडताळून काढलेले format आहे, अंदाज नाही.)
// ---------------------------------------------------------------------------

// फक्त **सुरक्षा-जाळे** म्हणून वापरायचे patterns. सामान्य परिस्थितीत मर्यादा
// Claude च्या `message_limit` इव्हेंटवरून कळते (तेच विश्वासार्ह). पण credit
// पूर्ण संपल्यावर Claude संदेश पाठवूच देत नाही — मग stream येत नाही आणि
// message_limit ही मिळत नाही. अशा एकाच परिस्थितीत पेजवरचा बॅनर तपासतो.
// (म्हणून हे patterns सैल न ठेवता घट्ट ठेवले आहेत — "try again later" सारखे
//  सामान्य वाक्यांश मुद्दाम वगळले आहेत, कारण ते Claude च्या उत्तरातही येऊ शकतात.)
const CLAUDE_LIMIT_FALLBACK_PATTERNS = [
  /usage limit reached[^.\n]*/i,
  /message limit reached[^.\n]*/i,
  /reached your (?:usage |message )?limit[^.\n]*/i,
  /you'?re out of (?:free )?(?:messages|credits)[^.\n]*/i,
  /limit (?:will )?reset(?:s)? at[^.\n]*/i,
];

// Claude चा resetsAt कधी unix seconds (उदा. 1788565800) तर कधी ISO string
// म्हणून येतो — दोन्ही वाचनीय स्वरूपात दाखवतो.
function formatResetTime(resetsAt) {
  if (resetsAt == null) return "";
  const n = Number(resetsAt);
  const d = Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date(resetsAt);
  return isNaN(d.getTime()) ? String(resetsAt) : d.toLocaleString();
}

// SSE (text/event-stream) मजकूर पार्स करून त्यातून उत्तर + स्थिती काढते
function parseClaudeStream(body) {
  let text = "";
  let stopReason = null;
  let limit = null;
  let streamError = null;

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;

    let payload;
    try {
      payload = JSON.parse(trimmed.slice(5).trim());
    } catch (_) {
      continue; // अपूर्ण/तुटलेली ओळ — वगळतो
    }

    if (payload.type === "content_block_delta" && payload.delta?.type === "text_delta") {
      text += payload.delta.text || "";
    } else if (payload.type === "message_delta" && payload.delta?.stop_reason) {
      stopReason = payload.delta.stop_reason;
    } else if (payload.type === "message_limit" && payload.message_limit) {
      limit = payload.message_limit;
    } else if (payload.type === "error") {
      streamError = payload.error?.message || JSON.stringify(payload.error || payload);
    }
  }

  return { text, stopReason, limit, streamError };
}

// उत्तराचा **खरा मजकूर** पेजच्या आतून घेतो.
//
// का पेजच्या आतून: तिथे `r.json()` हे ब्राउझरच करतो, त्यामुळे UTF-8 बरोबर
// वाचले जाते आणि मराठी अक्षरे बिघडत नाहीत. (हाच endpoint probe मध्ये तपासला
// होता — तिथे देवनागरी व्यवस्थित आली होती.)
//
// completionUrl चा आकार:
//   https://claude.ai/api/organizations/{orgId}/chat_conversations/{convId}/completion
async function fetchLastAssistantText(page, completionUrl) {
  const convApi = completionUrl.replace(/\/completion(\?.*)?$/, "");

  return await page.evaluate(async (api) => {
    const res = await fetch(`${api}?tree=True&rendering_mode=messages`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`conversation API: HTTP ${res.status}`);
    const data = await res.json();

    const messages = data.chat_messages || [];
    // शेवटचा assistant संदेश शोधतो
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.sender !== "assistant") continue;
      // content[] मधले सर्व text ब्लॉक जोडतो (काही उत्तरे अनेक ब्लॉकमध्ये येतात).
      //
      // Claude चे "thinking" ब्लॉक्स सोबत एक ठराविक placeholder text ब्लॉक
      // येतो ("This block is not supported on your current device yet.") —
      // तो खऱ्या उत्तराचा भाग नाही, म्हणून गाळून टाकतो. नाहीतर तो कचरा
      // तसाच Word फाईलमध्ये जातो.
      const PLACEHOLDER = /^\s*```\s*This block is not supported[\s\S]*?```\s*$/i;

      const text = (m.content || [])
        .filter((c) => c.type === "text" && c.text && !PLACEHOLDER.test(c.text))
        .map((c) => c.text)
        .join("");
      return text || m.text || "";
    }
    return "";
  }, convApi);
}

// संदेश पाठवण्या*आधी* हा listener लावायचा, नाहीतर stream निसटतो.
function captureCompletionStream(page, urlPattern, timeoutMs) {
  let cleanup;
  const promise = new Promise((resolve, reject) => {
    const onResponse = async (res) => {
      try {
        if (res.request().method() !== "POST") return;
        if (!urlPattern.test(res.url())) return;
        // body() streaming संपल्यावरच पूर्ण होते — म्हणजे हेच "उत्तर पूर्ण झाले".
        //
        // महत्त्वाचे: या stream मधून **मजकूर घ्यायचा नाही.** `text/event-stream`
        // ला charset सांगितलेला नसल्याने Chrome/Playwright तो latin-1 धरून
        // देतात, त्यामुळे मराठी अक्षरे बिघडून येतात (न -> Ã¤...). body() ने
        // कच्चे बाइट्स मागितले तरी तेच घडते, कारण बिघाड आधीच झालेला असतो.
        //
        // म्हणून इथून फक्त **ASCII फील्ड्स** घेतो (stop_reason, message_limit —
        // त्यांना हा बिघाड लागू होत नाही), आणि खरा मजकूर नंतर पेजच्या आतून
        // fetch() करून घेतो (तो endpoint application/json असल्याने बरोबर येतो).
        const body = (await res.body()).toString("utf8");
        cleanup();
        const parsed = parseClaudeStream(body);
        parsed.completionUrl = res.url();
        resolve(parsed);
      } catch (_) {
        // हा response वाचता आला नाही — पुढच्याची वाट बघत राहतो
      }
    };

    const timer = setTimeout(
      () => {
        cleanup();
        reject(new Error("network वर उत्तर वेळेत आले नाही (timeout)."));
      },
      timeoutMs
    );

    cleanup = () => {
      clearTimeout(timer);
      page.off("response", onResponse);
    };

    page.on("response", onResponse);
  });

  return { promise, cancel: () => cleanup && cleanup() };
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
