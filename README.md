# Excel -> Gemini+Grok (parallel) -> Claude -> Word ऑटोमेशन (n8n local)

Excel मधील PENDING टायटल्स घेऊन, तुमच्या आधीच बनवलेल्या (existing) Gemini, Grok, Claude
chat tabs मध्ये पाठवायचे — मूळ Title **एकाच वेळी (parallel) Gemini आणि Grok दोघांना**
पाठवला जातो, दोघांची उत्तरे आली की ती दोन्ही एकत्र करून **एकाच वेळी Claude ला** पाठवली
जातात — Claude चे अंतिम उत्तर हेच निकाल — आणि तेच अंतिम उत्तर एका **live** Word (.docx)
फाईलमध्ये लगेच जोडले जाते. हे संपूर्ण n8n workflow (`n8n-workflow/workflow-final.json`).

## आर्किटेक्चर — n8n Docker मध्ये, बाकी सर्व Windows वर

तुमचा n8n **Docker container** (Linux) मध्ये चालतो. Docker container च्या आतून तुमचा
खरा Chrome ब्राउझर किंवा तुमच्या PC ची फाईल सिस्टिम थेट वापरता येत नाही. त्यामुळे:

- ब्राउझर automation (Gemini/Grok/Claude) आणि Word फाईल तयार करणे — हे सर्व एका छोट्या
  **local HTTP server** द्वारे तुमच्या Windows मशीनवर (Docker बाहेर) चालते.
- n8n workflow फक्त त्या server ला **HTTP Request** नोड्सने कॉल करतो
  (`http://host.docker.internal:5959/...`) — Docker Desktop आपोआप हे host machine शी
  जोडते, वेगळी सेटिंग लागत नाही.
- **म्हणून n8n workflow चालवण्याआधी `npm run server` (किंवा `npm.cmd run server`) चालू असणे आवश्यक आहे.**

## पद्धत — प्रत्येक AI ची विशिष्ट, आधीच बनवलेली chat tab वापरली जाते

प्रत्येक run मध्ये नवीन chat सुरू **होत नाही** — तुम्ही आधीच Gemini/Grok/Claude मध्ये
बनवलेल्या त्याच विशिष्ट conversation मध्ये संदेश जोडले जातात. यासाठी त्या तीन tabs च्या
पूर्ण URL लागतात — **`scripts/browser/profile-paths.js` मध्ये टाका** (एकदाच, प्रति मशीन):

```js
const URLS = {
  gemini: "इथे तुमच्या Gemini chat tab ची पूर्ण URL",
  grok: "इथे तुमच्या Grok chat tab ची पूर्ण URL",
  claude: "इथे तुमच्या Claude chat tab ची पूर्ण URL",
};
```

प्रत्येक title साठी:
1. मूळ Title **एकाच वेळी** Gemini आणि Grok च्या tabs ला पाठवला जातो (parallel).
2. दोघांची उत्तरे आली की ("Gemini उत्तर: ... Grok उत्तर: ...") असे एकत्र करून, एकाच
   कॉलमध्ये Claude च्या tab ला पाठवले जाते.
3. Claude कडून येणारे उत्तर लगेच **live Word फाईलमध्ये** (काळ्या रंगात) जोडले जाते.
4. Gemini/Grok/Claude पैकी कुठलाही टप्पा अयशस्वी झाला (retry नंतरही) तरी workflow
   **थांबत नाही** — जे उत्तर मिळाले तेच (किंवा Claude अयशस्वी झाल्यास Gemini+Grok चा
   raw मजकूर, **लाल रंगात**) फाईलमध्ये जोडले जाते, पुढच्या title कडे जाते.

## फोल्डर रचना

```
automation/
  scripts/
    server.js                -> Windows वर चालणारा automation server (npm run server)
    browser/
      profile-paths.js        -> प्रत्येक AI साठी profile फोल्डर + विशिष्ट chat tabs च्या URL
      login-setup.js            -> एकदाच चालवून manual login करण्यासाठी (खरा Chrome)
      chat-runner.js              -> सामायिक automation लॉजिक (patchright + selectors)
      gemini-chat.js / grok-chat.js / claude-chat.js -> chatX(text) एक्सपोर्ट + CLI टेस्ट
    docx/
      create-docx.js            -> buildDocxBuffer(results) — रंगासहित (काळा/लाल)
      live-doc.js                -> सुरू होताच फाईल उघडते, प्रत्येक निकालानंतर append+save करते
      from-progress.js            -> recovery: progress.jsonl मधून Word फाईल परत बनवते
  n8n-workflow/
    workflow-final.json           -> सध्याचा वापरातला (final) workflow — हाच import करा
  .browser-profiles/                -> (आपोआप तयार होईल) login sessions
  output/                            -> Word फाईल्स (.docx), plain text (.txt), progress.jsonl
```

## पायरी 1 — एकदाच सेटअप

```bash
npm install
```

(PowerShell मध्ये script-execution error आल्यास `npm.cmd install` वापरा.)

## पायरी 2 — विशिष्ट chat tabs च्या URL भरा

`scripts/browser/profile-paths.js` उघडून `URLS` मध्ये तिन्ही AI च्या विशिष्ट chat
tabs च्या पूर्ण लिंक्स टाका. (लिंकमधला `?rid=...` भाग असल्यास काढून टाकू शकता — तो
प्रत्येक भेटीत बदलतो, मूळ चॅट आयडी स्थिर असतो.)

