import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PdfTextExtractor } from '../src/pdfText.js';
import { syntheticPdf } from './helpers/syntheticPdf.js';
let directory: string;
let serial = 0;
async function file(bytes: Buffer) { const name = path.join(directory, `${serial++}.pdf`); await writeFile(name, bytes); return name; }
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'nova-pdf-test-')); });
afterEach(async () => {
  const target = path.resolve(directory);
  if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('nova-pdf-test-')) throw new Error('Unsafe cleanup');
  await rm(target, { recursive: true, force: true });
});
describe('bounded isolated PDF text import', () => {
  it('extracts text with page markers and does not execute document JavaScript', async () => {
    const result = await new PdfTextExtractor().extract(await file(syntheticPdf(['Expense deadline 25', 'Travel approval'], { action: true })), 'a');
    expect(result.text).toContain('Expense deadline 25'); expect(result.text).toContain('【第 2 页】');
    expect(result.text).toContain('Travel approval'); expect(result.importInfo).toEqual({ format: 'pdf', pages: 2, pagesWithoutText: [] });
  });
  it('loads packaged local Chinese CMaps and extracts Chinese text', async () => {
    const result = await new PdfTextExtractor().extract(await file(syntheticPdf(['长沙项目报销截止日期每月二十五日'], { chinese: true })), 'a');
    expect(result.text).toContain('长沙项目报销截止日期每月二十五日');
  });
  it('preserves warnings for empty/image-only pages in a mixed document', async () => {
    const result = await new PdfTextExtractor().extract(await file(syntheticPdf(['Readable page', '', 'Last page'])), 'a');
    expect(result.importInfo.pagesWithoutText).toEqual([2]); expect(result.text).toContain('未提取到文字'); expect(result.text).toContain('【第 3 页】');
  });
  it('rejects documents with no text instead of indexing a fake OCR success', async () => {
    await expect(new PdfTextExtractor().extract(await file(syntheticPdf(['', ''])), 'a')).rejects.toMatchObject({ status: 415, code: 'pdf_no_text' });
  });
  it.each(['secret', ''])('rejects encryption, including an empty user password (%s)', async password => {
    await expect(new PdfTextExtractor().extract(await file(syntheticPdf(['Secret'], { password })), 'a')).rejects.toMatchObject({ status: 415, code: 'pdf_encrypted' });
  });
  it('refuses over-page PDFs without accepting a truncated prefix', async () => {
    await expect(new PdfTextExtractor().extract(await file(syntheticPdf(Array(201).fill('text'))), 'a')).rejects.toMatchObject({ status: 413, code: 'pdf_too_many_pages' });
  });
  it('refuses oversized extracted text, including marker overhead', async () => {
    await expect(new PdfTextExtractor().extract(await file(syntheticPdf(['a'.repeat(120001)])), 'a')).rejects.toMatchObject({ status: 413, code: 'pdf_too_much_text' });
  });
  it('refuses large input before parsing', async () => {
    await expect(new PdfTextExtractor().extract(await file(Buffer.alloc(25 * 1024 * 1024 + 1)), 'a')).rejects.toMatchObject({ code: 'pdf_too_large' });
  });
  it('sanitizes damaged file/path errors and remains usable after failure', async () => {
    const extractor = new PdfTextExtractor();
    for (const target of [path.join(directory, 'private-path'), await file(Buffer.from('%PDF-broken'))]) {
      await expect(extractor.extract(target, 'a')).rejects.toMatchObject({ code: 'pdf_invalid' });
    }
    expect((await extractor.extract(await file(syntheticPdf(['Recovered'])), 'a')).text).toContain('Recovered');
  });
  it('terminates on deadline and releases the real worker slot', async () => {
    const extractor = new PdfTextExtractor(1);
    const target = await file(syntheticPdf(['text']));
    await expect(extractor.extract(target, 'a')).rejects.toMatchObject({ code: 'pdf_timeout' });
    await expect(extractor.extract(target, 'a')).rejects.toMatchObject({ code: 'pdf_timeout' });
  });
  it('rejects overlapping account/global work without queueing file reads', async () => {
    const extractor = new PdfTextExtractor(); const target = await file(syntheticPdf(['text']));
    const a = extractor.extract(target, 'a');
    await expect(extractor.extract(target, 'a')).rejects.toMatchObject({ status: 429, code: 'pdf_busy' });
    const b = extractor.extract(target, 'b');
    await expect(extractor.extract(target, 'c')).rejects.toMatchObject({ code: 'pdf_busy' });
    await Promise.all([a, b]); expect((await extractor.extract(target, 'c')).text).toContain('text');
  });
});
