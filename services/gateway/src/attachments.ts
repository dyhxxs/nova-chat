import { unzipSync } from 'fflate';

export type AttachmentKind = 'image' | 'document';

export type ClassifiedAttachment = {
  mimeType: string;
  kind: AttachmentKind;
  extension: string;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.text': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.geojson': 'application/geo+json',
  '.graphql': 'application/graphql',
  '.gql': 'application/graphql',
  '.xml': 'application/xml',
  '.xhtml': 'application/xhtml+xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.jsx': 'text/javascript',
  '.vue': 'text/html',
  '.svelte': 'text/html',
  '.dart': 'text/x-dart',
  '.r': 'text/x-r',
  '.tex': 'text/x-tex',
  '.py': 'text/x-python',
  '.java': 'text/x-java-source',
  '.kt': 'text/x-kotlin',
  '.kts': 'text/x-kotlin',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cc': 'text/x-c++',
  '.cpp': 'text/x-c++',
  '.cxx': 'text/x-c++',
  '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.rb': 'text/x-ruby',
  '.php': 'text/x-php',
  '.swift': 'text/x-swift',
  '.sh': 'application/x-sh',
  '.bash': 'application/x-sh',
  '.zsh': 'application/x-sh',
  '.sql': 'text/x-sql',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.ini': 'text/plain',
  '.log': 'text/plain',
  '.srt': 'text/plain',
  '.vtt': 'text/vtt',
  '.ics': 'text/calendar',
  '.vcf': 'text/vcard',
  '.properties': 'text/plain',
  '.env': 'text/plain',
  '.rtf': 'application/rtf',
  '.doc': 'application/msword',
  '.dot': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  '.docm': 'application/vnd.ms-word.document.macroenabled.12',
  '.dotm': 'application/vnd.ms-word.template.macroenabled.12',
  '.xls': 'application/vnd.ms-excel',
  '.xlt': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xltx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroenabled.12',
  '.xltm': 'application/vnd.ms-excel.template.macroenabled.12',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pps': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.potx': 'application/vnd.openxmlformats-officedocument.presentationml.template',
  '.pptm': 'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  '.potm': 'application/vnd.ms-powerpoint.template.macroenabled.12',
  '.ppsx': 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  '.ppsm': 'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  '.epub': 'application/epub+zip',
  '.mobi': 'application/x-mobipocket-ebook',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ott': 'application/vnd.oasis.opendocument.text-template',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.ots': 'application/vnd.oasis.opendocument.spreadsheet-template',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.otp': 'application/vnd.oasis.opendocument.presentation-template',
};

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif', 'image/bmp', 'image/tiff',
]);
const TEXT_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values', 'text/html', 'text/css',
  'text/javascript', 'text/typescript', 'text/x-python', 'text/x-java-source', 'text/x-kotlin', 'text/x-c',
  'text/x-c++', 'text/x-csharp', 'text/x-go', 'text/x-rust', 'text/x-ruby', 'text/x-php', 'text/x-swift', 'text/x-dart', 'text/x-r', 'text/x-tex',
  'text/x-sql', 'text/vtt', 'text/calendar', 'text/vcard', 'application/json', 'application/jsonl', 'application/geo+json', 'application/graphql', 'application/xml', 'application/xhtml+xml',
  'application/yaml', 'application/toml', 'application/x-sh', 'application/rtf',
]);
const ZIP_DOCUMENT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-word.template.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.template.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  'application/epub+zip',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.text-template',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.spreadsheet-template',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.presentation-template',
]);
const EBOOK_MIME_TYPES = new Set(['application/epub+zip', 'application/x-mobipocket-ebook']);
const OLE_DOCUMENT_MIME_TYPES = new Set([
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.ms-works',
]);

export function normalizeMimeType(value: string | null | undefined): string {
  return String(value ?? '').split(';', 1)[0]!.trim().toLowerCase();
}

export function extensionForName(name: string): string {
  const match = pathExtension(name);
  return match;
}

