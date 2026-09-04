// वापर (CLI): node create-docx.js <input.json> <output.docx>
// किंवा दुसऱ्या स्क्रिप्टमधून: const { buildDocxBuffer } = require("./create-docx");
//
// results रचना:
// [ { title, output, color? }, ... ]
//   output = अंतिम मजकूर (Claude कडून, किंवा Claude bypass असल्यास Gemini+Grok चा एकत्र मजकूर)
//   color  = "red" (fallback/error सुचवण्यासाठी) किंवा "black"/न दिल्यास डीफॉल्ट काळा
// एकच Word फाईल तयार होते ज्यात प्रत्येक title साठी एक section असते.

const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  PageBreak,
} = require("docx");

const COLORS = { red: "FF0000", black: "000000" };

async function buildDocxBuffer(results) {
  const children = [];

  if (!Array.isArray(results) || results.length === 0) {
    children.push(
      new Paragraph({ children: [new TextRun("कार्य सुरू आहे... अजून कोणताही निकाल आलेला नाही.")] })
    );
  } else {
    results.forEach((item, idx) => {
      if (idx > 0) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }

      children.push(
        new Paragraph({
          text: item.title || `Title ${idx + 1}`,
          heading: HeadingLevel.HEADING_1,
        })
      );

      const color = COLORS[item.color] || COLORS.black;
      const text = (item.output || "(उत्तर मिळाले नाही)").toString();
      text.split(/\n+/).forEach((line) => {
        if (line.trim()) {
          children.push(
            new Paragraph({ children: [new TextRun({ text: line.trim(), color })] })
          );
        }
      });
    });
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildDocxBuffer };

if (require.main === module) {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) {
    console.error("वापर: node create-docx.js <input.json> <output.docx>");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

  buildDocxBuffer(data.results)
    .then((buffer) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, buffer);
      console.log(outputPath);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
