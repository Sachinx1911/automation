// हा server तुमच्या Windows मशीनवर (Docker बाहेर) चालू ठेवायचा आहे.
// n8n Docker container च्या आत असल्याने त्याला थेट तुमचा Chrome किंवा C:\ ड्राईव्ह
// वापरता येत नाही — त्यामुळे n8n हा HTTP call करून याच server ला विनंती पाठवतो,
// आणि हा server प्रत्यक्ष ब्राउझर automation + live Word फाईल निर्मिती करतो.
//
// चालू ठेवा: npm run server   (किंवा npm.cmd run server)
// (n8n workflow चालवण्याआधी हा server चालू असणे आवश्यक आहे)

const http = require("http");

const { chatGemini } = require("./browser/gemini-chat");
const { chatGrok } = require("./browser/grok-chat");
const { chatClaude } = require("./browser/claude-chat");
const { closeAllContexts } = require("./browser/chat-runner");
const liveDoc = require("./docx/live-doc");

const PORT = process.env.PORT || 5959;

// प्रत्येक AI साठी एका वेळी एकच request — कारण एकाच Chrome profile वर दोन
// automation instances एकाच वेळी चालू शकत नाहीत ("profile already in use" error येतो).
// Gemini आणि Grok parallel चालतात (वेगळ्या profiles), पण त्याच AI साठी दुसरी
// request आली तर ती आधीची संपेपर्यंत रांगेत थांबते.
const queues = { gemini: Promise.resolve(), grok: Promise.resolve(), claude: Promise.resolve() };

function runQueued(name, fn) {
  const next = queues[name].then(fn, fn);
  queues[name] = next.catch(() => {}); // रांग तुटू नये म्हणून इथे error गिळतो (caller ला तो मिळतोच)
  return next;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

const CHAT_ROUTES = {
  "/chat/gemini": chatGemini,
  "/chat/grok": chatGrok,
  "/chat/claude": chatClaude,
};

// ---------------------------------------------------------------------------
// टेस्टसाठी: credit संपल्याचे **नाटक** करण्याचा स्विच.
//
// का: "credit संपले -> workflow थांबतो -> credit आले -> आपोआप पुढे चालू होतो"
// हा मार्ग तपासायचा असेल तर एरवी खरोखर credits संपेपर्यंत वाट बघावी लागेल.
// हा स्विच चालू केला की /chat/claude ब्राउझरला हातही न लावता लगेच तोच
// 429 CREDIT_LIMIT प्रतिसाद देतो जो खऱ्या वेळी येतो.
//
//   चालू : curl -X POST localhost:5959/test/credit-limit -d '{"on":true}'
//   बंद  : curl -X POST localhost:5959/test/credit-limit -d '{"on":false}'
//   स्थिती: curl localhost:5959/test/credit-limit
// ---------------------------------------------------------------------------
let simulateCreditLimit = false;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.url === "/test/credit-limit") {
      if (req.method === "GET") {
        return sendJson(res, 200, { simulateCreditLimit });
      }
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        simulateCreditLimit = body.on === true;
        console.log(
          `[${new Date().toLocaleTimeString()}] TEST: credit-limit नाटक ${simulateCreditLimit ? "चालू" : "बंद"}`
        );
        return sendJson(res, 200, { ok: true, simulateCreditLimit });
      }
    }

    if (req.method === "POST" && CHAT_ROUTES[req.url]) {
      const body = await readJsonBody(req);
      const text = body.text;
      if (!text) {
        return sendJson(res, 400, { error: "'text' field आवश्यक आहे." });
      }
      const name = req.url.split("/").pop(); // gemini | grok | claude
      console.log(`[${new Date().toLocaleTimeString()}] ${req.url} <- "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);

      // टेस्ट स्विच चालू असेल तर Claude ला खरा कॉल न करता credit संपल्याचे नाटक
      if (simulateCreditLimit && name === "claude") {
        const resetsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        console.log(`[${new Date().toLocaleTimeString()}] TEST: /chat/claude -> बनावट CREDIT_LIMIT`);
        return sendJson(res, 429, {
          error: "CREDIT_LIMIT",
          message: `CREDIT_LIMIT: simulated_for_test (रीसेट: ${resetsAt})`,
          resetsAt,
          remaining: 0,
          simulated: true,
        });
      }

      let response;
      try {
        response = await runQueued(name, () => CHAT_ROUTES[req.url](text));
      } catch (err) {
        // credit/usage limit संपल्याचा वेगळा (429) status — सामान्य 500 अपयशापासून
        // वेगळा ठेवतो जेणेकरून n8n workflow मध्ये यावरच थांबा (Wait) ओळखता येतो.
        if (err.message && err.message.startsWith("CREDIT_LIMIT")) {
          console.log(`[${new Date().toLocaleTimeString()}] ${req.url} -> CREDIT_LIMIT: ${err.message}`);
          return sendJson(res, 429, {
            error: "CREDIT_LIMIT",
            message: err.message,
            // Claude स्वतः सांगतो की मर्यादा कधी रीसेट होईल — ती वेळ पुढे
            // पाठवतो जेणेकरून n8n च्या execution log मध्ये दिसेल.
            resetsAt: err.resetsAt ?? null,
            remaining: err.remaining ?? null,
          });
        }
        throw err;
      }
      console.log(`[${new Date().toLocaleTimeString()}] ${req.url} -> उत्तर मिळाले (${response.length} अक्षरे)`);

      return sendJson(res, 200, { response });
    }

    if (req.method === "POST" && req.url === "/doc/start") {
      const paths = await liveDoc.start();
      console.log(`[${new Date().toLocaleTimeString()}] /doc/start -> ${paths.docxPath}`);
      return sendJson(res, 200, { ok: true, ...paths });
    }

    if (req.method === "POST" && req.url === "/doc/append") {
      const body = await readJsonBody(req);
      if (!body.title || !body.text) {
        return sendJson(res, 400, { error: "'title' आणि 'text' field आवश्यक आहेत." });
      }
      const result = await liveDoc.append({ title: body.title, text: body.text, color: body.color });
      console.log(
        `[${new Date().toLocaleTimeString()}] /doc/append <- "${body.title.slice(0, 50)}" (${body.color || "black"}) -> एकूण ${result.count} titles`
      );
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && req.url === "/doc/finish") {
      const paths = await liveDoc.finish();
      console.log(
        `[${new Date().toLocaleTimeString()}] /doc/finish -> ` +
          (paths.nothingToFinish
            ? "बंद करण्यासारखे काही नव्हते (एकही title प्रोसेस झाला नाही?)"
            : paths.docxPath)
      );

      // सर्व titles संपले — आता Gemini/Grok/Claude चे tabs/ब्राउझर बंद करतो
      closeAllContexts()
        .then(() => console.log(`[${new Date().toLocaleTimeString()}] सर्व AI tabs बंद केले.`))
        .catch((err) => console.error("tabs बंद करताना अडचण (दुर्लक्ष करा):", err.message));

      return sendJson(res, 200, { ok: true, ...paths });
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    console.error("Error:", err.message);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Automation server सुरू: http://localhost:${PORT}`);
  console.log("हा टर्मिनल उघडाच ठेवा — n8n workflow चालवताना हा server लागतो.");
});

// टर्मिनल Ctrl+C ने बंद केल्यास उघडे राहिलेले AI browser tabs पण नीट बंद करतो
process.on("SIGINT", async () => {
  console.log("\nसर्व्हर बंद करत आहे, आधी browser tabs बंद करतो...");
  try {
    await closeAllContexts();
  } catch (_) {}
  process.exit(0);
});
