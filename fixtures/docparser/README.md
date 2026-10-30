# docparser tiptap fixtures

docparser(`~/dev/docparser`)가 로컬에서 실제로 렌더한 tiptap JSON입니다. JSON을 손으로 만든 적은 없습니다. 입력 문서 중 `synthetic-*.hwpx`만 합성(OWPML)이고, 그 JSON도 docparser가 만든 출력입니다. 에디터의 무손실 편집(round-trip) 검증 입력으로 씁니다.

## 형식

- `<slug>.json` = `{ "source", "docparser_commit", "render_revision", "doc" }`. 2칸 들여쓰기, 끝 개행, `doc`의 키 순서는 docparser JCS 순서(키 알파벳순) 그대로입니다.
- `profile/<slug>.json`: 같은 `src/`를 요청 `tiptap_profile:"rcm-editor"`(docparser ≥ v0.18.0)로 렌더한 결과. 래퍼 형식은 같고 `render_revision`만 `<기본>+rcm-editor.2`입니다. 프로필 노드는 아래 표의 `synthetic-profile`(`pageBreak`, `figure`/`figcaption`)과 `rcm-structures`(목록·`table.*`·`image.align`)에만 나옵니다.
- `assets/<sha256>.<ext>`: 기본·프로필 양쪽 `doc` 안 `src="asset:sha256:<hex>"`가 가리키는 이미지 바이트.
- `src/`: 렌더 입력 원본.
  - `sample-regulation.hwpx`, `sample-image.hwpx`, `sample-doc.docx`: docparser `examples/editor/web/public/samples/`에서 복사.
  - `nested-table.hwpx`, `nested-table.docx`: docparser `contract/fixtures/render_hwpx_nested`, `render_docx_nested`의 `request.json` `blob_inline_b64`를 풀어 낸 문서.
  - `rcm-structures.hwpx`: docparser `contract/fixtures/render_hwpx_rcm_editor_structures`의 `request.json` `blob_inline_b64`를 풀어 낸 문서(sha256 일치 확인). 프로필 렌더는 그 계약의 `expected.jcs.json` `doc`과 같습니다.
  - `synthetic-paragraph.hwpx`, `synthetic-table-style.hwpx`, `synthetic-objects.hwpx`, `synthetic-profile.hwpx`: `scripts/gen-fixtures/synth.go`가 만드는 합성 HWPX(고정 zip 순서·타임스탬프라 바이트가 재현됨). OWPML 모양은 docparser의 `render_test.go`, `fixtures_test.go`, `hwpx/render_shapes.go`, `hwpx/render_table.go`를 따랐습니다. 이 4개는 `gen-fixtures.sh`가 매번 다시 씁니다.

## 목록

실제 포함된 노드·속성은 아래 표와 같습니다.

| fixture | source | render_revision | 노드(속성) | 마크(속성) |
| --- | --- | --- | --- | --- |
| `regulation.json` | `sample-regulation.hwpx` | `tiptap-0.1.1` | doc, footnote(id,label), footnoteReference(id,label), footnotes, heading(level), paragraph, table, tableCell(colspan,rowspan), tableHeader(colspan,rowspan), tableRow, text | 없음 |
| `image.json` | `sample-image.hwpx` | `tiptap-0.1.1` | doc, image(height,src,width), paragraph, table, tableCell(colspan,rowspan), tableRow, text | 없음 |
| `nested-table.json` | `nested-table.hwpx` | `tiptap-0.1.1` | doc, paragraph, table, tableCell(colspan,rowspan), tableRow, text | 없음 |
| `doc-docx.json` | `sample-doc.docx` | `tiptap-blocks-0.8.0` | bulletList, doc, heading(level), listItem, paragraph, table, tableCell(colspan,rowspan), tableHeader(colspan,rowspan), tableRow, text | 없음 |
| `nested-table-docx.json` | `nested-table.docx` | `tiptap-blocks-0.8.0` | doc, paragraph, table, tableCell(colspan,rowspan), tableRow, text | 없음 |
| `synthetic-paragraph.json` | `synthetic-paragraph.hwpx` | `tiptap-0.1.1` | doc, hardBreak, heading(level), paragraph(indent,lineHeight,marginLeft,marginRight,spaceAfter,spaceBefore,textAlign), text | bold, highlight(color), italic, strike, subscript, superscript, textStyle(color,fontFamily,fontSize,fontStretch,letterSpacing), underline |
| `synthetic-table-style.json` | `synthetic-table-style.hwpx` | `tiptap-0.1.1` | doc, heading(level), paragraph, table, tableCell(backgroundColor,borderBottom,borderLeft,borderRight,borderTop,colspan,colwidth,rowspan,verticalAlign), tableHeader(backgroundColor,borderBottom,borderLeft,borderRight,borderTop,colspan,colwidth,rowspan,verticalAlign), tableRow, text | 없음 |
| `synthetic-profile.json` | `synthetic-profile.hwpx` | `tiptap-0.1.1` | doc, heading(level), image(height,src,width), paragraph, text | 없음 |
| `rcm-structures.json` | `rcm-structures.hwpx` | `tiptap-0.1.1` | doc, heading(indent,level,lineHeight,marginLeft,spaceAfter,spaceBefore,textAlign), image(height,src,width), paragraph(indent,lineHeight,marginLeft,spaceAfter,spaceBefore,textAlign), table, tableCell(colspan,rowspan), tableRow, text | bold, textStyle(color,fontSize) |
| `synthetic-objects.json` | `synthetic-objects.hwpx` | `tiptap-0.1.1` | doc, equation(format,script), footnote(id,label), footnoteReference(id,label), footnotes, heading(level), image(height,src,width), paragraph(textAlign), placeholder(kind,reason), text, textBox(backgroundColor,borderBottom,borderLeft,borderRight,borderTop,width) | bold, italic, strike, underline |

