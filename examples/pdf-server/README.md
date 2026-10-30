# PDF server example

`@rchemist/editor/print`의 `renderPrintHtml()` 출력을 Gotenberg
(`/forms/chromium/convert/html`)로 보내 PDF로 바꾸는 예제 백엔드다. 패키지의 일부가 아니고
CI에서도 직접 실행하지 않는다(`npm run check:pdf`가 기동한다). Plain Node(>= 20), 의존성 없음.

```sh
npm run build                       # dist/print.js 필요
npm install --prefix examples/pdf-server   # jsdom(MIT): renderPrintHtml용 DOM
CI_RUN_ID=local1 docker compose -f deploy/compose.pdf.yaml -p pdf-local1 up -d
cd examples/pdf-server
GOTENBERG_URL=http://localhost:3000 PORT=8788 node server.mjs
```

## API

- `GET /health` → `{ "ok": true, "gotenberg": ..., "print": ... }`
- `POST /pdf` — 요청 본문(JSON):

```json
{
  "doc": { "type": "doc", "content": [] },
  "options": {
    "page": "A4",
    "margins": "20mm",
    "header": "머리말",
    "footer": "쪽 {page} / 전체 {pages}",
    "title": "문서 제목"
  }
}
```

성공하면 `application/pdf` 바이트를 돌려준다. `doc`이 없거나 JSON이 깨지면 400,
Gotenberg 연결 실패·비정상 응답은 502다. 본문 상한은 `MAX_BYTES`(기본 25 MiB).

## 동작

1. 글꼴 CSS는 항상 저장소 번들(`fontCss()` 기본값 + `../../fonts` 바이트)로 만든다.
   클라이언트가 보낸 `fontCss`는 무시한다. CSS의 상대 경로를 베이스명으로 고쳐 쓰고 같은
   이름으로 글꼴 파일을 multipart에 함께 보낸다(Gotenberg는 파일을 평탄 디렉터리에 놓으므로
   `fonts/...` 경로를 그대로 쓰면 404가 된다).
2. `renderPrintHtml(doc, { page, margins, header, footer, title, fontCss })`로 `index.html`을
   만든다. 고정한 Chromium은 `@page` margin box(`@top-center`·`@bottom-center`, `{page}`·
   `{pages}` → `counter(page)`·`counter(pages)`)를 렌더하므로, 보이는 머리말·바닥글은 이
   규칙으로 처리한다. `header.html`·`footer.html`은 보내지 않는다(같이 보내면 두 번 찍힌다).
3. 선행 전체-`th` 행이 있으면 `thead`로 끌어올린다(tiptap은 머리 행을 `tbody > tr > th`로
   내보내 `thead` 반복 규칙이 적용되지 않으므로. 인쇄 HTML 계약·`getHTML()` 동등성은 그대로).
4. 글꼴 변수 선언 앞에 `'Noto Sans KR'`을 덧붙인다(인쇄 토큰 기본 스택은 동봉 글꼴을 지명하지
   않아 시스템 CJK로 빠지므로. 원래 스택·generic 폴백은 유지).
5. 용지·여백은 폼 필드 대신 `preferCssPageSize=true`로 보내 `@page` 규칙을 그대로 쓴다.
   단위 변환이 필요 없다.

## 환경 변수

| 변수            | 기본값                  | 설명                                                                |
| --------------- | ----------------------- | ------------------------------------------------------------------- |
| `PORT`          | `8788`                  | 수신 포트                                                           |
| `GOTENBERG_URL` | `http://localhost:3000` | Gotenberg 주소(끝 `/` 자동 제거)                                    |
| `FONTS_DIR`     | `<repo>/fonts`          | `fonts/` 디렉터리 자체. `fontCss()` 상대 경로는 그 부모 기준으로 품 |
| `MAX_BYTES`     | `26214400`              | 요청 본문 상한                                                      |
| `ALLOW_ORIGIN`  | `*`                     | CORS 허용 origin (실사용에는 앱 origin으로)                         |
