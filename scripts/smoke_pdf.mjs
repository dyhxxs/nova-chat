// One opt-in billable check; only synthetic PDF content. Existing users/config are not changed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { parse } from 'dotenv';
import { loadConfig } from '../services/gateway/dist/config.js';
import { AppDatabase } from '../services/gateway/dist/database.js';
import { syntheticPdf } from '../services/gateway/test/helpers/syntheticPdf.ts';
if (!process.argv.includes('--confirm-billable')) throw new Error('Requires --confirm-billable (one small model request).');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(path.join(root, 'services/gateway'));
const config = loadConfig({ ...parse(await readFile('.env', 'utf8')), ...process.env });
const db = new AppDatabase(config);
const base = 'http://127.0.0.1:8787';
const assert = (value, reason) => { if (!value) throw new Error(reason); };
const marker = 'NVCPDF-' + randomUUID().slice(0, 8);
const report = { checkedAt: new Date().toISOString(), gateway: base, version: '1.1.18', syntheticOnly: true, checks: [] };
let session; let admin; let document;
const files = [];
const request = async (route, options = {}) => {
  const response = await fetch(base + route, { ...options, headers: { ...options.headers, authorization: 'Bearer ' + session.token }, signal: AbortSignal.timeout(120000) });
  const body = await response.json(); return { response, body };
};
const call = async (route, method = 'GET', input) => {
  const { response, body } = await request(route, { method, ...(input ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : {}) });
  if (!response.ok) throw new Error('Gateway ' + response.status + ' ' + (body.error?.code || 'unknown'));
  return body;
};
const upload = async bytes => {
  const name = marker + '-' + files.length + '.pdf';
  const form = new FormData(); form.set('file', new Blob([bytes], { type: 'application/pdf' }), name);
  const { response, body } = await request('/v1/files', { method: 'POST', body: form });
  assert(response.ok && body.attachment?.id, 'Synthetic upload failed');
  files.push({ id: body.attachment.id, name }); return body.attachment;
};
try {
  admin = db.listUsers().find(user => user.role === 'admin' && !user.disabled); assert(admin, 'No active local admin');
  session = db.createSession(admin.id, 'pdf-live-verifier-1.1.18');
  const original = await upload(syntheticPdf([`晨星验收项目 ${marker} 的演示口令是竹林四二，集合会议室是银杏厅。此文档仅为自动化合成自测，不是真实用户资料。`, ''], { chinese: true }));
  const imported = await call('/v1/knowledge/import', 'POST', { fileId: original.id }); document = imported.document;
  assert(imported.importInfo.pages === 2 && imported.importInfo.pagesWithoutText.join(',') === '2', 'PDF diagnostics missing');
  const details = await call('/v1/knowledge/' + document.id);
  assert(details.document.text.includes('竹林四二') && details.document.text.includes('未提取到文字'), 'Extracted body missing text/warnings');
  const searched = await call('/v1/knowledge/search?q=' + encodeURIComponent('晨星验收 ' + marker));
  assert(searched.sources.some(source => source.documentId === document.id && source.excerpt.includes('竹林四二')), 'PDF not indexed');
  report.checks.push({ name: 'real_upload_pdf_chinese_page_warnings_and_search', ok: true });
  const noText = await upload(syntheticPdf(['']));
  const rejected = await request('/v1/knowledge/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileId: noText.id }) });
  assert(rejected.response.status === 415 && rejected.body.error.code === 'pdf_no_text', 'No-text PDF not rejected');
  report.checks.push({ name: 'real_no_text_pdf_rejected', ok: true });
  const payload = { requestId: randomUUID(), conversationId: randomUUID(), deviceId: 'pdf-live-device', messages: [{ role: 'user', content: `根据资料简短回答晨星验收 ${marker} 的演示口令和会议室，附上[资料N]引用。` }], options: { model: db.getProviderSettings().defaultModel, maxOutputTokens: 512, reasoningEffort: 'low', verbosity: 'low', knowledgeBase: true, autoTools: true, webSearch: true, codeInterpreter: true } };
  const answer = await call('/v1/chat', 'POST', payload);
  assert(answer.text.includes('竹林四二') && answer.text.includes('银杏厅') && /\[资料\d+\]/.test(answer.text), 'Answer did not cite synthetic PDF');
  assert(answer.knowledge?.sources.some(source => source.documentId === document.id) && !answer.tools?.length, 'Sources missing or external tools used');
  const job = await call(`/v1/chat/jobs/${payload.requestId}?conversationId=${payload.conversationId}`);
  assert(JSON.stringify(job.knowledge) === JSON.stringify(answer.knowledge), 'Job did not retain PDF citations');
  report.checks.push({ name: 'one_live_grounded_answer_and_job', ok: true, model: answer.model, text: answer.text });
  await call('/v1/knowledge/' + document.id, 'DELETE'); const deletedId = document.id; document = undefined;
  assert(!(await call('/v1/knowledge/search?q=' + encodeURIComponent(marker))).sources.some(source => source.documentId === deletedId), 'Deleted synthetic text still searchable');
  report.checks.push({ name: 'real_delete_removes_pdf_index', ok: true });
} catch (error) { report.checks.push({ name: 'pdf_live_smoke', ok: false, error: error instanceof Error ? error.message : 'Unknown failure' }); process.exitCode = 1; }
finally {
  try {
    if (document && admin) db.knowledge.delete(admin.id, document.id);
    for (const created of files) {
      const file = db.getFile(created.id); if (!file) continue;
      const target = path.resolve(file.storagePath);
      assert(file.userId === admin.id && file.name === created.name && path.dirname(target) === path.resolve(db.uploadsDir) && path.basename(target) === created.id + '.pdf', 'Unsafe synthetic file cleanup');
      await unlink(target); db.deleteFile(created.id);
    }
    report.syntheticFilesRemoved = true;
  } finally { if (session) db.revokeSession(session.token); db.close(); }
  await writeFile(path.join(root, 'artifacts/pdf-live-gateway-1.1.18.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
