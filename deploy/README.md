# PDF 레퍼런스 (Gotenberg)

`@rchemist/editor/print`의 `renderPrintHtml()` 출력을 서버에서 PDF로 바꾸는 레퍼런스 구성이다.
브라우저(클라이언트) 래스터화(html2canvas/jspdf 계열)는 쓰지 않는다. 패키지에 새 런타임 의존을
더하지 않으며, 예제 서버도 Node 내장(`node:http`, 전역 `fetch`/`FormData`/`Blob`)만 쓴다.

## 실행

```sh
# 직접 기동 (CI_RUN_ID는 실행마다 고유하게)
CI_RUN_ID=local1 GOTENBERG_PORT=3000 docker compose -f deploy/compose.pdf.yaml -p pdf-local1 up -d
curl -sf http://localhost:3000/health   # 준비 확인
node examples/pdf-server/server.mjs     # http://localhost:8788, GOTENBERG_URL로 Gotenberg 지정

# 끝난 뒤 정리 (프로젝트 볼륨·네트워크까지 삭제)
docker compose -f deploy/compose.pdf.yaml -p pdf-local1 down -v --remove-orphans
```

정식 검사는 `npm run check:pdf`(`scripts/pdf-check.sh`)가 같은 과정을 자동화한다. 고유
프로젝트명(`-p pdfcheck-<id>`), `trap ... EXIT` 정리, 실행 뒤 남은 컨테이너·볼륨·네트워크가
0개임을 확인한다. Docker 호출은 HARNESS 게이트
(`HARNESS_TEST_ROLE=gate sh ~/.claude/locks/test_gate.sh -- <cmd>`) 안에서만 한다.

## 이미지와 플래그

- 이미지: `gotenberg/gotenberg:8.37.0` (MIT, exact tag 고정. `:8`·`:latest` 금지).
  manifest list 다이제스트(2026-10-30 조회):
  `sha256:f29984bd1e226bf1b93ba90af06000afa8b315853e99d27b9aaa41b93f15c769`.
- `--api-timeout=60s`: 요청 전체 상한. 초과분은 503으로 실패한다.
- `--chromium-max-queue-size=16`: Chromium 대기열 상한. 폭주 시 무한 대기가 아니라 503으로
  빨리 실패한다(0은 무제한이라 쓰지 않는다).
- `--chromium-disable-javascript=true`: 인쇄 HTML은 script-free이므로 렌더러 측에서도 JS를
  끈다. `waitDelay`·`waitForExpression` 같은 동적 대기 기법은 사용하지 않는다.
- `--chromium-deny-private-ips=true`: 해석된 IP가 사설(loopback·RFC1918·link-local·CGNAT·
  IPv6 ULA)이면 내비게이션/하위 리소스를 거부한다. 공격자 도메인이 사설 IP로 해석되는 경우까지
  막는 1차 방어다.
- `--chromium-deny-list` (반복, OR. allow-list·IP 판정보다 항상 우선):
  - `^file:(?!///tmp/).*` — `file://` 전면 차단. Gotenberg 자신의 `/tmp` 작업 디렉터리만
    예외로 둬야 multipart로 함께 보낸 `index.html`·글꼴·에셋이 읽힌다.
  - `^https?://169\.254\..*` — link-local 대역(클라우드 메타데이터 `169.254.169.254` 포함).
  - 메타데이터 호스트명(`metadata.google.internal` 등).
- `--chromium-allow-list`는 기본값(All) 유지: 위 deny 규칙이 항상 먼저 거부하므로 별도 허용
  목록을 두지 않는다.

## 왜 deny list인가 (SSRF)

인쇄 HTML은 사용자 문서에서 나온다. `<img src>`·`<a href>`·원시 HTML 임베드(`htmlPolicy`
`trusted` 포함)에 외부·내부 URL이 들어갈 수 있고, 서버 사이드 Chromium이 그 URL을 대신
가져오면 내부망·클라우드 메타데이터로 향하는 요청이 된다. `--chromium-deny-private-ips`가
해석 결과 기준으로, `--chromium-deny-list`가 문자열 기준으로 각각 차단하는 이중 구조다.
그래도 남는 위험은 아래 「남은 위험」 참고.

## 글꼴 (multipart 전송)

