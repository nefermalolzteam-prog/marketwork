import fs from 'fs';
import { createObjectCsvWriter } from 'csv-writer';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

// Функция для экспорта в CSV
export async function exportToCSV(results, filePath) {
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'id', title: 'ID' },
      { id: 'title', title: 'Название' },
      { id: 'price', title: 'Цена' },
      { id: 'origin', title: 'Происхождение' },
      { id: 'violations', title: 'Нарушения' },
      { id: 'url', title: 'URL' }
    ]
  });

  const records = results.map(item => ({
    id: item.id,
    title: item.title,
    price: item.price,
    origin: item.origin,
    violations: Array.isArray(item.violations)
      ? item.violations.map(v => v.name || v.keyword || v).join('; ')
      : String(item.violations || ''),
    url: item.url
  }));

  await csvWriter.writeRecords(records);
  console.log(`Результаты экспортированы в CSV: ${filePath}`);
}

// Функция для экспорта в Excel
export async function exportToExcel(results, filePath) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Нарушения');

  worksheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Название', key: 'title', width: 30 },
    { header: 'Цена', key: 'price', width: 10 },
    { header: 'Происхождение', key: 'origin', width: 15 },
    { header: 'Нарушения', key: 'violations', width: 30 },
    { header: 'URL', key: 'url', width: 50 }
  ];

  results.forEach(item => {
    worksheet.addRow({
      id: item.id,
      title: item.title,
      price: item.price,
      origin: item.origin,
      violations: item.violations.join('; '),
      url: item.url
    });
  });

  await workbook.xlsx.writeFile(filePath);
  console.log(`Результаты экспортированы в Excel: ${filePath}`);
}

// Функция для экспорта в PDF с графиками
export async function exportToPDF(results, filePath) {
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(filePath));

  doc.fontSize(20).text('Отчёт о нарушениях LZT Market', { align: 'center' });
  doc.moveDown();

  // Статистика
  const totalViolations = results.reduce((sum, item) => sum + item.violations.length, 0);
  const categories = {};
  results.forEach(item => {
    item.violations.forEach(v => {
      categories[v.category] = (categories[v.category] || 0) + 1;
    });
  });

  doc.fontSize(14).text(`Всего объявлений: ${results.length}`);
  doc.text(`Всего нарушений: ${totalViolations}`);
  doc.moveDown();

  // Таблица результатов
  doc.fontSize(12).text('Результаты:');
  results.forEach((item, index) => {
    doc.text(`${index + 1}. ${item.title} - Нарушения: ${item.violations.map(v => v.name).join(', ')}`);
  });

  // Простой график (текстовая версия, для реального графика нужен canvas)
  doc.moveDown();
  doc.text('Статистика по категориям нарушений:');
  Object.entries(categories).forEach(([cat, count]) => {
    doc.text(`${cat}: ${count}`);
  });

  doc.end();
  console.log(`Результаты экспортированы в PDF: ${filePath}`);
}