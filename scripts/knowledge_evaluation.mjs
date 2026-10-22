import { performance } from 'node:perf_hooks';

const ANSWERABLE_CATEGORIES = new Set(['answerable_single', 'answerable_cross']);

function unique(values) {
  return [...new Set(values)];
}

export function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function emptyCategory() {
  return { cases: 0, passed: 0, recallAt5: null, sourceCoverage: null, sourcePrecision: null, averageLatencyMs: null, p95LatencyMs: null };
}

/**
 * Evaluate one retrieval strategy against an already loaded KnowledgeStore. Metrics describe retrieval evidence only; they do not claim
 * that an LLM generated a correct answer.
 */
export function evaluateKnowledgeCases(store, userId, cases, now = () => performance.now(), strategy = 'lexical') {
  const categoryResults = new Map();
  const latencies = [];
  const failures = [];
  const details = [];

  for (const testCase of cases) {
    const started = now();
    const result = store.search(userId, testCase.query, strategy);
    const latencyMs = Math.max(0, now() - started);
    const top5Ids = unique(result.sources.slice(0, 5).map(source => source.documentId));
    const expectedIds = unique(testCase.expectedSourceIds ?? []);
    const matchedIds = top5Ids.filter(id => expectedIds.includes(id));
    const category = categoryResults.get(testCase.category) ?? emptyCategory();
    category.cases += 1;
    category.averageLatencyMs = (category.averageLatencyMs ?? 0) + latencyMs;
    category.p95LatencyMs = null;

    let passed = false;
    let sourcePrecision = null;
    let sourceCoverage = null;
    if (ANSWERABLE_CATEGORIES.has(testCase.category) || testCase.category === 'injection') {
      sourcePrecision = top5Ids.length ? matchedIds.length / top5Ids.length : 0;
      sourceCoverage = expectedIds.length ? matchedIds.length / expectedIds.length : 0;
      passed = matchedIds.length > 0;
    } else if (testCase.category === 'refusal') {
      passed = result.sources.length === 0;
    }
    if (passed) category.passed += 1;
    if (category.sourcePrecision === null && sourcePrecision !== null) category.sourcePrecision = 0;
    if (sourcePrecision !== null) category.sourcePrecision += sourcePrecision;
    if (category.sourceCoverage === null && sourceCoverage !== null) category.sourceCoverage = 0;
    if (sourceCoverage !== null) category.sourceCoverage += sourceCoverage;
    categoryResults.set(testCase.category, category);
    latencies.push(latencyMs);

    const detail = {
      id: testCase.id,
      category: testCase.category,
      query: testCase.query,
      expectedSourceIds: expectedIds,
      returnedSourceIds: top5Ids,
      sourceCount: result.sources.length,
      latencyMs: round(latencyMs, 3),
      passed,
      ...(sourcePrecision !== null ? { sourcePrecision: round(sourcePrecision) } : {}),
      ...(sourceCoverage !== null ? { sourceCoverage: round(sourceCoverage) } : {}),
    };
    details.push(detail);
    if (!passed) failures.push({ ...detail, reason: testCase.category === 'refusal' ? 'expected_no_sources' : 'expected_source_not_in_top5' });
  }

  const categories = Object.fromEntries([...categoryResults].map(([name, value]) => {
    const cases = value.cases || 1;
    return [name, {
      cases: value.cases,
      passed: value.passed,
      accuracy: round(value.passed / cases),
      ...(value.sourcePrecision !== null ? { sourcePrecision: round(value.sourcePrecision / cases) } : {}),
      ...(value.sourceCoverage !== null ? { sourceCoverage: round(value.sourceCoverage / cases) } : {}),
      averageLatencyMs: round((value.averageLatencyMs ?? 0) / cases, 3),
      p95LatencyMs: null,
    }];
  }));
  for (const [category, summary] of Object.entries(categories)) {
    const categoryLatencies = details.filter(detail => detail.category === category).map(detail => detail.latencyMs);
    summary.p95LatencyMs = round(percentile(categoryLatencies, 95), 3);
  }

  const answerable = details.filter(detail => ANSWERABLE_CATEGORIES.has(detail.category));
  const refusal = details.filter(detail => detail.category === 'refusal');
  const injection = details.filter(detail => detail.category === 'injection');
  const sourcePrecisionValues = answerable.map(detail => detail.sourcePrecision ?? 0);
  const sourceCoverageValues = answerable.map(detail => detail.sourceCoverage ?? 0);
  return {
    evaluator: `gateway-${strategy}-retrieval-evaluation-v1`,
    strategy,
    metricsScope: 'retrieval-only; no LLM answer quality claim',
    cases: details.length,
    summary: {
      recallAt5: round(answerable.filter(detail => detail.returnedSourceIds.some(id => detail.expectedSourceIds.includes(id))).length / (answerable.length || 1)),
      sourceCoverage: round(sourceCoverageValues.reduce((sum, value) => sum + value, 0) / (sourceCoverageValues.length || 1)),
      citationAccuracy: round(sourcePrecisionValues.reduce((sum, value) => sum + value, 0) / (sourcePrecisionValues.length || 1)),
      refusalAccuracy: round(refusal.filter(detail => detail.passed).length / (refusal.length || 1)),
      injectionRetrievalHitRate: round(injection.filter(detail => detail.passed).length / (injection.length || 1)),
      averageLatencyMs: round(latencies.reduce((sum, value) => sum + value, 0) / (latencies.length || 1), 3),
      p95LatencyMs: round(percentile(latencies, 95), 3),
    },
    categories,
    failures,
    details,
  };
}


