import fs from 'fs';
import path from 'path';
import { evaluateTokenROI, quickROIAssessment } from '../../analyzers/tokenROIAnalyzer.js';

const LOG_FILE = process.env.LOG_FILE_PATH || '/app/logs/trade_logs.json';
const REPORT_FILE = process.env.PROFIT_REPORT_PATH || '/app/logs/profit_report.json';
const INTERVAL = parseInt(process.env.CHECK_INTERVAL, 10) || 10000;

function loadLogs() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    console.error(`[tracker] ❌ Erreur lecture du log: ${e.message}`);
    return [];
  }
}

function analyze(logs) {
  const results = [];
  for (const token of logs) {
    try {
      const report = evaluateTokenROI(token);
      results.push(report);
    } catch (err) {
      console.warn(`[tracker] ⚠️ Token ${token.baseToken?.symbol || '??'}: erreur analyse (${err.message})`);
    }
  }
  return results;
}

function writeReport(reports) {
  try {
    fs.writeFileSync(REPORT_FILE, JSON.stringify(reports, null, 2));
    console.log(`[tracker] ✅ Rapport généré avec ${reports.length} analyses`);
  } catch (e) {
    console.error(`[tracker] ❌ Erreur écriture du rapport: ${e.message}`);
  }
}

function track() {
  const logs = loadLogs();
  if (logs.length === 0) {
    console.warn('[tracker] ⚠️ Aucun token trouvé à analyser.');
    return;
  }
  const report = analyze(logs);
  writeReport(report);
}

// Lancer l’analyse immédiatement, puis en boucle
console.log(`[tracker] 📈 Démarrage du profit-tracker toutes les ${INTERVAL / 1000}s`);
track();
setInterval(track, INTERVAL);
