// 앱 화면 확대 막기: 아이폰 사파리는 user-scalable=no 를 무시해서 두 손가락 동작을 직접 막음
// 영수증 사진(.photo) 위에서는 그대로 확대할 수 있게 둠
const allowed = (t) => !!t?.closest?.('.photo');

export function preventZoom(doc = document) {
  for (const type of ['gesturestart', 'gesturechange']) doc.addEventListener(type, (e) => !allowed(e.target) && e.preventDefault(), { passive: false });
  doc.addEventListener('touchmove', (e) => e.touches.length > 1 && !allowed(e.target) && e.preventDefault(), { passive: false });
}