export function compareKnowledgeReports(reports) {
  const lexical = reports.lexical;
  const bm25 = reports.bm25;
  const metricNames = ['recallAt5', 'sourceCoverage', 'citationAccuracy', 'refusalAccuracy', 'injectionRetrievalHitRate', 'averageLatencyMs', 'p95LatencyMs'];
  const delta = Object.fromEntries(metricNames.map(name => [name, round(bm25.summary[name] - lexical.summary[name], 4)]));
  return {
    evaluator: 'gateway-retrieval-comparison-v1',
    metricsScope: 'retrieval-only; no LLM answer quality claim',
    strategies: reports,
    delta,
  };
}

export function renderKnowledgeComparisonMarkdown(dataset, comparison) {
  const lexical = comparison.strategies.lexical;
  const bm25 = comparison.strategies.bm25;
  const metric = (name, percent = true) => {
    const left = lexical.summary[name];
    const right = bm25.summary[name];
    const change = comparison.delta[name];
    const format = value => percent ? `${(value * 100).toFixed(2)}%` : `${value.toFixed(3)} ms`;
    const formatDelta = value => `${value >= 0 ? '+' : ''}${percent ? (value * 100).toFixed(2) + ' pp' : value.toFixed(3) + ' ms'}`;
    return `| ${name} | ${format(left)} | ${format(right)} | ${formatDelta(change)} |`;
  };
  const lines = [
    '# Nova Chat 知识库检索策略对比',
    '',
    `- 数据集：${dataset.description}`,
    `- 数据集性质：${dataset.synthetic ? '合成数据，仅用于工程验证' : '未标记为合成数据'}`,
    '- 评测范围：同一批资料和问题分别运行词法排序与 SQLite FTS5 BM25 排序；只测检索证据。',
    '',
    '## 指标对比',
    '',
    '| 指标 | lexical（默认） | bm25（实验） | BM25 - lexical |',
    '| --- | ---: | ---: | ---: |',
    metric('recallAt5'),
    metric('sourceCoverage'),
    metric('citationAccuracy'),
    metric('refusalAccuracy'),
    metric('injectionRetrievalHitRate'),
    metric('averageLatencyMs', false),
    metric('p95LatencyMs', false),
    '',
    '## 解释',
    '',
    '- lexical 使用命中词覆盖和标题加权，默认保留；在当前合成集上它与 bm25 的质量指标持平，规则更容易解释。',
    '- bm25 使用 FTS5 内置 BM25 对候选片段排序，作为可切换实验方案，适合继续与真实资料和向量召回比较。',
    '- 百分比指标的差值单位是百分点（pp）；延迟差值使用毫秒。',
    '- 合成数据、内存 SQLite 和本机延迟不能代表线上效果；发布前必须保存真实脱敏数据的离线报告。',
    '',
    '## 失败案例数量',
    '',
    `- lexical：${lexical.failures.length} 条`,
    `- bm25：${bm25.failures.length} 条`,
    '',
    '当前网关仍使用 lexical 默认策略；切换策略前应通过同一数据集、人工抽样和实际部署压测完成评审。',
  ];
  return `${lines.join('\n')}\n`;
}

