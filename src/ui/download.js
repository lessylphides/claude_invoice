// 파일 내려받기 (링크를 문서에 붙였다가 떼야 브라우저가 파일 이름을 지켜 줌)
export function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * 백업처럼 꼭 저장되어야 하는 파일: 공유 시트(아이폰 '파일에 저장')를 쓸 수 있으면 그걸로,
 * 아니면 내려받기. 공유 시트는 사용자가 저장했는지/취소했는지 알려 줌.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function saveFile(name, content, type) {
  try {
    const file = new File([content], name, { type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
    // 공유가 안 되면 아래 내려받기로
  }
  download(name, content, type);
  return 'downloaded';
}