## पायरी 3 — प्रत्येक AI मध्ये एकदा manually login करा

```bash
npm run login:gemini
npm run login:grok
npm run login:claude
```

खराखुरा Chrome उघडेल — login करा, विंडो बंद करा, टर्मिनलमध्ये Enter दाबा. **एकदाच**,
प्रति मशीन.

## पायरी 4 — स्क्रिप्ट्स स्वतंत्रपणे टेस्ट करा

```bash
npm run test:gemini
npm run test:grok
npm run test:claude
```

## पायरी 5 — Automation server सुरू करा (n8n चालवण्याआधी दरवेळी)

```bash
npm run server
```

हा टर्मिनल **उघडाच ठेवा**.

## पायरी 6 — n8n मध्ये workflow import करा

`n8n-workflow/workflow-final.json` **Import from File** ने टाका, **Upload Excel**
फॉर्म ऍक्टिव्हेट करा, Excel फाईल अपलोड करा.

## Live Word फाईल कशी वागते

- workflow सुरू होताच `output/` फोल्डरमध्ये एक नवी (रिकामी) Word फाईल तयार होते आणि
  **आपोआप उघडते** (default app मध्ये).
- प्रत्येक title चा निकाल आल्याबरोबर त्याच फाईलमध्ये जोडून लगेच save केले जाते —
  त्यामुळे फाईल हळूहळू भरत जाते (उघडलेल्या window मध्ये दिसण्यासाठी फाईल पुन्हा
  उघडावी/रिफ्रेश करावी लागू शकते, कारण Word स्वतःहून बाहेरचे बदल आपोआप दाखवत नाही).
- **जर फाईल Word मध्ये उघडी असल्याने त्या क्षणी save अडखळले** (लॉक), तर worfklow थांबत
  नाही — डेटा `output/progress.jsonl` मध्ये आधीच सुरक्षित असतो. फाईल बंद करून नंतर
  हे चालवा:
  ```bash
  npm run docx:recover
  ```
  यातून `progress.jsonl` मधल्या सर्व आत्तापर्यंतच्या निकालांतून एक नवी, पूर्ण Word
  फाईल तयार होते.
- सर्व titles संपल्यावर workflow आपोआप फाईल अंतिम रूपात save करते (`/doc/finish`).

## रंग-कोड

- **काळा मजकूर** — Claude कडून यशस्वी अंतिम उत्तर आले.
- **लाल मजकूर** — Claude चा टप्पा अयशस्वी झाला (३ प्रयत्नांनंतरही); त्याऐवजी
  Gemini+Grok चा raw (unpolished) मजकूर तसाच सेव्ह केला आहे, जेणेकरून काहीच वाया
  जाऊ नये — पण हे नंतर तुम्ही तपासून बघावे.

## Excel फाईल फॉरमॅट

| Title | Status |
|-------|--------|
| उदाहरण टायटल १ | PENDING |
| उदाहरण टायटल २ | DONE |

फक्त `Status = PENDING` असलेल्या टायटल्सवर प्रोसेसिंग होईल. Form मधील upload field
चे नाव "Excel File" आहे — n8n आतून त्याला binary property `Excel_File` (underscore)
असे बदलते, workflow मध्ये हेच वापरलेले आहे. Sr. No. सारखा जास्तीचा कॉलम असल्यास
हरकत नाही (तो दुर्लक्षित होतो).

## एखादा AI तात्पुरता बंद करायचा असेल (bypass)

n8n मध्ये त्या नोडवर उजवे-क्लिक -> **Deactivate**:
- **Gemini Existing Chat** बंद केल्यास → Claude ला फक्त Grok चे उत्तर जाईल.
- **Grok Existing Chat** बंद केल्यास → Claude ला फक्त Gemini चे उत्तर जाईल.
- **Claude Existing Chat** बंद केल्यास → Gemini+Grok चा एकत्र मजकूर थेट (लाल रंगात)
  Word फाईलमध्ये सेव्ह होईल.

## मर्यादा / लक्षात ठेवण्यासारखे

- **`npm run server` चालू असल्याशिवाय n8n workflow चालणार नाही.**
- **`profile-paths.js` मध्ये तिन्ही chat tabs च्या URL भरलेल्या असणे आवश्यक.**
- प्रत्येक AI ला जसाच्या तसा मजकूर पाठवला जातो — कोणताही wrapper प्रॉम्प्ट लावला जात
  नाही; त्या conversation मध्ये तुम्ही आधीच सूचना दिलेल्या असाव्यात.
- ब्राउझर UI बदलले की selectors अपडेट करावे लागतील (`scripts/browser/*.js`).
- एका वेळी एकाच AI साठी एकच automation call चालतो (queue प्रणाली) — त्याच AI ची
  दुसरी विनंती आधीची संपेपर्यंत थांबते (एकाच Chrome profile वर दोन automation
  instances एकत्र चालत नाहीत म्हणून).
- हेडलेस मोड डीफॉल्टने बंद आहे; चालू करायचे असल्यास `HEADLESS=true` environment
  variable सेट करा (Claude साठी headless टाळावा — Cloudflare अडथळा येऊ शकतो).
