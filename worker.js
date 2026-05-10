import { parentPort, workerData } from 'worker_threads';
import { setTimeout as delay } from 'timers/promises';

async function processPages(searchOnce, config, rules, itemLabel, pages) {
  const results = [];
  for (const page of pages) {
    if (parentPort) {
      parentPort.postMessage({ type: 'progress', page });
    }
    const pageResults = await searchOnce(config, rules, page);
    results.push(...pageResults.results);
    await delay(500); // Задержка
  }
  return results;
}

async function initWorker() {
  const { searchOnce } = await import('./bot.js');
  const results = await processPages(searchOnce, workerData.config, workerData.rules, workerData.itemLabel, workerData.pages);
  if (parentPort) {
    parentPort.postMessage({ type: 'done', results });
  }
}

initWorker().catch(error => {
  if (parentPort) {
    parentPort.postMessage({ type: 'error', error: error.message });
  }
});