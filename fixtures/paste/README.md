# 붙여넣기 픽스처 (`fixtures/paste/`)

per-source 붙여넣기 매핑(`src/paste/normalize.ts`) 검증용 합성 픽스처.
`tests/paste/fixtures.test.ts`가 사용한다.

- **합성 표본입니다.** 각 소스(Word·HWP/HWPX·웹·Google Docs)의 실제 클립보드 HTML 형식을
  모델로 만들었으며 실제 문서에서 수집한 것이 아니다. 실제 표본 수집과 보존률 측정은 별도로 한다.
- **기대 JSON(`*.json`)** 은 빈 문서에 픽스처를 붙여넣었을 때의 `getJSON().content`다.
  소스 HTML과 대조해 속성별로 검토했다(스냅샷 아님).
- 보안 검증(정책 우회 시도 등)은 이 디렉터리가 아니라 `tests/guard/`가 담당한다.

| 픽스처 | 형식 특징 | 다루는 핵심 속성 |
|---|---|---|
| `word/paragraphs.html` | `xmlns:o/w` 네임스페이스, 조건부 주석, `<style>`의 `p.MsoNormal`/`p.MsoBodyText` 클래스 규칙, `<o:p>`, `mso-para-margin-left`·`mso-line-height-rule`·`mso-fareast-font-family`·`mso-ascii-font-family`·`mso-ansi-font-size`·`mso-highlight` | `lineHeight`(115%·160%·18pt), `indent`, `spaceBefore`/`spaceAfter`/`marginLeft`, `fontFamily`(한글 글꼴 우선 스택), pt `fontSize`(18.0pt/9.0pt), `color`(#c00000), 형광펜(highlight yellow) |
| `word/table.html` | Excel 내보내기형 표, `.xl65`/`td.xl66` 클래스 규칙, `colgroup`, `mso-border-alt`, 셀 `background` | 셀 `backgroundColor`(#c00000·#d9e2f3), 테두리(`1.0pt solid windowtext`), `colwidth`(142px 등), 병합(`colspan:2`·`rowspan:2`), 셀 정렬(`textAlign` center/left/right), `verticalAlign`(middle/top), 표 `width`(pt→px) |
| `hwp/document.html` | 한컴 제너레이터 meta(`Hancom Office Hanword` → hwp 분류), `HStyle1~3`/`td.HCell1` 클래스 규칙 | `lineHeight`(130%·160%·18pt), `indent`(14.17pt), 여백(0pt/4pt/28.35pt), `fontFamily`("함초롬바탕" 등), pt `fontSize`, `color`(#31859c), 셀 `backgroundColor`(#d9e2f3), 셀 테두리(#4472c4), `colwidth`(157.5pt→210px), `verticalAlign`(center→middle), `textAlign`(center) |
| `hwp/hwpx.html` | HWPX 문단 네임스페이스(`hancom.co.kr/hwpml/2022/paragraph` → hwpx 분류), 인라인 스타일만 | `lineHeight`(150%·18pt), `marginLeft`(42.55pt), 음수 `indent`(-14.17pt, 내어쓰기), pt `fontSize`(10.5pt/14.0pt), `color`(#1f3864·#c00000), 셀 `backgroundColor`(#e2efda), 셀 테두리, `colwidth` |
| `web/paragraphs.html` | 순수 인라인 스타일 문단 | 문단 inline style 보존(여백 12pt/24pt, `indent` 10pt, `lineHeight` 1.6/18pt/2.0), `fontFamily`(스택 원문), pt `fontSize`, `color`, 배경색(highlight #fff2cc), `textAlign` center |
| `web/figure.html` | `figure`+`img`+`figcaption` | figure/figcaption 노드 매핑, 이미지 `src`/`alt`/`width`/`height`, 캡션 textStyle(10pt·#595959) |
| `gdocs/paragraphs.html` | `docs-internal-guid-*` 래퍼 `<b style="font-weight:normal">`, 스팬 스타일(`font-weight:700`·`font-style:italic`·`text-decoration:underline`·`background-color:transparent`) | 래퍼 제거, bold/italic/underline 마크, `color`(#1155cc 등), pt `fontSize`(11pt/12pt/14pt), `fontFamily`, `lineHeight` 1.38, 문단 여백(12pt) |
| `gdocs/list.html` | 래퍼 안의 `ul`/`ol`, 항목별 스팬 스타일 | 글머리/번호 목록 유지, 항목 textStyle(`color`·pt `fontSize`), 굵게 항목 |
