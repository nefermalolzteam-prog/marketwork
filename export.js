import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

/**
 * Максимальный размер файла экспорта по умолчанию (50 MB)
 * @type {number}
 */
const DEFAULT_MAX_EXPORT_SIZE = 50 * 1024 * 1024;

/**
 * Экспортировать результаты в Excel файл
 * @param {Array<Object>} results - Массив результатов с полями {id, title, price, origin, violations, url}
 * @param {string} [filePath='results_[timestamp].xlsx'] - Путь для сохранения Excel файла
 * @param {Object} [options={}] - Опции экспорта
 * @param {number} [options.maxSizeBytes] - Максимальный размер файла в байтах (по умолчанию 50 MB)
 * @returns {Promise<void>}
 * @throws {Error} Если возникла ошибка при создании или сохранении файла
 */
export async function exportToExcel(results, filePath = `results_${Date.now()}.xlsx`, options = {}) {
  if (!Array.isArray(results) || results.length === 0) {
    console.warn('⚠️  Нет данных для экспорта в Excel.');
    return;
  }

  const maxSize = options.maxSizeBytes || DEFAULT_MAX_EXPORT_SIZE;

  const resolvedFilePath = path.resolve(filePath);
  const dir = path.dirname(resolvedFilePath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.error('Не удалось создать директорию для экспорта:', err?.message);
      throw err;
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LZT Market Bot';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('Нарушения');

  worksheet.columns = [
    { header: 'ID', key: 'id', width: 12 },
    { header: 'Название', key: 'title', width: 40 },
    { header: 'Цена', key: 'price', width: 12 },
    { header: 'Происхождение', key: 'origin', width: 20 },
    { header: 'Нарушения', key: 'violations', width: 40 },
    { header: 'URL', key: 'url', width: 60 }
  ];

  try {
    results.forEach((item) => {
      worksheet.addRow({
        id: item.id,
        title: item.title,
        price: item.price || '',
        origin: item.origin || '',
        violations: Array.isArray(item.violations)
          ? item.violations.map((v) => v.name || v.keyword || v).join('; ')
          : String(item.violations || ''),
        url: item.url || ''
      });
    });

    const tempPath = `${resolvedFilePath}.tmp`;
    await workbook.xlsx.writeFile(tempPath);

    const stats = await fs.promises.stat(tempPath);
    if (stats.size > maxSize) {
      console.warn(`⚠️  Размер файла экспорта ${Math.round(stats.size / 1024)} KB превышает порог ${Math.round(maxSize / 1024)} KB.`);
    }

    try {
      await fs.promises.rename(tempPath, resolvedFilePath);
    } catch {
      try {
        const fileData = await fs.promises.readFile(tempPath);
        await fs.promises.writeFile(resolvedFilePath, fileData);
        await fs.promises.unlink(tempPath);
      } catch (innerErr) {
        console.error('Ошибка при перемещении файла экспорта:', innerErr?.message);
        throw innerErr;
      }
    }

    console.log(`Результаты экспортированы в Excel: ${filePath}`);
  } catch (err) {
    console.error('Ошибка при экспорте в Excel:', err && err.message ? err.message : err);
    throw err;
  }
}
