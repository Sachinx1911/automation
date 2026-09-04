// "Live" Word डॉक्युमेंट — workflow सुरू होताच फाईल तयार करून प्रत्येक title चा
// निकाल आल्याबरोबर त्यात जोडून सेव्ह करतो, पण फाईल **उघडत नाही** तोपर्यंत सर्व
// titles चे काम पूर्ण होत नाही (finish() ला) — म्हणजे मध्येच उघडून लॉक होत नाही
// आणि save अडखळत नाही.
//
// एका वेळी एकच run active असतो असे गृहीत धरले आहे (server restart झाल्याशिवाय
// दुसरा run सुरू केल्यास आधीचा state बदलतो).

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { buildDocxBuffer } = require("./create-docx");

const OUTPUT_DIR = path.join(__dirname, "..", "..", "output");
const PROGRESS_FILE = path.join(OUTPUT_DIR, "progress.jsonl");

let current = null; // { entries: [{title, output, color}], docxPath, txtPath }

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function openFile(filePath) {
  try {
    exec(`start "" "${filePath}"`, (err) => {
      if (err) console.error("फाईल उघडता आली नाही (दुर्लक्ष करा, चालू राहील):", err.message);
    });
  } catch (err) {
    console.error("फाईल उघडता आली नाही (दुर्लक्ष करा, चालू राहील):", err.message);
  }
}

function writeTxt(txtPath, entries) {
  const text = entries
    .map((e) => `# ${e.title}\n\n${e.output}\n`)
    .join("\n" + "-".repeat(40) + "\n\n");
  fs.writeFileSync(txtPath, text || "कार्य सुरू आहे...\n", "utf-8");
}

async function saveDocx() {
  const buffer = await buildDocxBuffer(current.entries);

  // Word मध्ये फाईल उघडी असेल तर ती लॉक असू शकते (EBUSY) — असे झाल्यास
  // पूर्ण प्रोसेस थांबवायची नाही; progress.jsonl मध्ये डेटा सुरक्षित आहेच,
  // आणि नंतर 'npm run docx:recover' ने पूर्ण फाईल परत बनवता येते.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(current.docxPath, buffer);
      break;
    } catch (err) {
      if ((err.code === "EBUSY" || err.code === "EPERM") && attempt === 0) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      console.error(
        `Word फाईल सध्या दुसऱ्या प्रोग्रामने उघडलेली/लॉक असल्याने या क्षणी सेव्ह होऊ शकली नाही (${err.code}). ` +
          `डेटा progress.jsonl मध्ये सुरक्षित आहे — फाईल बंद करून नंतर 'npm run docx:recover' चालवा.`
      );
      break;
    }
  }

  try {
    writeTxt(current.txtPath, current.entries);
  } catch (err) {
    console.error("txt फाईल सेव्ह होऊ शकली नाही:", err.message);
  }
}

async function start() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  // नवीन run सुरू होताच जुना progress log साफ करतो (recovery फक्त चालू run साठी)
  try {
    fs.rmSync(PROGRESS_FILE, { force: true });
  } catch (_) {}

  const ts = timestamp();
  current = {
    entries: [],
    docxPath: path.join(OUTPUT_DIR, `Result_${ts}.docx`),
    txtPath: path.join(OUTPUT_DIR, `Result_${ts}.txt`),
  };

  await saveDocx();

  return { docxPath: current.docxPath, txtPath: current.txtPath };
}

async function append({ title, text, color }) {
  if (!current) {
    // सुरक्षिततेसाठी — /doc/start आधी चुकून चुकला असेल तर आपोआप सुरू करतो
    await start();
  }

  const entry = { title, output: text, color: color === "red" ? "red" : "black" };
  current.entries.push(entry);

  try {
    fs.appendFileSync(PROGRESS_FILE, JSON.stringify({ ...entry, at: new Date().toISOString() }) + "\n");
  } catch (err) {
    console.error("progress लिहिता आले नाही:", err.message);
  }

  await saveDocx();

  return { docxPath: current.docxPath, txtPath: current.txtPath, count: current.entries.length };
}

async function finish() {
  if (!current) {
    throw new Error("कोणताही active document नाही (आधी /doc/start झालेच नाही).");
  }
  await saveDocx();
  const result = { docxPath: current.docxPath, txtPath: current.txtPath };
  current = null;

  // सर्व titles चे काम पूर्ण झाल्यावरच फाईल उघडतो — मध्येच उघडल्यास ती लॉक
  // होऊन पुढच्या saves अडखळतात, म्हणून शेवटीच उघडणे सुरक्षित.
  openFile(result.docxPath);

  return result;
}

module.exports = { start, append, finish };
