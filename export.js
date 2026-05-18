import ExcelJS from 'exceljs';

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
      violations: Array.isArray(item.violations)
        ? item.violations.map(v => v.name || v.keyword || v).join('; ')
        : String(item.violations || ''),
      url: item.url
    });
  });

  await workbook.xlsx.writeFile(filePath);
  console.log(`Результаты экспортированы в Excel: ${filePath}`);
}
