import fs from 'node:fs';
import path from 'node:path';
import { aiObservabilityService } from '../services/ai.observability.service.js';
import { exportService } from '../services/export.service.js';
import { closeDatabase, initDatabase } from '../storage/sqlite.db.js';

export interface CliExportOptions {
  format?: 'xlsx' | 'csv' | 'both' | '4sheet';
  gameType?: string;
  questionCount?: number | string;
  from?: string;
  to?: string;
  preset?: 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'THIS_MONTH' | 'ALL' | 'CUSTOM';
  status?: string;
  model?: string;
  outDir?: string;
  outFile?: string;
  dbPath?: string;
}

export function parseCliArgs(argv: string[]): CliExportOptions {
  const opts: CliExportOptions = { format: 'xlsx' };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eqIdx = arg.indexOf('=');
    const key = eqIdx > 0 ? arg.slice(2, eqIdx).trim() : arg.slice(2).trim();
    const val = eqIdx > 0 ? arg.slice(eqIdx + 1).trim() : 'true';
    switch (key) {
      case 'format':
        if (val === 'csv' || val === 'xlsx' || val === 'both' || val === '4sheet') {
          opts.format = val;
        }
        break;
      case 'gameType':
      case 'game-type':
        opts.gameType = val;
        break;
      case 'questionCount':
      case 'questions':
      case 'requestedQuestions':
        opts.questionCount = val;
        break;
      case 'from':
        opts.from = val;
        break;
      case 'to':
        opts.to = val;
        break;
      case 'preset':
        opts.preset = val.toUpperCase() as any;
        break;
      case 'status':
        opts.status = val.toUpperCase();
        break;
      case 'model':
        opts.model = val;
        break;
      case 'outDir':
      case 'out-dir':
        opts.outDir = val;
        break;
      case 'out':
      case 'outFile':
      case 'out-file':
        opts.outFile = val;
        break;
      case 'db':
      case 'dbPath':
        opts.dbPath = val;
        break;
      default:
        break;
    }
  }
  return opts;
}

export function runExportAiCostCli(options: CliExportOptions): {
  filesWritten: string[];
  totalGenerations: number;
  totalTokens: number;
  totalCostVnd: number;
} {
  if (options.dbPath) {
    initDatabase(options.dbPath);
  } else {
    initDatabase();
  }

  const report = aiObservabilityService.getAdminAiCostReport({
    preset: options.preset,
    from: options.from,
    to: options.to,
    model: options.model,
    gameType: options.gameType,
    questionCount: options.questionCount,
    status: options.status,
  });

  const outDir = path.resolve(options.outDir || path.join(process.cwd(), 'exports'));
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const filesWritten: string[] = [];
  const fmt = options.format || 'xlsx';

  if (fmt === '4sheet') {
    const exported = exportService.exportAdminAiCostReportExcel(report);
    const targetPath = options.outFile ? path.resolve(options.outFile) : path.join(outDir, exported.filename);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, exported.body);
    filesWritten.push(targetPath);
  } else if (fmt === 'both') {
    const xlsxExport = exportService.exportGameCreationCostReport(report, 'xlsx');
    const csvExport = exportService.exportGameCreationCostReport(report, 'csv');
    const xlsxPath = path.join(outDir, xlsxExport.filename);
    const csvPath = path.join(outDir, csvExport.filename);
    fs.writeFileSync(xlsxPath, xlsxExport.body);
    fs.writeFileSync(csvPath, csvExport.body, 'utf-8');
    filesWritten.push(xlsxPath, csvPath);
  } else {
    const exported = exportService.exportGameCreationCostReport(report, fmt === 'csv' ? 'csv' : 'xlsx');
    const targetPath = options.outFile ? path.resolve(options.outFile) : path.join(outDir, exported.filename);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (typeof exported.body === 'string') {
      fs.writeFileSync(targetPath, exported.body, 'utf-8');
    } else {
      fs.writeFileSync(targetPath, exported.body);
    }
    filesWritten.push(targetPath);
  }

  const totalTokens = report.byGame.reduce((acc, g) => acc + (g.totalTokens || 0), 0);
  const totalCostVnd = report.byGame.reduce((acc, g) => acc + (g.paidEquivalentCostVnd || 0), 0);

  return {
    filesWritten,
    totalGenerations: report.byGame.length,
    totalTokens,
    totalCostVnd,
  };
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase().endsWith(path.normalize('src/scripts/export-ai-cost-report.ts').toLowerCase());

if (isMainModule) {
  try {
    const opts = parseCliArgs(process.argv.slice(2));
    const res = runExportAiCostCli(opts);
    console.log(
      `[AI Cost Report Export] Đã xuất ${res.totalGenerations} lượt tạo game | Tổng Tokens: ${res.totalTokens.toLocaleString('vi-VN')} | Tổng chi phí: ${res.totalCostVnd.toLocaleString('vi-VN')} VNĐ`
    );
    for (const f of res.filesWritten) {
      console.log(` -> File: ${f}`);
    }
  } finally {
    closeDatabase();
  }
}

