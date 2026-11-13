// 설정 → 문의하기: 종류 고르기 → 종류별 안내에 맞춰 적기 → (화면 캡처) → 보내기
// 운영자 메일로 가고, 답장은 회원 가입 이메일로. 장부 내용은 보내지 않음
import { esc } from '../lib/format.js';
import { openSheet, toast } from '../ui/sheet.js';
import { auth } from '../auth.js';
import { view } from '../state.js';
import { fileToJpegBase64 } from '../ocr.js';
import { SUPPORT_KINDS, kindOf, SUPPORT_MIN, SUPPORT_MAX, SUPPORT_MAX_IMAGES } from '../lib/support.js';

const appVersion = () => document.querySelector('script[type=module][src]')?.getAttribute('src')?.split('/').pop()?.replace(/\.js$/, '') || 'dev';
const tabName = () => ({ purchase: '매입 탭', cost: '원가 탭' })[view.tab] || view.tab;

export function openSupport() {
  let kind = null;
  const images = []; // {b64, url}
  openSheet({
    title: '문의하기',
    render(body, close) {
      body.innerHTML = `
        <form class="support" novalidate>
          <p class="support-intro">궁금한 점, 불편한 점, 바라는 기능 무엇이든 보내 주세요. 보통 <b>하루 안에</b> 가입하신 이메일(<b>${esc(auth.user?.email || '')}</b>)로 답장드려요.</p>
          <fieldset class="support-kinds">
            <legend>어떤 문의인가요?</legend>
            ${SUPPORT_KINDS.map((k) => `<label class="chip"><input type="radio" name="kind" value="${k.id}"><span>${k.icon} ${esc(k.label)}</span></label>`).join('')}
          </fieldset>
          <p class="support-guide muted small" aria-live="polite">위에서 종류를 먼저 골라 주세요.</p>
          <label class="support-text">내용<textarea name="text" rows="7" maxlength="${SUPPORT_MAX}" placeholder="종류를 고르면 예시가 보여요."></textarea></label>
          <div class="support-shots">
            <div class="support-thumbs"></div>
            <button type="button" class="btn ghost small-btn" data-act="shot">📷 화면 캡처·사진 붙이기 (${SUPPORT_MAX_IMAGES}장까지)</button>
            <input type="file" accept="image/*" multiple hidden>
          </div>
          <p class="set-note">함께 보내는 정보: 기기 종류, 앱 버전, 요금제, 지금 보던 화면. 장부 내용은 보내지 않아요.</p>
          <button class="btn primary" type="submit">보내기</button>
        </form>`;
      const form = body.querySelector('form');
      const ta = form.elements.text;
      const guide = body.querySelector('.support-guide');
      const thumbs = body.querySelector('.support-thumbs');
      const file = body.querySelector('input[type=file]');
      const shotBtn = body.querySelector('[data-act=shot]');

      form.addEventListener('change', (e) => {
        if (e.target.name !== 'kind') return;
        kind = kindOf(e.target.value);
        guide.textContent = kind.guide;
        ta.placeholder = kind.example || '편하게 적어 주세요.';
      });

      const drawThumbs = () => {
        thumbs.innerHTML = images.map((im, i) => `<span class="thumb"><img src="${im.url}" alt="붙인 사진 ${i + 1}"><button type="button" class="icon-btn" data-rm="${i}" aria-label="사진 ${i + 1} 빼기">✕</button></span>`).join('');
        shotBtn.hidden = images.length >= SUPPORT_MAX_IMAGES;
      };
      shotBtn.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        for (const f of [...file.files].slice(0, SUPPORT_MAX_IMAGES - images.length)) {
          try {
            const b64 = await fileToJpegBase64(f, 1400);
            images.push({ b64, url: `data:image/jpeg;base64,${b64}` });
          } catch {
            toast('사진을 읽지 못했어요.');
          }
        }
        file.value = '';
        drawThumbs();
      });
      thumbs.addEventListener('click', (e) => {
        const b = e.target.closest('[data-rm]');
        if (!b) return;
        images.splice(Number(b.dataset.rm), 1);
        drawThumbs();
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!kind) return toast('어떤 문의인지 먼저 골라 주세요.');
        if (text.length < SUPPORT_MIN) return toast(`내용을 ${SUPPORT_MIN}자 이상 적어 주세요.`);
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = '보내는 중…';
        try {
          const token = await auth.accessToken();
          if (!token) throw new Error('로그인이 필요해요.');
          const res = await fetch('./api/support', {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              kind: kind.id,
              text,
              images: images.map((im) => im.b64),
              meta: {
                device: navigator.userAgent,
                standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
                screen: `${screen.width}×${screen.height}`,
                version: appVersion(),
                tab: tabName(),
              },
            }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j?.error?.message || '보내지 못했어요. 잠시 후 다시 시도해 주세요.');
          close();
          toast('문의를 보냈어요. 답장은 메일로 드릴게요.');
        } catch (err) {
          toast(err.message);
          btn.disabled = false;
          btn.textContent = '보내기';
        }
      });
    },
  });
}
