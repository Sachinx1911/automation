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

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && CHAT_ROUTES[req.url]) {
      const body = await readJsonBody(req);
      const text = body.text;
      if (!text) {
        return sendJson(res, 400, { error: "'text' field आवश्यक आहे." });
      }
      const name = req.url.split("/").pop(); // gemini | grok | claude
      console.log(`[${new Date().toLocaleTimeString()}] ${req.url} <- "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);

      const response = await runQueued(name, () => CHAT_ROUTES[req.url](text));
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
      console.log(`[${new Date().toLocaleTimeString()}] /doc/finish -> ${paths.docxPath}`);

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
