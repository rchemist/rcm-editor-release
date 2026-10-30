# rcm-editor

> Rchemist 제품군 공용 WYSIWYG(클래식형) 리치텍스트 에디터. tiptap v3(MIT) 기반이며, 표·이미지·글꼴·문단 서식, Word/한글 붙여넣기 정리, 쪽 분할 미리보기, 서버 PDF 출력을 라이선스 비용 없이 제공하는 것을 목표로 합니다.

상태: **0.1.0 공개 준비** — npm 패키지 `@rchemist/editor`의 첫 공개 릴리스입니다.

## 설치

```sh
npm i @rchemist/editor
```

필수 peer 의존성입니다(npm 7 이상은 설치 때 자동으로 함께 설치합니다).

- `@tiptap/core`, `@tiptap/pm`, `@tiptap/react` `^3.32.1`
- `react`, `react-dom` `>=18`

선택 peer인 `@rchemist/listgrid`(>=0.5.0)는 listgrid 어댑터를 쓸 때만 필요합니다.

스타일 한 줄을 먼저 넣습니다.

```ts
import '@rchemist/editor/styles.css';
```

## 빠른 사용

```tsx
import { useState } from 'react';
import '@rchemist/editor/styles.css';
import { RcmEditor } from '@rchemist/editor/react';

export function App() {
  const [value, setValue] = useState('<p>안녕하세요</p>');
  return <RcmEditor value={value} onChange={(change) => setValue(change.html)} />;
}
```

`value`는 HTML 문자열 또는 tiptap JSON을 받습니다. `onChange`는 `{ json, html }` 페이로드를 건네며, 두 필드는 처음 읽을 때 직렬화되므로 저장할 쪽만 읽으면 됩니다. 변경 알림은 기본 100ms 디바운스(`changeDebounceMs`)가 걸리고, blur·언마운트·`ref.flush()` 때 즉시 발송됩니다.

## 서브패스

| 서브패스       | 용도                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `.`            | 스키마·확장·가드·HTML 정책 등 프레임워크 무관 코어(`createEditorExtensions`, `applyHtmlPolicy` 등) |
| `./react`      | `<RcmEditor />`, `<PrintPreview />`, 툴바 프리셋·라벨                                              |
| `./vanilla`    | React 없이 쓰는 `mountEditor(element, options)`                                                    |
| `./upload`     | 업로더 팩토리(`base64Uploader`, `httpUploader`, `presignedUploader`, `withPolicy`)                 |
| `./paste`      | 헤드리스 붙여넣기 정규화(`normalizePastedHtml` 등)                                                 |
| `./print`      | 인쇄 HTML 렌더러(`renderPrintHtml`, `printCss`, `fontCss`)                                         |
| `./listgrid`   | listgrid `MarkdownEditor` 자리에 꽂는 `RcmListgridEditor`, `createListgridEditor`                  |
| `./docparser`  | docparser tiptap JSON 가져오기(`fromDocparser`, `createDocparserAssetResolver`)                    |
| `./styles.css` | 에디터·툴바·미리보기 스타일                                                                        |

## 가이드

- [확장 포인트](./docs/extending.md) — 확장 추가·교체, 툴바 구성, 라벨, 테마, 에디터 인스턴스 접근, `htmlPolicy`, raw HTML 보존
- [업로드 레시피](./docs/upload-recipes.md) — presigned URL, 자체 서버 multipart POST, 인라인 base64, listgrid 어댑터
- [docparser 문서 가져오기](./docs/docparser.md)
- [tiptap 버전 관리](./docs/tiptap-versions.md)

## PDF 출력

인쇄 HTML(`./print`의 `renderPrintHtml`)을 서버에서 Chromium으로 렌더합니다. `deploy/compose.pdf.yaml`이 Gotenberg 레퍼런스 구성을 담고 있으며, Chromium 네트워크 제한·JS 비활성화 등 세부 사항은 `deploy/README.md`에 있습니다.

## 왜 만드나

- 고객 다수가 블록 에디터가 아닌 "워드·한글 같은" WYSIWYG 편집을 원합니다.
- 기존 tiptap 에디터(제품마다 다른 계보로 존재)는 표 선택 표시 없음, 표·셀 서식 손실, 이미지 크기·캡션 없음, 스크린샷 붙여넣기 불가, Word 붙여넣기 서식 손실 등 마감이 되지 않았습니다.
- 고객이 원하는 기능 대부분은 이제 tiptap MIT 범위에 있고, 유료로 남은 영역(쪽 편집·PDF 변환·Office 붙여넣기)은 자체 구현과 오픈소스로 대체합니다.

## 범위

| 포함                                                                                                                                                                                                                                                   | 제외                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 표(병합·너비·테두리·셀 배경·세로 정렬), 이미지(크기·정렬·캡션·붙여넣기 업로드), 글꼴·pt 크기·색·줄간격, 정렬·들여쓰기·문단 간격, 목록, 찾기·바꾸기, 실행 취소, 맞춤법(브라우저), Word/한글/웹 붙여넣기 정리, 쪽 나눔과 쪽 분할 미리보기, 서버 PDF 출력 | HWP·DOC 저장, 쪽 위 직접 편집(Pages류), 유료 SDK, 댓글·변경추적(후순위) |

## 설계 원칙

- **docparser 스키마 정합**: [docparser](https://github.com/rchemist/docparser)가 HWP/HWPX/DOCX/PDF를 변환한 tiptap JSON(`docs/tiptap.md`)을 손실 없이 편집할 수 있어야 합니다. 문서 가져오기는 docparser가 담당합니다.
- **라이선스 의무 최소화**: 런타임 의존성은 MIT/Apache/BSD 계열만 사용합니다(GPL/AGPL 제외).
- **소비자 독립**: 업로드·번역·글꼴 목록은 주입받습니다. `@rchemist/listgrid`의 `MarkdownEditor`/`HtmlField` 슬롯에 바로 꽂을 수 있는 어댑터를 제공합니다.

## 라이선스

[Apache-2.0](./LICENSE).
