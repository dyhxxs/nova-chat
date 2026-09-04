import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  classifyAttachment,
  extractAttachmentText,
  isSupportedMimeType,
  matchesFileSignature,
  mimeTypeForName,
} from '../src/attachments.js';

function zip(entries: Record<string, string>): Buffer {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)]))));
}

describe('attachment classification and text extraction', () => {
  it('infers a text file from its name when the picker reports octet-stream', () => {
    const bytes = Buffer.from('\ufeffhello\nworld', 'utf8');
    expect(mimeTypeForName('notes.txt')).toBe('text/plain');
    expect(classifyAttachment('notes.txt', 'application/octet-stream', bytes)).toMatchObject({ mimeType: 'text/plain', kind: 'document', extension: '.txt' });
    expect(extractAttachmentText('text/plain', bytes)).toBe('hello\nworld');
  });

  it('accepts structured text formats and rejects NUL-containing payloads', () => {
    const json = Buffer.from('{"name":"Nova","enabled":true}', 'utf8');
    expect(classifyAttachment('config.json', 'application/json', json)?.mimeType).toBe('application/json');
    expect(extractAttachmentText('application/json', json)).toContain('"Nova"');
    expect(classifyAttachment('binary.json', 'application/json', Buffer.from([0x7b, 0x00, 0x7d]))).toBeUndefined();
  });

  it('extracts DOCX text and safely decodes invalid XML code points', () => {
    const bytes = zip({
      '[Content_Types].xml': '<Types />',
      'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hello &amp; world &#x110000;</w:t></w:r></w:p></w:body></w:document>',
    });
    expect(classifyAttachment('report.docx', 'application/octet-stream', bytes)).toMatchObject({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document',
    });
    expect(extractAttachmentText('application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes)).toBe('Hello & world �');
  });

  it('resolves shared strings only for cells marked with t="s" and keeps inline strings intact', () => {
    const bytes = zip({
      'xl/workbook.xml': '<workbook />',
      'xl/sharedStrings.xml': '<sst><si><t>Shared value</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>123</t></is></c><c r="C1"><v>42</v></c></row></worksheet>',
    });
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(classifyAttachment('table.xlsx', 'application/octet-stream', bytes)?.mimeType).toBe(mime);
    expect(extractAttachmentText(mime, bytes)).toBe('Shared value\t123\t42');
  });

  it('extracts presentation, OpenDocument, and EPUB text', () => {
    const pptx = zip({
      'ppt/presentation.xml': '<p:presentation />',
      'ppt/slides/slide1.xml': '<p:sld><a:t>Slide one</a:t></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:t>Slide two</a:t></p:sld>',
    });
    const pptMime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    expect(classifyAttachment('deck.pptx', pptMime, pptx)).toBeTruthy();
    expect(extractAttachmentText(pptMime, pptx)).toBe('Slide one\n\nSlide two');

    const odt = zip({ 'content.xml': '<office:document-content><text:p>Open document</text:p></office:document-content>' });
    const odtMime = 'application/vnd.oasis.opendocument.text';
    expect(classifyAttachment('notes.odt', odtMime, odt)).toBeTruthy();
    expect(extractAttachmentText(odtMime, odt)).toBe('Open document');

    const epub = zip({ mimetype: 'application/epub+zip', 'OEBPS/chapter.xhtml': '<html><body><p>Chapter one</p></body></html>' });
    expect(classifyAttachment('book.epub', 'application/epub+zip', epub)).toBeTruthy();
    expect(extractAttachmentText('application/epub+zip', epub)).toBe('Chapter one');
  });

  it('recognizes MOBI, HEIF/AVIF, BMP, and TIFF signatures', () => {
    const mobi = Buffer.alloc(68);
    mobi.write('BOOKMOBI', 60, 'ascii');
    expect(isSupportedMimeType('application/x-mobipocket-ebook')).toBe(true);
    expect(classifyAttachment('book.mobi', 'application/octet-stream', mobi)).toMatchObject({ mimeType: 'application/x-mobipocket-ebook', kind: 'document' });

    const avif = Buffer.alloc(20);
    avif.write('ftypavif', 4, 'ascii');
    expect(matchesFileSignature('image/avif', avif)).toBe(true);
    expect(classifyAttachment('photo.avif', 'image/avif', avif)?.kind).toBe('image');
    expect(classifyAttachment('photo.bmp', 'image/bmp', Buffer.from([0x42, 0x4d, 0x00]))?.kind).toBe('image');
    expect(classifyAttachment('photo.tiff', 'image/tiff', Buffer.from([0x49, 0x49, 0x2a, 0x00]))?.kind).toBe('image');
  });

  it('does not trust a filename when the file signature is wrong', () => {
    expect(classifyAttachment('fake.pdf', 'application/pdf', Buffer.from('not a pdf'))).toBeUndefined();
    expect(classifyAttachment('fake.docx', 'application/octet-stream', Buffer.from('not a zip'))).toBeUndefined();
    expect(classifyAttachment('fake.png', 'image/png', Buffer.from('not a png'))).toBeUndefined();
  });
});