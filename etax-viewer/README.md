# 세금계산서 뷰어

국세청 홈택스가 메일로 보내는 전자세금계산서 첨부파일(`NTS_eTaxInvoice.html`)을 여는 단독 웹페이지입니다.
아이폰 메일·파일 앱에서는 이 첨부파일의 비밀번호 입력칸이 뜨지 않아서 만들었습니다.

- 파일을 고르고 공급받는 사업자등록번호를 넣으면 요약(합계·품목·공급자·공급받는자), 원본 화면, 원본 XML 저장을 보여 줍니다.
- 해독은 이 페이지 안에서 직접 합니다. 홈택스를 포함해 어떤 서버에도 접속하지 않습니다(페이지 CSP `connect-src 'none'`).
  원본 화면은 스크립트를 막고 바깥 이미지(국세청 읽음 확인 이미지 포함)도 불러오지 않습니다.
- 빌드 과정이 없는 정적 파일 4개(`index.html`, `app.js`, `etax.js`, `style.css`)입니다. 코스트노트 앱과 코드를 공유하지 않습니다.

## 파일 형식 (실제 메일로 확인)

| 숨은 칸 | 내용 |
|---|---|
| `idCriHeader` | Base64 → 바이트마다 XOR `0x6B` → `이름:값` 줄. 암호 방식(1 AES, 2 SEED, 3 ARIA), `HashKey`, 첨부 이름 |
| `idCriPcContents` / `idCriMobileContents` | 세금계산서 화면 HTML 암호문 |
| `idCriAttachContentsN` | 첨부 암호문. 해독하면 Base64 가 한 번 더 나오고, 풀면 국세청 표준 XML |

- 열쇠 = `MD5(번호 숫자만)`, IV = 0 16바이트, CBC + PKCS#7
- `HashKey` 를 해독한 글자가 열쇠의 16진수 표기와 같으면 번호가 맞음
- 지금 국세청 파일은 SEED 를 씁니다. AES 는 브라우저 내장 기능으로 시도하고(실제 파일로는 확인 못 함), ARIA 는 지원하지 않습니다.

## 배포

`main` 에 `etax-viewer/` 가 바뀌면 `.github/workflows/etax-pages.yml` 이 테스트 후 GitHub Pages 로 올립니다.

## 테스트

```sh
npx vitest run tests/unit/etax.test.js        # MD5·SEED 표준 시험값, 가짜 보안메일 열기
npx playwright test tests/e2e/etax-viewer.spec.js
```

테스트는 `tests/unit/etaxSample.js` 가 만드는 가짜 보안메일만 씁니다(실제 사업자 정보 없음).
