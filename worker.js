import { parentPort, workerData } from 'worker_threads';
import { setTimeout as delay } from 'timers/promises';
import { searchOnce } from './search.js';

async function processPages(config, rules, itemLabel, pages) {
  const results = [];
  const delayMs = Number(config?.workerDelayMs) || 500;
  for (const page of pages) {
    try {
      if (parentPort) parentPort.postMessage({ type: 'progress', page });
      const pageResults = await searchOnce(config, rules, page);
      if (pageResults && Array.isArray(pageResults.results)) {
        results.push(...pageResults.results);
      } else if (Array.isArray(pageResults)) {
        results.push(...pageResults);
      }
    } catch (err) {
      if (parentPort) parentPort.postMessage({ type: 'pageError', page, error: err && err.message ? err.message : String(err) });
      else console.error('Ошибка страницы рабочего потока:', err && err.stack ? err.stack : err);
    }
    try {
      await delay(delayMs);
    } catch {
      // ignore delay cancellation
    }
  }
  return results;
}

async function initWorker() {
  try {
    const cfg = workerData?.config || {};
    const pages = Array.isArray(workerData?.pages) ? workerData.pages : [];
    const results = await processPages(cfg, workerData?.rules, workerData?.itemLabel, pages);
    if (parentPort) parentPort.postMessage({ type: 'done', results });
    else console.log('Рабочий поток завершён, результатов:', results.length);
  } catch (error) {
    if (parentPort) parentPort.postMessage({ type: 'error', error: error && error.message ? error.message : String(error), stack: error.stack });
    else console.error('Ошибка рабочего потока:', error && error.stack ? error.stack : error);
  }
}

initWorker();