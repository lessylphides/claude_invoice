// PDF 쪽수 세기 + 인식 횟수 계산 (앱·서버가 같은 규칙: 서버는 앱이 알려 준 숫자를 믿지 않고 직접 셈)
// PDF 는 쪽 정보가 압축된 묶음(object stream) 안에 있을 수 있어서, 압축된 부분도 풀어서 찾음

export const MAX_PAGES = 6; // 사진 장수 + PDF 쪽수 최대 (한 번에)
export const MAX_PDF_B64 = 4_500_000; // PDF 파일(base64) 최대 약 4.5MB (파일로 약 3.3MB)

/** 사진 2장(PDF 2쪽)마다 인식 1회 */
export const ocrUnits = (pages) => Math.max(1, Math.ceil((Number(pages) || 1) / 2));

const latin1 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return s;
};

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** 글 속에서 쪽 개수 찾기: 쪽 목록(/Type /Pages)의 /Count 중 가장 큰 값, 또는 쪽(/Type /Page) 개수 */
function scan(text) {
  let pages = 0;
  for (const m of text.matchAll(/\/Type\s*\/Page(?![a-zA-Z])/g)) pages++;
  let count = 0;
  for (const m of text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)) count = Math.max(count, Number(m[1] || m[2]));
  return { pages, count };
}

/**
 * @param {Uint8Array} bytes PDF 파일
 * @returns {Promise<number>} 쪽수 (PDF 가 아니거나 셀 수 없으면 0)
 */
export async function countPdfPages(bytes) {
  if (!bytes || bytes.length < 8) return 0;
  const text = latin1(bytes);
  if (!text.startsWith('%PDF-')) return 0;
  let { pages, count } = scan(text);
  // 압축된 부분 풀어서 다시 찾기 (쪽 정보가 object stream 안에 있는 PDF)
  if (!count || !pages) {
    const re = /\/FlateDecode[\s\S]{0,400}?stream\r?\n/g;
    let m;
    let n = 0;
    while ((m = re.exec(text)) && n++ < 400) {
      const start = m.index + m[0].length;
      const end = text.indexOf('endstream', start);
      if (end < 0) break;
      let stop = end; // 끝 표시 앞 줄바꿈은 압축 내용이 아님
      while (stop > start && (text[stop - 1] === '\n' || text[stop - 1] === '\r')) stop--;
      try {
        const inner = scan(latin1(await inflate(bytes.subarray(start, stop))));
        pages += inner.pages;
        count = Math.max(count, inner.count);
      } catch {
        // 이미지 등 풀 수 없는 덩어리는 건너뜀
      }
      re.lastIndex = end;
    }
  }
  return count || pages;
}

/** base64 → 바이트 */
export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