`fontCss()` 기본 출력의 상대 경로(`fonts/noto-sans-kr/NotoSansKR-Variable.woff2`)는
Gotenberg(`/forms/chromium/convert/html`)와 맞지 않는다. 업로드된 파일이 모두 하나의 평탄한
디렉터리에 놓이고 파일명으로만 참조되기 때문이다. 예제 서버(`examples/pdf-server/`)가
`@font-face`의 `url(...)`을 베이스명(`NotoSansKR-Variable.woff2` 등)으로 고쳐 쓰고, 같은
이름으로 글꼴 파일을 함께 보낸다.

여기에 한 가지를 더한다. 인쇄 토큰의 기본 글꼴 스택(`system-ui, …`)은 동봉 OFL 계열을
지명하지 않아, 그대로 두면 본문이 이미지 내장 시스템 CJK 글꼴로 빠져 `pdffonts`
검사가 깨진다. 예제 서버는 `index.html`의 글꼴 변수 선언
(`--rcm-editor-font-family`·`--rcm-editor-font-mono`·`--rcm-editor-font-math`) 앞에
`'Noto Sans KR'`을 덧붙인다. 원래 스택·generic 폴백은 그대로 두어 없는 글리프는
대체 렌더된다. 패키지(`src/print`, 에디터 토큰)는 손대지 않는다.

## 쪽 바닥글·쪽 번호

고정한 Chromium(8.37.0)은 CSS `@page` margin box(`@top-center`·`@bottom-center`)를
렌더한다. `renderPrintHtml({ header, footer })`의 margin box 규칙이 그대로 PDF에 나온다.
`{page}`·`{pages}` 자리는 `counter(page)`·`counter(pages)`로 바뀌어 실제 쪽 번호가 찍힌다.
프로브(단독 `@page` 문서, `footer.html` 없음)로 머리말·`마진 1 / 1` 바닥글 렌더를 확인했다.

그래서 예제 서버는 Gotenberg `header.html`·`footer.html`을 보내지 않는다. 같이 보내면
같은 내용이 두 번 찍힌다. 용지·여백은 `preferCssPageSize=true`로 보내 `@page`
규칙을 그대로 쓴다(용지·여백 폼 필드 대신). 바닥글 공간도 CSS `@page` 여백에서 나온다.

## 남은 위험 (특히 SSRF·원격 이미지)

- `allow-list`를 열어 두었으므로 공인 IP의 원격 이미지는 Chromium이 그대로 가져온다. 발신 IP
  노출, 내부망이 아닌 외부 SSRF(클라우드 함수 URL 등 토큰형 엔드포인트) 가능성은 남는다.
  외부 fetch를 원천 차단하려면 `--chromium-allow-list`에 필요한 호스트만 등록한다.
- `asset:` 참조·상대 URL 이미지는 Chromium이 해석하지 못해 빠진다. `pdf-check.sh`는 검사 전에
  `fixtures/docparser*/assets/`에서 바이트를 찾아 `data:` URL로 인라인한다(프로덕션에서도 같은
  전처리가 필요하다).
- `deny-private-ips`는 DNS 해석 시점 기준이라 DNS rebinding·리다이렉트 체인 우회에 완전하지
  않다. 민감 환경에서는 egress 프록시·네트워크 정책과 함께 쓴다.
- 여러 쪽 표 머리행 반복: tiptap은 머리 행을 `tbody > tr > th`로 내보내(`getHTML()`과 동일)
  `thead` 반복 규칙이 적용되지 않는다. 예제 서버는 파이프라인에서 선행 전체-`th` 행만
  `thead`로 끌어올린다. 인쇄 HTML 계약과 `getHTML()` 동등성은 그대로 둔다.

## 예제 서버를 실제로 배포할 때

- `examples/pdf-server`는 참조 구현입니다. 기본 `ALLOW_ORIGIN=*`과 인증 없음 상태로 공개하면 어떤 웹 페이지든 이 서버를 공개 호스트 fetch 프록시로 쓸 수 있습니다. 배포 전에 `ALLOW_ORIGIN`을 제품 도메인으로 좁히고 인증을 앞에 둡니다.
- 오류 응답은 일반 문구만 돌려주고 상세(Gotenberg 주소·응답 본문)는 서버 로그에만 남깁니다.
- `page`·`margins`는 `renderPrintHtml`이 `A4`/`Letter`와 CSS 길이(`mm`·`cm`·`in`·`pt`·`pc`·`px`)만 받고 나머지는 기본값으로 바꿉니다. `fontCss`는 서버가 저장소 글꼴로만 만들고 요청 값은 쓰지 않습니다.
