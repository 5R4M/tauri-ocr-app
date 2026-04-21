import * as XLSX from 'xlsx';
import type { OcrWord } from './ocr';

export function detectTable(words: OcrWord[]): string[][] {
  const valid = words.filter(w => w.confidence > 20 && w.text.trim());
  if (!valid.length) return [['(sin datos detectados)']];

  const avgH = valid.reduce((s, w) => s + (w.y1 - w.y0), 0) / valid.length;
  const rowTol = Math.max(avgH * 0.7, 8);

  // Agrupar palabras en filas por posición Y
  const rowClusters: OcrWord[][] = [];
  for (const w of [...valid].sort((a, b) => a.y0 - b.y0)) {
    const mid = (w.y0 + w.y1) / 2;
    const row = rowClusters.find(r => {
      const rMid = r.reduce((s, w) => s + (w.y0 + w.y1) / 2, 0) / r.length;
      return Math.abs(mid - rMid) < rowTol;
    });
    if (row) row.push(w);
    else rowClusters.push([w]);
  }
  rowClusters.forEach(r => r.sort((a, b) => a.x0 - b.x0));

  // Detectar límites de columnas agrupando posiciones X
  const allX = rowClusters.flatMap(r => r.map(w => w.x0)).sort((a, b) => a - b);
  const colGap = avgH * 2.5;
  const colBounds: number[] = [];
  for (const x of allX) {
    if (!colBounds.length || x - colBounds[colBounds.length - 1] > colGap) {
      colBounds.push(x);
    }
  }

  if (colBounds.length <= 1) {
    return rowClusters.map(r => [r.map(w => w.text).join(' ')]);
  }

  // Asignar palabras a columnas
  return rowClusters.map(row => {
    const cells = Array<string>(colBounds.length).fill('');
    for (const w of row) {
      let col = 0;
      for (let i = colBounds.length - 1; i >= 0; i--) {
        if (w.x0 >= colBounds[i] - colGap / 2) { col = i; break; }
      }
      cells[col] = cells[col] ? `${cells[col]} ${w.text}` : w.text;
    }
    return cells;
  });
}

export function generateExcel(table: string[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(table);
  if (table[0]) {
    ws['!cols'] = table[0].map((_, ci) => ({
      wch: Math.min(Math.max(...table.map(r => (r[ci] ?? '').length), 6) + 2, 40),
    }));
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

export function downloadExcel(data: Uint8Array, filename = 'tabla_ocr.xlsx') {
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
