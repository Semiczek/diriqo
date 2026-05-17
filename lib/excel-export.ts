import 'server-only'

import ExcelJS from 'exceljs'
import { NextResponse } from 'next/server'

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function createExportWorkbook(title: string) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Diriqo'
  workbook.title = title
  workbook.created = new Date()
  workbook.modified = new Date()
  return workbook
}

export function styleExportWorksheet(worksheet: ExcelJS.Worksheet) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount },
  }

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' },
  }
  headerRow.alignment = { vertical: 'middle', wrapText: true }
  headerRow.height = 24

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      }
      cell.alignment = { vertical: 'top', wrapText: rowNumber === 1 }
    })
  })
}

export function safeExportFileName(value: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)

  return normalized || 'export'
}

export async function workbookXlsxResponse(workbook: ExcelJS.Workbook, fileName: string) {
  const buffer = await workbook.xlsx.writeBuffer()
  const body = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const safeFileName = safeExportFileName(fileName).replace(/\.xlsx$/i, '')

  return new NextResponse(body, {
    headers: {
      'content-type': XLSX_CONTENT_TYPE,
      'content-disposition': `attachment; filename="${safeFileName}.xlsx"`,
      'cache-control': 'no-store',
    },
  })
}
