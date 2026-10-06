import { Document, Packer, Paragraph, TextRun } from 'docx';
import * as xlsx from 'xlsx';
import PDFDocument from 'pdfkit';

export async function createTestDocx(
  items: { question: string; choices: string[]; answer?: string; explanation?: string }[]
): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: `Question ${i + 1}: ${item.question}`, bold: true })],
      })
    );

    for (const choice of item.choices) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: choice })],
        })
      );
    }

    if (item.answer) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `Answer: ${item.answer}` })],
        })
      );
    }

    if (item.explanation) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `Explanation: ${item.explanation}` })],
        })
      );
    }

    paragraphs.push(new Paragraph({ children: [] }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

export function createTestXlsx(sheets: { name: string; data: (string | number)[][] }[]): Buffer {
  const wb = xlsx.utils.book_new();
  for (const sheetDef of sheets) {
    const ws = xlsx.utils.aoa_to_sheet(sheetDef.data);
    xlsx.utils.book_append_sheet(wb, ws, sheetDef.name);
  }
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export async function createTestPdf(pages: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    for (const pageText of pages) {
      doc.addPage();
      doc.fontSize(12).text(pageText, 50, 50);
    }

    doc.end();
  });
}

export async function createImageOnlyPdf(): Promise<Buffer> {
  return createTestPdf(['   \n   \n   ']);
}