function pathExtension(name: string): string {
  const clean = name.split(/[?#]/, 1)[0]!.trim().toLowerCase();
  const dot = clean.lastIndexOf('.');
  return dot > 0 ? clean.slice(dot) : '';
}

export function mimeTypeForName(name: string): string | undefined {
  const extension = pathExtension(name);
  return MIME_BY_EXTENSION[extension];
}

export function isSupportedMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return IMAGE_MIME_TYPES.has(normalized) || TEXT_MIME_TYPES.has(normalized) || normalized === 'application/pdf' || ZIP_DOCUMENT_MIME_TYPES.has(normalized) || OLE_DOCUMENT_MIME_TYPES.has(normalized) || EBOOK_MIME_TYPES.has(normalized);
}

export function isImageMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(normalizeMimeType(mimeType));
}

export function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.has(normalizeMimeType(mimeType));
}

export function isZipDocumentMimeType(mimeType: string): boolean {
  return ZIP_DOCUMENT_MIME_TYPES.has(normalizeMimeType(mimeType));
}

export function isLegacyOfficeMimeType(mimeType: string): boolean {
  return OLE_DOCUMENT_MIME_TYPES.has(normalizeMimeType(mimeType));
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
    && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
}

function isOleCompoundFile(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).every((value, index) => value === [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1][index]);
}

function isHeifFamily(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(4, 8)) !== 'ftyp') return false;
  const brands: string[] = [];
  for (let index = 8; index + 4 <= Math.min(bytes.length, 64); index += 4) {
    brands.push(String.fromCharCode(...bytes.subarray(index, index + 4)));
  }
  return brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis'].includes(brand));
}

function isLikelyUtf8Text(bytes: Uint8Array): boolean {
  if (!bytes.length) return false;
  if (bytes.subarray(0, Math.min(bytes.length, 4_096)).includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 1_000_000)));
    return true;
  } catch {
    return false;
  }
}

const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_EXTRACT_BYTES = 24 * 1024 * 1024;

function unzipSelected(bytes: Uint8Array, shouldKeep: (name: string) => boolean): Record<string, Uint8Array> | undefined {
  if (!isZip(bytes)) return undefined;
  let extractedBytes = 0;
  let blocked = false;
  try {
    const files = unzipSync(bytes, {
      filter: (file) => {
        if (!shouldKeep(file.name)) return false;
        if (file.name.length >= 512 || file.originalSize > MAX_ZIP_ENTRY_BYTES || extractedBytes + file.originalSize > MAX_ZIP_EXTRACT_BYTES) {
          blocked = true;
          return false;
        }
        extractedBytes += file.originalSize;
        return true;
      },
    });
    return blocked ? undefined : files;
  } catch {
    return undefined;
  }
}

function zipContainsExpectedParts(mimeType: string, bytes: Uint8Array): boolean {
  const normalized = normalizeMimeType(mimeType);
  const files = unzipSelected(bytes, (name) => {
    if (normalized.startsWith('application/vnd.openxmlformats-officedocument.word') || normalized.startsWith('application/vnd.ms-word.')) return name === 'word/document.xml';
    if (normalized.startsWith('application/vnd.openxmlformats-officedocument.spreadsheet') || normalized.startsWith('application/vnd.ms-excel.')) return name.startsWith('xl/') && name.endsWith('.xml');
    if (normalized.startsWith('application/vnd.openxmlformats-officedocument.presentation') || normalized.startsWith('application/vnd.ms-powerpoint.')) return name.startsWith('ppt/') && name.endsWith('.xml');
    if (normalized.startsWith('application/vnd.oasis.opendocument.')) return name === 'content.xml';
    if (normalized === 'application/epub+zip') return name === 'mimetype' || /^.+\.(xhtml|html)$/i.test(name);
    return false;
  });
  if (!files) return false;
  const names = Object.keys(files);
  if (normalized.startsWith('application/vnd.openxmlformats-officedocument.word') || normalized.startsWith('application/vnd.ms-word.')) return names.includes('word/document.xml');
  if (normalized.startsWith('application/vnd.openxmlformats-officedocument.spreadsheet') || normalized.startsWith('application/vnd.ms-excel.')) return names.some((name) => name.startsWith('xl/') && name.endsWith('.xml'));
  if (normalized.startsWith('application/vnd.openxmlformats-officedocument.presentation') || normalized.startsWith('application/vnd.ms-powerpoint.')) return names.some((name) => name.startsWith('ppt/slides/') && name.endsWith('.xml'));
  if (normalized.startsWith('application/vnd.oasis.opendocument.')) return names.includes('content.xml');
  if (normalized === 'application/epub+zip') return names.includes('mimetype') && names.some((name) => /^.+\.(xhtml|html)$/i.test(name));
  return false;
}

