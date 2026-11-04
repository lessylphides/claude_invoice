// 이번 달 매입을 엑셀에서 열 수 있는 CSV 로
const PAY_LABEL = { tax: '세금계산서', card: '카드', '': '미지정' };

const HEADER = ['날짜', '거래처', '결제구분', '세금계산서발행', '품목', '분류', '수량', '단위', '1개용량', '용량단위', '정가단가', '할인', '금액'];

/** 엑셀이 =, +, @ 로 시작하는 값을 수식으로 실행하지 않도록 앞에 ' 를 붙임 (음수 숫자는 그대로) */
export function csvCell(c) {
  let s = String(c ?? '');
  if (/^[=+@\t\r]/.test(s) || /^-(?!\d)/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** BOM 포함 CSV 문자열 (엑셀에서 한글이 깨지지 않게) */
export function purchasesCsv(purchases) {
  const rows = [HEADER];
  for (const p of [...purchases].sort((a, b) => a.date.localeCompare(b.date)))
    for (const i of p.items)
      rows.push([
        p.date, p.vendor, PAY_LABEL[p.payType] ?? '미지정', p.payType === 'tax' ? (p.taxIssued ? '발행' : '미발행') : '',
        i.name, i.category, i.qty, i.unit, i.packSize || '', i.packUnit || '', i.unitPrice, i.discount || 0, i.amount,
      ]);
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}
