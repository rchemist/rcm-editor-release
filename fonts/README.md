# 글꼴 (`fonts/`)

인쇄 HTML(`@rchemist/editor/print`의 `fontCss()`)과 PDF 서버(Gotenberg — 같은 multipart 요청으로
전송된 파일을 상대 URL로 해석)가 쓰는 SIL OFL 1.1 글꼴만 둡니다. 이 디렉터리는 npm 패키지에
포함되지 않습니다(`package.json` `files`는 `dist`, `README.md`, `LICENSE`). 글꼴을 쓰는 소비자는 이
디렉터리를 자기 호스팅 경로에 복사해 `fontCss({ baseUrl })`로 그 경로를 가리킵니다.

## 계열

| 디렉터리 | 글꼴 | 파일 | weight | 크기 |
|---|---|---|---|---|
| `noto-sans-kr/` | Noto Sans KR | `NotoSansKR-Variable.woff2` | 100–900 (가변, 기본 100) | 3,908,716 B |
| `noto-serif-kr/` | Noto Serif KR | `NotoSerifKR-Variable.woff2` | 200–900 (가변, 기본 200) | 5,859,208 B |

두 계열 모두 한글 음절 11,172자 전체를 포함하는 가변 글꼴 한 파일씩입니다(정적 400/700 두
파일보다 작아 이 형태를 골랐습니다). 700(굵게)은 가변 축의 실제 인스턴스로 렌더링됩니다(Chromium
지원). 각 디렉터리의 `OFL.txt`는 해당 계열의 원본 라이선스 문서입니다.

## 라이선스

두 계열 모두 **SIL Open Font License 1.1**입니다. 각 `OFL.txt`(원본과 동일한 파일) 전문을
따르며, 예약명(reserved font name) 조건 등 세부 사항도 그 문서가 우선합니다.

## 출처

- 저장소: [google/fonts](https://github.com/google/fonts) GitHub — 공식 배포 채널.
  - `ofl/notosanskr` — 커밋 `b38c5c93af322c45f633e17ac440ec1e6c94d489` (2026-03-25)
  - `ofl/notoserifkr` — 커밋 `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5` (2026-03-12)
- 변환: 원본 가변 TTF를 로컬에 이미 존재하던 fonttools 4.62.1 + brotli 1.2.1(사용자 uv 캐시)로
  WOFF2로 압축했습니다(`fontTools.ttLib.woff2 compress`, 글리프 변경 없음).

### SHA-256

| 파일 | SHA-256 |
|---|---|
| `noto-sans-kr/NotoSansKR-Variable.woff2` | `f484190a87503ac2af2cf9771ec35122128453fe0cd92f4368117562d99547e6` |
| `noto-serif-kr/NotoSerifKR-Variable.woff2` | `e873199ed8f2a76e32c7239e877c6d0e89ed06d0df73bc4d718e3ddd05c2fa00` |
| 원본 `NotoSansKR[wght].ttf` (10,414,588 B) | `194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252` |
| 원본 `NotoSerifKR[wght].ttf` (23,795,420 B) | `11f8d5de6f1b79195efba3828aaa2ec95c1178f5ae976fb23c8d53250a9938f3` |
| `noto-sans-kr/OFL.txt` | `1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9` |
| `noto-serif-kr/OFL.txt` | `5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6` |

## 상용 글꼴 규칙 (핵심)

맑은 고딕, 한컴 계열 상용, 윤서체, 바탕·돋움·굴림·궁서(Microsoft), HY 계열, 함초롬(HCR) 등
상용·재배포 불가 글꼴 파일은 **어떤 형태로도 이 저장소에 들어오지 않습니다.** 이 이름들은
폰트 스택(`fontStack()`, docparser `fonts.go` 포팅)에서 이름으로만 참조되며, 실제 글꼴은
Noto Sans KR / Noto Serif KR이 대신 렌더링합니다. `npm run check:fonts`
(`scripts/check-fonts.mjs`)가 이 디렉터리에 허용 계열·파일만 있는지와 상용 글꼴 파일명
거부목록(malgun, hcr, hamchorom, 함초롬, batang, dotum, gulim, gungsuh, hy*, yoon 등)을 검사합니다.
