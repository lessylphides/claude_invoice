// 영수증·거래명세서 사진 → 우리 서버(/api/ocr) → Claude 로 매입 내역 추출
// Anthropic API 키는 서버에만 있고 이 기기에는 없습니다. 로그인한 사람만, 계정별 사용 한도 안에서 쓸 수 있습니다.

import { auth } from './auth.js';

/** 사진을 긴 변 1568px 이하 JPEG(base64)로 줄임 – 전송량을 줄이고 인식 품질은 유지 */
export async function fileToJpegBase64(file, maxSide = 1568) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('이미지를 읽을 수 없습니다. (HEIC 형식이면 JPG로 촬영해 주세요)'));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {File|File[]} files  여러 장이면 '영수증 한 장을 나눠 찍은 사진들'로 보고 한 건으로 인식
 * @returns 인식 결과 (서버가 Claude 응답을 정리한 JSON)
 */
/** 파일 → base64 (PDF 는 그대로 보냄) */
async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const isPdf = (f) => f?.type === 'application/pdf' || /\.pdf$/i.test(f?.name || '');

export async function extractReceipt(files, { categories, knownVendors = [] }) {
  files = Array.isArray(files) ? files : [files];
  const pdf = files.length === 1 && isPdf(files[0]) ? await fileToBase64(files[0]) : null;
  const images = pdf ? [] : await Promise.all(files.map((f) => fileToJpegBase64(f)));
  const token = await auth.accessToken();
  if (!token) throw new Error('로그인이 만료됐어요. 다시 로그인해 주세요.');
  let res;
  try {
    res = await fetch('./api/ocr', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...(pdf ? { pdf } : { images }), categories, knownVendors: knownVendors.slice(0, 60) }),
    });
  } catch {
    throw new Error('인터넷 연결을 확인해 주세요.');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (res.ok && body?.result) {
    lastUsage = body.usage && body.limits ? { ...body.usage, limits: body.limits } : null;
    return body.result;
  }
  throw new Error(body?.error?.message || `영수증 인식 서버에 연결하지 못했어요 (${res.status}). 잠시 후 다시 시도하거나 직접 입력해 주세요.`);
}

/** 마지막 인식 뒤의 사용량 {day, month, limits} (설정 화면 표시용) */
export let lastUsage = null;