### 프로필(`profile/`)

노드·속성은 기본 렌더와 같고, 아래 표시한 노드만 더 나옵니다.

| fixture | source | render_revision | 프로필에서만 나오는 노드 |
| --- | --- | --- | --- |
| `profile/regulation.json` | `sample-regulation.hwpx` | `tiptap-0.1.1+rcm-editor.2` | 없음 |
| `profile/image.json` | `sample-image.hwpx` | `tiptap-0.1.1+rcm-editor.2` | 없음 |
| `profile/nested-table.json` | `nested-table.hwpx` | `tiptap-0.1.1+rcm-editor.2` | 없음 |
| `profile/doc-docx.json` | `sample-doc.docx` | `tiptap-blocks-0.8.0+rcm-editor.2` | 없음 |
| `profile/nested-table-docx.json` | `nested-table.docx` | `tiptap-blocks-0.8.0+rcm-editor.2` | 없음 |
| `profile/synthetic-paragraph.json` | `synthetic-paragraph.hwpx` | `tiptap-0.1.1+rcm-editor.2` | 없음 |
| `profile/synthetic-table-style.json` | `synthetic-table-style.hwpx` | `tiptap-0.1.1+rcm-editor.2` | 없음 |
| `profile/synthetic-objects.json` | `synthetic-objects.hwpx` | `tiptap-0.1.1+rcm-editor.2` | 없음 |
| `profile/rcm-structures.json` | `rcm-structures.hwpx` | `tiptap-0.1.1+rcm-editor.2` | 중첩 `bulletList`/`orderedList(start)` > `listItem`(목록 문단의 `indent`/`marginLeft` 제거), `table(align,border,width)`, `image.align`(`inline`/`center`/`right`) |
| `profile/synthetic-profile.json` | `synthetic-profile.hwpx` | `tiptap-0.1.1+rcm-editor.2` | `pageBreak`(2), `figure`+`figcaption`(2: 한 문단 캡션, 두 문단 캡션은 `hardBreak`로 연결) |

`synthetic-profile.hwpx`는 `pageBreak="1"`·`"true"` 문단, 캡션 있는 그림 2개(한 문단·두 문단), `columnBreak` 문단(쪽 나눔 아님), 캡션 없는 그림(figure로 묶이지 않음)을 담습니다. 

모든 파일의 `docparser_commit`은 `147aae3`(v0.18.0 `d4a0064` + 문서만 변경)입니다.

## 기능별 위치

| 기능 | fixture |
| --- | --- |
| 병합 셀 colspan/rowspan | `synthetic-table-style`(colspan 2, rowspan 2), `regulation`, `doc-docx`, `nested-table*` |
| 셀 borderTop/Right/Bottom/Left (SOLID/DASH/DOT/DOUBLE, 변마다 다름) | `synthetic-table-style` |
| 셀 backgroundColor, verticalAlign(top/middle/bottom), colwidth | `synthetic-table-style` |
| 문단 lineHeight(비율 `1.6`, 고정 `18pt`) | `synthetic-paragraph` |
| indent, marginLeft, marginRight, spaceBefore, spaceAfter | `synthetic-paragraph` |
| textAlign(center/right/justify) | `synthetic-paragraph`, `synthetic-objects`(글상자 안) |
| textStyle fontFamily/fontSize/color/letterSpacing/fontStretch | `synthetic-paragraph` |
| highlight, bold/italic/underline/strike/superscript/subscript, hardBreak | `synthetic-paragraph` |
| image(asset:sha256 src, width/height) | `image`, `synthetic-objects`, `synthetic-profile`(16x12 PNG를 160x120으로) |
| textBox(배경·사방 테두리·width) | `synthetic-objects` |
| equation(format=hwp, script) | `synthetic-objects` |
| footnotes/footnote/footnoteReference | `regulation`, `synthetic-objects`(각주+미주) |
| placeholder(ole/chart `missing_binary`, image `unsupported_format`) | `synthetic-objects` |
| 쪽 나눔 `pageBreak` | `profile/synthetic-profile` |
| 그림 캡션 `figure`/`figcaption`(여러 문단 캡션 → `hardBreak`) | `profile/synthetic-profile` |
| 중첩 목록 `bulletList`/`orderedList(start)` | `profile/rcm-structures`, `fixtures/docparser-large/profile/large.json`(bulletList 72·listItem 113) |
| `table.width`/`align`/`border`, `image.align` | `profile/rcm-structures` |
| DOCX(블록 렌더러) | `doc-docx`, `nested-table-docx` |

## 재생성

```sh
bash scripts/gen-fixtures.sh ~/dev/docparser
```

먼저 합성 HWPX를 `src/`에 쓰고, `src/` 전체를 기본 출력과 `rcm-editor` 프로필로 두 번 렌더합니다. 임시 모듈(`replace`로 docparser 경로 지정)을 임시 디렉터리에 만들어 `scripts/gen-fixtures/*.go`를 빌드합니다. 모듈 캐시만 쓰며(`GOPROXY=off`) docparser 트리에는 쓰지 않습니다. 같은 docparser 리비전이면 출력은 바이트 단위로 같습니다.

## 갭

요구 기능 목록에서 비어 있는 것은 없습니다. 다만 다음은 이 세트가 다루지 않습니다.

- `limit_exceeded` placeholder(이미지 상한 초과)는 렌더 한도를 낮춰야 나와서 만들지 않았습니다.
- 원본이 HWP 5.x·PPTX·XLSX 등인 문서는 포함하지 않았습니다.
