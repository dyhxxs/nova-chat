// @ts-check
import { Buffer } from 'node:buffer';
import { parentPort, workerData } from 'node:worker_threads';
import { open, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// This worker only receives an internal attachment path, never a user-supplied URL.
// PDF.js 6 removed its old isEvalSupported option. We do NOT load its scripting
// sandbox, render pages, enumerate actions/attachments, or follow document links.
// Keep a pending parser alive until the parent enforces its deadline.
parentPort?.ref();
const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
class LocalBinaryDataFactory {
  /** @param {{kind: string, filename: string}} input */
  async fetch({ kind, filename }) {
    const directory = kind === 'cMapUrl' ? 'cmaps' : kind === 'standardFontDataUrl' ? 'standard_fonts' : undefined;
    if (!directory || !/^[A-Za-z0-9_.-]+$/.test(filename) || filename.startsWith('.')) throw new Error('Invalid PDF resource');
    return new Uint8Array(await readFile(path.join(root, directory, filename)));
  }
}
class RejectedPdf extends Error {
  /** @param {string} code */
  constructor(code) { super(code); this.code = code; }
}
async function extract() {
  const { filePath } = /** @type {{filePath: string}} */ (workerData);
  const handle = await open(filePath, 'r');
  let bytes;
  try {
    const { size } = await handle.stat();
    if (size > 25 * 1024 * 1024) throw new RejectedPdf('pdf_too_large');
    // Bound the read even if a local file changes between stat/read.
    bytes = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    if (offset > size) throw new RejectedPdf('pdf_invalid');
    bytes = bytes.subarray(0, offset);
  } finally { await handle.close(); }
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new RejectedPdf('pdf_invalid');
  const loading = getDocument({
    data: new Uint8Array(bytes), verbosity: 0, stopAtErrors: true,
    enableXfa: false, useWasm: false, useSystemFonts: false, disableFontFace: true,
    useWorkerFetch: false, BinaryDataFactory: LocalBinaryDataFactory,
  });
  {
    const pdf = await loading.promise;
    if (pdf.numPages > 200) throw new RejectedPdf('pdf_too_many_pages');
    if (await pdf.getPermissions() !== null) throw new RejectedPdf('pdf_encrypted');
    const parts = [`【PDF 文字提取：共${pdf.numPages}页；仅含文字层，图片、表单及排版可能遗漏，请核对原文件。】`];
    let chars = parts.join('').length;
    let rawChars = 0;
    const pagesWithoutText = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const reader = page.streamTextContent().getReader();
      let text = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const item of /** @type {import('pdfjs-dist/types/src/display/api.js').TextContent} */ (value).items) {
            if (!('str' in item)) continue;
            rawChars += item.str.length;
            if (rawChars > 120_000) throw new RejectedPdf('pdf_too_much_text');
            text += item.str.replaceAll('\u0000', '') + (item.hasEOL ? '\n' : ' ');
            if (chars + text.length > 120_000) throw new RejectedPdf('pdf_too_much_text');
          }
        }
      } finally { reader.releaseLock(); page.cleanup(); }
      text = text.trim();
      if (!text) { pagesWithoutText.push(number); text = '未提取到文字：可能为空白页或扫描内容，需要核对原文件 / OCR。'; }
      const section = `\n\n【第 ${number} 页】\n${text}`;
      chars += section.length;
      if (chars > 120_000) throw new RejectedPdf('pdf_too_much_text');
      parts.push(section);
    }
    if (pagesWithoutText.length === pdf.numPages) throw new RejectedPdf('pdf_no_text');
    return { text: parts.join(''), importInfo: { format: 'pdf', pages: pdf.numPages, pagesWithoutText } };
  }
  // The parent terminates this one-shot worker after either result. Do not await
  // PDF.js cancellation here: a failed text stream can leave cleanup pending.
}
try { parentPort?.postMessage({ ok: true, ...await extract() }); }
catch (error) {
  parentPort?.postMessage({ ok: false, code: error instanceof RejectedPdf ? error.code : error instanceof Error && error.name === 'PasswordException' ? 'pdf_encrypted' : 'pdf_invalid' });
}
