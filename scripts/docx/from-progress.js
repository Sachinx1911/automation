// Recovery स्क्रिप्ट — output/progress.jsonl मधून थेट Word फाईल तयार करते.
//
// कधी वापरायची:
//   मोठा run मध्येच थांबला (n8n बंद पडले, execution timeout, लॅपटॉप झोपला, इ.)
//   तर जेवढ्या titles चे काम झाले आहे ते वाया जाऊ नये म्हणून. server प्रत्येक
//   title चा निकाल मिळताच progress.jsonl मध्ये लिहित असतो, त्यामुळे तिथून
//   पूर्ण Word फाईल परत बनवता येते.
//
// वापर:
//   node scripts/docx/from-progress.js
//   node scripts/docx/from-progress.js output/माझी-फाईल.docx

const fs = require("fs");
const path = require("path");
const { buildDocxBuffer } = require("./create-docx");

const OUTPUT_DIR = path.join(__dirname, "..", "..", "output");
const PROGRESS_FILE = path.join(OUTPUT_DIR, "progress.jsonl");

function readProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) {
    throw new Error(`progress फाईल सापडली नाही: ${PROGRESS_FILE}`);
  }

  const lines = fs.readFileSync(PROGRESS_FILE, "utf-8").split("\n").filter((l) => l.trim());
  const byTitle = new Map();

  lines.forEach((line, idx) => {
    try {
      const row = JSON.parse(line);
      if (row.title) {
        // तोच title पुन्हा आला असल्यास सर्वात नवीन नोंद ठेवतो
        byTitle.set(row.title, { title: row.title, output: row.output, color: row.color });
      }
    } catch (_) {
      console.warn(`ओळ ${idx + 1} वाचता आली नाही, वगळली.`);
    }
  });

  return [...byTitle.values()];
}

async function main() {
  const results = readProgress();
  if (!results.length) {
    throw new Error("progress.jsonl मध्ये एकही पूर्ण झालेला title नाही.");
  }

  const outputPath =
    process.argv[2] ||
    path.join(OUTPUT_DIR, `Result_from_progress_${new Date().toISOString().replace(/[:.]/g, "-")}.docx`);

  const buffer = await buildDocxBuffer(results);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);

  console.log(`${results.length} titles सापडले.`);
  console.log(`Word फाईल तयार: ${outputPath}`);
}

main().catch((err) => {
  console.error("from-progress error:", err.message);
  process.exit(1);
});