export function matchesFileSignature(mimeTypeInput: string, bytes: Buffer): boolean {
  const mimeType = normalizeMimeType(mimeTypeInput);
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/gif') return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (mimeType === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'image/heic' || mimeType === 'image/heif' || mimeType === 'image/avif') return isHeifFamily(bytes);
  if (mimeType === 'image/bmp') return bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;
  if (mimeType === 'image/tiff') return bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a));
  if (mimeType === 'application/epub+zip') return zipContainsExpectedParts(mimeType, bytes);
  if (mimeType === 'application/x-mobipocket-ebook') return bytes.length >= 68 && bytes.subarray(60, 68).toString('ascii') === 'BOOKMOBI';
  if (mimeType === 'application/pdf') return bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'application/rtf') return bytes.subarray(0, 5).toString('ascii').toLowerCase() === '{\\rtf';
  if (isTextMimeType(mimeType)) return isLikelyUtf8Text(bytes);
  if (isZipDocumentMimeType(mimeType)) return zipContainsExpectedParts(mimeType, bytes);
  if (isLegacyOfficeMimeType(mimeType)) return isOleCompoundFile(bytes);
  return false;
}

export function classifyAttachment(name: string, declaredMimeType: string | null | undefined, bytes: Buffer): ClassifiedAttachment | undefined {
  const declared = normalizeMimeType(declaredMimeType);
  const extension = extensionForName(name);
  const byName = mimeTypeForName(name);
  const mimeType = !declared || declared === 'application/octet-stream' || declared === 'binary/octet-stream'
    ? byName
    : declared;
  if (!mimeType) return undefined;
  if (!IMAGE_MIME_TYPES.has(mimeType) && !TEXT_MIME_TYPES.has(mimeType) && mimeType !== 'application/pdf'
    && !ZIP_DOCUMENT_MIME_TYPES.has(mimeType) && !OLE_DOCUMENT_MIME_TYPES.has(mimeType) && !EBOOK_MIME_TYPES.has(mimeType)) return undefined;
  if (!matchesFileSignature(mimeType, bytes)) return undefined;
  return { mimeType, kind: IMAGE_MIME_TYPES.has(mimeType) ? 'image' : 'document', extension: extension || extensionForMimeType(mimeType) };
}

export function extensionForMimeType(mimeTypeInput: string): string {
  const mimeType = normalizeMimeType(mimeTypeInput);
  const entry = Object.entries(MIME_BY_EXTENSION).find(([, value]) => value === mimeType);
  return entry?.[0] ?? '';
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, decimal: string) => safeCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/gi, (_, hexadecimal: string) => safeCodePoint(Number.parseInt(hexadecimal, 16)));
}

function safeCodePoint(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
    ? String.fromCodePoint(value)
    : '\uFFFD';
}

