// 엑셀(.xlsx) 읽기: 시트마다 행 배열 [[셀, 셀, ...], ...] 로 (값만, 서식 없음)
// 포스·네이버에서 받은 매출 파일을 기기 안에서 읽는 데 씀. 큰 라이브러리 없이 zip 풀기 + XML 몇 가지 태그만 읽음
import { unzipSync, strFromU8 } from 'fflate';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = (s) => s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));
const texts = (xml) => {
  // <rPh>(읽는 법 표기) 안의 글자는 빼고 <t> 들을 이어 붙임
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += m[1] ? unesc(m[1]) : '';
  return out;
};
const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** 엑셀 날짜 숫자 → 'YYYY-MM-DD HH:MM:SS' (파일에 적힌 시각 그대로) */
export function excelDate(serial) {
  const ms = Math.round((Number(serial) - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * @param {Uint8Array} u8 xlsx 파일
 * @returns {{ name: string, rows: any[][], dateCols: Set<number>[] }[]} 시트 목록
 */
export function readXlsx(u8) {
  const zip = unzipSync(u8, { filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(f.name) });
  const txt = (p) => (zip[p] ? strFromU8(zip[p]) : '');
  const shared = [...txt('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  // 날짜 서식 번호 찾기 (숫자 셀이 날짜인지 알려고)
  const styles = txt('xl/styles.xml');
  const customDate = new Set([...styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].filter((m) => /[ymdhs]/i.test(m[2].replace(/"[^"]*"|\[[^\]]*\]/g, ''))).map((m) => Number(m[1])));
  const isDateFmt = (id) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || customDate.has(id);
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const dateStyle = [...xfs.matchAll(/<xf\b([^>]*)/g)].map((m) => isDateFmt(Number(/numFmtId="(\d+)"/.exec(m[1])?.[1] ?? 0)));
  // 시트 이름 → 파일
  const rels = Object.fromEntries([...txt('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)>/g)].map((m) => [/Id="([^"]+)"/.exec(m[1])?.[1], /Target="([^"]+)"/.exec(m[1])?.[1]]));
  const sheets = [...txt('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({
    name: unesc(/name="([^"]*)"/.exec(m[1])?.[1] ?? ''),
    path: 'xl/' + String(rels[/r:id="([^"]+)"/.exec(m[1])?.[1]] ?? '').replace(/^\/?xl\//, ''),
  }));
  return sheets.map(({ name, path }) => {
    const rows = [];
    for (const rm of txt(path).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1) - 1;
      const row = [];
      let next = 0;
      for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = cm[1];
        const ref = /\br="([A-Z]+\d+)"/.exec(a)?.[1];
        const ci = ref ? colIndex(ref) : next;
        next = ci + 1;
        const body = cm[2] ?? '';
        const t = /\bt="(\w+)"/.exec(a)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = null;
        if (t === 's') val = shared[Number(v)] ?? null;
        else if (t === 'inlineStr') val = texts(body);
        else if (t === 'str' || t === 'e') val = v != null ? unesc(v) : null;
        else if (t === 'b') val = v === '1';
        else if (v != null) {
          const num = Number(v);
          const s = Number(/\bs="(\d+)"/.exec(a)?.[1] ?? 0);
          val = dateStyle[s] ? excelDate(num) : num;
        }
        row[ci] = val;
      }
      rows[r] = row;
    }
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    return { name, rows };
  });
}