export function renderKnowledgeEvaluationMarkdown(dataset, report) {
  const lines = [
    '# Nova Chat 知识库检索评测报告',
    '',
    `- 评测器：\`${report.evaluator}\``,
    `- 数据集：${dataset.description}`,
    `- 数据集性质：${dataset.synthetic ? '合成数据，仅用于工程验证' : '未标记为合成数据，拒绝生成报告'}`,
    `- 用例数：${report.cases}`,
    `- 评测范围：${report.metricsScope}`,
    '',
    '## 汇总指标',
    '',
    '| 指标 | 结果 | 解释 |',
    '| --- | ---: | --- |',
    `| Recall@5 | ${(report.summary.recallAt5 * 100).toFixed(2)}% | 可回答问题中，至少一个期望资料出现在前 5 个来源 |`,
    `| 来源覆盖率 | ${(report.summary.sourceCoverage * 100).toFixed(2)}% | 多来源问题中，前 5 个来源覆盖期望资料的平均比例 |`,
    `| 来源精确率 | ${(report.summary.citationAccuracy * 100).toFixed(2)}% | 可回答问题返回的前 5 个去重来源中，属于期望资料的比例 |`,
    `| 拒答准确率 | ${(report.summary.refusalAccuracy * 100).toFixed(2)}% | 应拒答问题是否没有返回资料来源 |`,
    `| 注入检索命中率 | ${(report.summary.injectionRetrievalHitRate * 100).toFixed(2)}% | 安全夹具问题是否找到了预期资料，不能替代模型安全评测 |`,
    `| 平均检索延迟 | ${report.summary.averageLatencyMs.toFixed(3)} ms | 当前 Node 进程内的合成数据测量 |`,
    `| P95 检索延迟 | ${report.summary.p95LatencyMs.toFixed(3)} ms | 当前 Node 进程内的合成数据测量 |`,
    '',
    '## 分类结果',
    '',
    '| 分类 | 用例数 | 通过数 | 准确率 | 来源精确率 | 来源覆盖率 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const [category, summary] of Object.entries(report.categories)) {
    lines.push(`| ${category} | ${summary.cases} | ${summary.passed} | ${(summary.accuracy * 100).toFixed(2)}% | ${summary.sourcePrecision === undefined ? '—' : (summary.sourcePrecision * 100).toFixed(2) + '%'} | ${summary.sourceCoverage === undefined ? '—' : (summary.sourceCoverage * 100).toFixed(2) + '%'} |`);
  }
  lines.push('', '## 失败案例', '');
  if (!report.failures.length) lines.push('本次没有失败案例。');
  else {
    lines.push('| ID | 分类 | 问题 | 期望来源 | 返回来源 | 原因 |', '| --- | --- | --- | --- | --- | --- |');
    for (const failure of report.failures) lines.push(`| ${failure.id} | ${failure.category} | ${failure.query.replaceAll('|', '\\|')} | ${failure.expectedSourceIds.join(', ') || '—'} | ${failure.returnedSourceIds.join(', ') || '—'} | ${failure.reason} |`);
  }
  lines.push('', '## 解释和限制', '', '- 当前实现是 SQLite FTS5 加词法排序 baseline，中文使用 Han bigram，英文、数字和代码术语按词处理。', '- 这里的“来源精确率”衡量检索返回的来源是否属于标注来源，不等于模型最终回答中的引用正确率。', '- 延迟是本机 Node 进程的合成数据结果，不代表移动端、容器或生产环境 P95。', '- 注入分类用于确认检索夹具可被找到；模型是否遵守“资料是数据而不是指令”，需要通过 provider 集成测试和人工评测继续验证。', '- 引入混合检索或向量检索后，应使用同一数据集重新运行并保存对比报告。');
  return `${lines.join('\n')}\n`;
}
