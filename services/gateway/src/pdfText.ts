import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { knowledgeImportInfoSchema } from '@nova-chat/protocol';
import { KnowledgeError } from './knowledge.js';

const resultSchema = z.object({ ok: z.literal(true), text: z.string().min(1).max(120_000), importInfo: knowledgeImportInfoSchema });
export type PdfTextResult = Omit<z.infer<typeof resultSchema>, 'ok'>;
const failures: Record<string, [number, string]> = {
  pdf_too_large: [413, 'PDF 不能超过25 MB。'],
  pdf_too_many_pages: [413, 'PDF 最多200页，请拆分后导入；未保存截断内容。'],
  pdf_too_much_text: [413, 'PDF 提取文字（含页码标记）超过12万字符，请拆分后导入；未保存截断内容。'],
  pdf_no_text: [415, 'PDF 没有可提取的文字层，可能是扫描件或空白文件。请先进行 OCR 并核对结果后再导入。'],
  pdf_encrypted: [415, '暂不导入加密或受密码保护的 PDF。请在有权访问的前提下另存为未加密文件后导入。'],
  pdf_invalid: [415, 'PDF 无法完整解析或文件已损坏，请重新导出为文字型 PDF 后重试。'],
};
function failure(code: string) {
  const [status, message] = failures[code] ?? failures.pdf_invalid!;
  return new KnowledgeError(status, failures[code] ? code : 'pdf_invalid', message);
}

/** Process-wide admission control; V8 limits are NOT an OS/memory sandbox. */
export class PdfTextExtractor {
  private readonly owners = new Set<string>();
  constructor(private readonly timeoutMs = 15_000) {}
  extract(filePath: string, owner: string): Promise<PdfTextResult> {
    if (this.owners.has(owner) || this.owners.size >= 2) return Promise.reject(new KnowledgeError(429, 'pdf_busy', 'PDF 解析繁忙（每账户1个、每进程2个），请稍后重试。'));
    this.owners.add(owner);
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./pdfWorker.mjs', import.meta.url), {
          workerData: { filePath }, execArgv: [],
          resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
          // Untrusted parser diagnostics may contain document text or paths. Never forward them.
          stdout: true, stderr: true,
        });
      } catch { this.owners.delete(owner); reject(failure('pdf_invalid')); return; }
      worker.stdout?.resume(); worker.stderr?.resume();
      let settled = false;
      const finish = (error?: Error, value?: PdfTextResult) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        // Do not free a slot until the actual worker has terminated (including on timeout).
        void worker.terminate().then(() => {
          this.owners.delete(owner);
          if (error) reject(error); else resolve(value!);
        }, () => { this.owners.delete(owner); reject(failure('pdf_invalid')); });
      };
      const timer = setTimeout(() => finish(new KnowledgeError(408, 'pdf_timeout', 'PDF 解析超过15秒，已停止。请拆分文件或重新导出后重试。')), this.timeoutMs);
      worker.once('message', (message: unknown) => {
        const parsed = resultSchema.safeParse(message);
        if (parsed.success) finish(undefined, { text: parsed.data.text, importInfo: parsed.data.importInfo });
        else {
          const error = z.object({ ok: z.literal(false), code: z.string() }).safeParse(message);
          finish(failure(error.success ? error.data.code : 'pdf_invalid'));
        }
      });
      worker.once('error', () => finish(failure('pdf_invalid')));
      worker.once('exit', () => finish(failure('pdf_invalid')));
    });
  }
}
export const pdfTextExtractor = new PdfTextExtractor();