function xmlText(xml: string): string {
  return decodeEntities(xml
    .replace(/<w:tab\s*\/?>(?:<\/w:tab>)?/gi, '\t')
    .replace(/<w:br\s*\/?>(?:<\/w:br>)?/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<\/text:p>/gi, '\n')
    .replace(/<\/text:h>/gi, '\n')
    .replace(/<\/a:p>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractZipText(mimeTypeInput: string, bytes: Uint8Array): string | undefined {
  const mimeType = normalizeMimeType(mimeTypeInput);
  const extracted = unzipSelected(bytes, (name) => {
    if (mimeType.startsWith('application/vnd.openxmlformats-officedocument.word') || mimeType.startsWith('application/vnd.ms-word.')) return name === 'word/document.xml';
    if (mimeType.startsWith('application/vnd.openxmlformats-officedocument.presentation') || mimeType.startsWith('application/vnd.ms-powerpoint.')) return /^ppt\/slides\/slide\d+\.xml$/i.test(name);
    if (mimeType.startsWith('application/vnd.openxmlformats-officedocument.spreadsheet') || mimeType.startsWith('application/vnd.ms-excel.')) return /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/i.test(name);
    if (mimeType === 'application/epub+zip') return /^.+\.(xhtml|html)$/i.test(name);
    if (mimeType.startsWith('application/vnd.oasis.opendocument.')) return name === 'content.xml';
    return false;
  });
  if (!extracted) return undefined;
  const files = extracted;
  if (mimeType.startsWith('application/vnd.openxmlformats-officedocument.word') || mimeType.startsWith('application/vnd.ms-word.')) {
    const xml = files['word/document.xml'];
    return xml ? xmlText(decodeUtf8(xml)) : undefined;
  }
  if (mimeType.startsWith('application/vnd.openxmlformats-officedocument.presentation') || mimeType.startsWith('application/vnd.ms-powerpoint.')) {
    const slideNames = Object.keys(files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const text = slideNames.map((name) => xmlText(decodeUtf8(files[name]!))).filter(Boolean).join('\n\n');
    return text || undefined;
  }
  if (mimeType.startsWith('application/vnd.openxmlformats-officedocument.spreadsheet') || mimeType.startsWith('application/vnd.ms-excel.')) {
    const sharedStrings = files['xl/sharedStrings.xml']
      ? [...decodeUtf8(files['xl/sharedStrings.xml']!).matchAll(/<si\b[\s\S]*?<\/si>/gi)].map((match) => xmlText(match[0]!)).filter(Boolean)
      : [];
    const sheetNames = Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const sheets = sheetNames.map((name) => {
      const xml = decodeUtf8(files[name]!);
      const values: string[] = [];
      for (const cell of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
        const attributes = cell[1] ?? '';
        const body = cell[2] ?? '';
        const type = attributes.match(/\bt="([^"]+)"/i)?.[1] ?? '';
        const value = body.match(/<v[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? body.match(/<t[^>]*>([\s\S]*?)<\/t>/i)?.[1];
        if (value === undefined) continue;
        const cleaned = xmlText(value);
        if (type === 's' && /^\d+$/.test(cleaned)) values.push(sharedStrings[Number(cleaned)] ?? cleaned);
        else values.push(cleaned);
      }
      return values.join('\t');
    }).filter(Boolean).join('\n');
    return sheets || undefined;
  }
  if (mimeType === 'application/epub+zip') {
    const names = Object.keys(files).filter((name) => /^.+\.(xhtml|html)$/i.test(name)).sort();
    const text = names.map((name) => xmlText(decodeUtf8(files[name]!))).filter(Boolean).join('\n\n');
    return text || undefined;
  }
  if (mimeType.startsWith('application/vnd.oasis.opendocument.')) {
    const xml = files['content.xml'];
    return xml ? xmlText(decodeUtf8(xml)) : undefined;
  }
  return undefined;
}

function extractRtfText(value: string): string {
  return value.replace(/\\'[\da-f]{2}/gi, ' ').replace(/\\[a-z]+\d* ?/gi, ' ').replace(/[{}]/g, '').replace(/\s{2,}/g, ' ').trim();
}

export function extractAttachmentText(mimeTypeInput: string, bytes: Buffer, maxChars = 120_000): string | undefined {
  const mimeType = normalizeMimeType(mimeTypeInput);
  let text: string | undefined;
  if (mimeType === 'application/rtf') text = extractRtfText(decodeUtf8(bytes));
  else if (isTextMimeType(mimeType)) text = decodeUtf8(bytes);
  else if (isZipDocumentMimeType(mimeType)) text = extractZipText(mimeType, bytes);
  if (!text?.trim()) return undefined;
  return text.replaceAll('\u0000', '').trim().slice(0, maxChars);
}

export function attachmentTextPrompt(name: string, mimeType: string, bytes: Buffer): string | undefined {
  const text = extractAttachmentText(mimeType, bytes);
  if (!text) return undefined;
  return `[附件：${name}]\n${text}\n[/附件]`;
}
