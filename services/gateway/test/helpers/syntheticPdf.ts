import { createHash } from 'node:crypto';

// Synthetic PDF bytes only: no customer data, external fixture downloads or test dependencies.
// R2 encryption below is intentionally obsolete PDF fixture encoding, never application security.
const padding = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = (data: Buffer) => createHash('md5').update(data).digest();
const pad = (text: string) => Buffer.concat([Buffer.from(text, 'ascii'), padding]).subarray(0, 32);
function rc4(key: Buffer, data: Buffer) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + s[i]! + key[i % key.length]!) % 256; [s[i], s[j]] = [s[j]!, s[i]!]; }
  let i = 0; j = 0;
  return Buffer.from(data.map(byte => { i = (i + 1) % 256; j = (j + s[i]!) % 256; [s[i], s[j]] = [s[j]!, s[i]!]; return byte ^ s[(s[i]! + s[j]!) % 256]!; }));
}
export function syntheticPdf(pages: string[], options: { chinese?: boolean; password?: string; action?: boolean; brokenStream?: boolean } = {}) {
  const objects: Buffer[] = [];
  const add = (value: string | Buffer) => { objects.push(typeof value === 'string' ? Buffer.from(value, 'ascii') : value); return objects.length; };
  const fileId = Buffer.alloc(16, 42);
  let key: Buffer | undefined;
  let encryption: string | undefined;
  if (options.password !== undefined) {
    const owner = rc4(md5(pad('fixture-owner')).subarray(0, 5), pad(options.password));
    const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
    key = md5(Buffer.concat([pad(options.password), owner, permissions, fileId])).subarray(0, 5);
    encryption = `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString('hex')}> /U <${rc4(key, padding).toString('hex')}> /P -4 >>`;
  }
  add(`<< /Type /Catalog /Pages 2 0 R ${options.action ? '/OpenAction << /S /JavaScript /JS <7468726f77206e6577204572726f7228226261642229> >>' : ''} >>`);
  add('');
  add(options.chinese ? '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>' : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  if (options.chinese) add('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>');
  const refs = [];
  for (const text of pages) {
    const page = objects.length + 1;
    refs.push(`${page} 0 R`);
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`);
    const commands = (text.match(/[\s\S]{1,70}/gu) ?? []).map((line, index) => {
      const hex = options.chinese ? Buffer.from(line, 'utf16le').swap16().toString('hex') : Buffer.from(line, 'ascii').toString('hex');
      return `BT /F1 12 Tf 72 ${720 - (index % 50) * 12} Td <${hex}> Tj ET`;
    });
    let stream = Buffer.from(text ? commands.join('\n') : '0 0 0 rg 30 30 200 200 re f', 'ascii');
    if (key) { const suffix = Buffer.alloc(5); suffix.writeUIntLE(page + 1, 0, 3); stream = rc4(md5(Buffer.concat([key, suffix])).subarray(0, 10), stream); }
    add(Buffer.concat([Buffer.from(`<< /Length ${stream.length}${options.brokenStream ? ' /Filter /FlateDecode' : ''} >>\nstream\n`), stream, Buffer.from('\nendstream')]));
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${refs.join(' ')}] >>`);
  const encryptRef = encryption ? add(encryption) : undefined;
  const chunks = [Buffer.from('%PDF-1.7\n')];
  const offsets = [0];
  let length = chunks[0]!.length;
  objects.forEach((object, i) => { offsets.push(length); const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); chunks.push(chunk); length += chunk.length; });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => offset.toString().padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encryptRef ? `/Encrypt ${encryptRef} 0 R /ID [<${fileId.toString('hex')}> <${fileId.toString('hex')}>]` : ''} >>\nstartxref\n${length}\n%%EOF`));
  return Buffer.concat(chunks);
}
