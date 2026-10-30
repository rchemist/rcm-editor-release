# docparser 문서 가져오기

docparser(`documents:render`, target `tiptap`)가 낸 tiptap JSON을 `@rchemist/editor`에서 열고, 다른 문서의 일부를 커서 위치에 끼워 넣는 방법입니다. 서브패스 `@rchemist/editor/docparser`는 프레임워크에 의존하지 않습니다(React 코드 없음).

## 1. 요청: `tiptap_profile: "rcm-editor"`

기본 렌더는 docparser 스키마(`docs/tiptap.md` §1)만 냅니다. 에디터 전용 노드(쪽 나눔, 그림+캡션)가 필요하면 요청에 프로필을 지정합니다. 프로필을 생략하거나 `null`이면 출력은 이전과 바이트 단위로 같습니다.

### HTTP

```json
{
  "schema_version": 1,
  "blob_inline_b64": "…",
  "blob_sha256": "…",
  "media_type": "application/vnd.hancom.hwpx",
  "target": "tiptap",
  "render_revision": "tiptap-0.1.1+rcm-editor.2",
  "tiptap_profile": "rcm-editor"
}
```

- `render_revision`은 형식별 기본 revision에 `+rcm-editor.N`을 붙인 값이어야 합니다. 배포가 광고하는 값은 `GET /v1/version`의 `render_targets[].profiles["rcm-editor"]`에서 읽습니다. 다른 값은 `UNSUPPORTED_VERSION`(400)입니다.
- 모르는 프로필 이름, 빈 문자열, tiptap 이외 target의 값은 `INVALID_CONTRACT`입니다.
- `ranges`를 함께 주면 응답이 `docs: [{ range, doc }]`가 됩니다(`doc` 대신). 프로필은 범위 렌더에도 적용됩니다.

### 라이브러리(Go)

```go
res, err := docparser.Render(ctx, docparser.RenderInput{
    // …
    TiptapProfile: "rcm-editor", // tiptapprovider.RCMEditorProfile
}, tiptapprovider.Provider{})
// 또는 tiptapprovider.Provider{Profile: "rcm-editor"}
```

`res.RenderRevision`이 `tiptap-0.1.1+rcm-editor.2` 형태가 됩니다. 범위 렌더는 `RangeRenderInput.TiptapProfile`입니다.

### revision과 나오는 노드

| 단계 | revision 접미 | 추가로 나오는 노드 |
| --- | --- | --- |
| 1 | `+rcm-editor.1` | `pageBreak`(HWPX `pageBreak="1"`/`"true"` 문단 앞, 블록 형식의 쪽 경계), `figure` + `figcaption`(그림에 연결된 캡션, 여러 문단 캡션은 `hardBreak`로 연결) |
| 2 (docparser v0.18.0) | `+rcm-editor.2` | 중첩 `bulletList`/`orderedList`(`start`) > `listItem` > `paragraph`(목록용 `indent`/`marginLeft`는 제거), `table.width`(px 정수)·`align`(`center`/`right`)·`border`(네 변이 같을 때), `image.align`(글자처럼 취급 → `inline`, `center`/`right`) |

- `columnBreak`만 있는 문단은 쪽 나눔이 아닙니다. 실제 구분선은 `horizontalRule`로 남습니다.
- 캡션이 없는 그림, 그림이 placeholder로 바뀐 경우는 `figure`로 묶이지 않습니다.
- 에디터는 위 노드를 모두 스키마에 갖고 있어(`pageBreak`, `figure`, `figcaption`) 무손실로 편집합니다. 프로필 없이 받은 문서도 그대로 열립니다.
- 이름과 값 형식의 정본은 docparser `docs/tiptap.md` §1이고, 에디터 쪽 정의는 `src/extensions/`에 있습니다.

## 2. 응답 열기: `fromDocparser`

```ts
import { fromDocparser } from '@rchemist/editor/docparser';

const result = fromDocparser(await response.json(), {
  ranges: 'concat', // 'concat'(기본) | 'select'
  separator: 'pageBreak', // 'pageBreak'(기본) | 'horizontalRule' | 'none' | (index) => JSONContent[]
  // index: 1, // ranges: 'select'일 때 고를 범위(기본 0)
});

result.content; // tiptap doc JSON → setContent / <RcmEditor value>
result.resolveAsset; // asset:sha256:<hex> → blob URL
result.warnings; // 응답의 warnings[]
result.ranges; // [{ index, title? }] docs[] 항목마다 하나(doc 응답은 1개)
result.renderRevision;
result.dispose(); // 만든 blob URL 모두 revoke
```

- 입력은 `{ doc }` 또는 `{ docs }`(둘 중 정확히 하나)와 선택 `assets`, `warnings`, `render_revision`입니다. `docs[i]`는 HTTP의 `{ range, doc }` 래퍼 또는 doc 자체입니다.
- 입력은 바꾸지 않습니다. 잘못된 입력은 `DocparserImportError`(`code`: `invalid_response`, `invalid_doc`, `invalid_asset`, `invalid_option`, `range_out_of_bounds`)로 던집니다.
- `concat`은 범위 사이에 `separator`를 넣습니다. 함수형은 뒤따르는 범위의 인덱스(1…n-1)를 받아 블록 배열을 돌려줍니다. 범위별로 끝에 붙은 `footnotes`는 하나로 합쳐 결과 끝에 둡니다(같은 `id`는 한 번만).
- `assets[]`는 `Blob` → `URL.createObjectURL`로 **처음 해석할 때** 만들고 캐시합니다. 모르는 sha256은 `undefined`를 돌려주어 이미지 노드 뷰가 누락 상태를 보여 줍니다. 화면을 닫을 때 `dispose()`를 부르세요(여러 번 불러도 됩니다).
- 응답 여러 개를 한 에디터에서 쓰려면 리졸버를 직접 만들어 넘깁니다. 이때 `result.dispose()`는 그 리졸버를 건드리지 않고, 소유자가 `resolver.dispose()`를 부릅니다.

```ts
import { createDocparserAssetResolver, fromDocparser } from '@rchemist/editor/docparser';

const resolver = createDocparserAssetResolver(); // (assets?)
const a = fromDocparser(resA, { resolver });
const b = fromDocparser(resB, { resolver });
resolver.add(moreAssets); // 같은 sha256은 첫 사본 유지
resolver.dispose();
```

### `<RcmEditor>`에 연결

`features`는 생성 시 한 번 읽습니다. 리졸버를 먼저 만들어 `image.resolveAsset`에 꽂고, 문서를 열 때 자산을 추가한 뒤 내용을 바꿉니다.

```tsx
import { RcmEditor } from '@rchemist/editor/react';
import { createDocparserAssetResolver, fromDocparser } from '@rchemist/editor/docparser';

const resolver = createDocparserAssetResolver();
const features = { image: { resolveAsset: resolver }, inlineImage: { resolveAsset: resolver } };

function Viewer({ response }) {
  const [content, setContent] = useState(null);
  useEffect(() => {
    const result = fromDocparser(response, { resolver });
    setContent(result.content);
  }, [response]);
  useEffect(() => () => resolver.dispose(), []);
  return <RcmEditor features={features} value={content ?? undefined} />;
}
```

`features.image.resolveAsset`와 `createEditorExtensions({ resolveAsset })`는 함수와 `add`/`dispose`가 붙은 리졸버 모두 받습니다. 툴바의 `importDocument` 슬롯(가져오기 함수는 소비자 주입)은 T3.2에서 들어옵니다.

### 헤드리스

```ts
import { Editor } from '@tiptap/core';
import { createEditorExtensions } from '@rchemist/editor';
import { createDocparserAssetResolver, fromDocparser } from '@rchemist/editor/docparser';

const resolver = createDocparserAssetResolver();
const editor = new Editor({
  element,
  extensions: createEditorExtensions({ resolveAsset: resolver }),
});
const result = fromDocparser(response, { resolver });
editor.commands.setContent(result.content);
// 끝낼 때
editor.destroy();
resolver.dispose();
```

## 3. 커서에 끼워 넣기: `insertDocument`

core 키트의 `insertDocument` 확장(기능 키 `insertDocument`, 기본 켜짐)이 명령을 등록합니다.

```ts
editor.commands.insertDocument(result.content, {
  at: 'selection', // 기본. 숫자면 문서 위치
  assets: response.assets, // 선택. 에디터 리졸버에 add()가 있으면 거기에 합칩니다
});
```

- `content`는 tiptap `doc`(그 블록을 넣음), 블록 하나, 블록 배열 중 하나입니다. 비었거나 형식이 틀리면 `false`를 돌려주고 문서는 그대로입니다. 잘못된 `assets` 항목은 `DocparserImportError`를 던지며 문서는 바뀌지 않습니다.
- 커서가 문단 가운데면 문단을 둘로 가르고 그 사이에 넣습니다. 문단 시작·끝이면 그 앞·뒤에 넣고, 빈 문단은 내용이 문단으로 끝날 때 대체합니다(표·그림으로 끝나면 빈 문단을 남겨 이어 쓸 자리를 둡니다). 선택 영역이 있으면 지우고 그 자리에 넣습니다.
- 한 번의 트랜잭션이라 실행 취소 1회로 이전 문서가 그대로 돌아옵니다.
- 내용은 무손실 가드를 거칩니다. 스키마가 모르는 노드는 `unsupportedNode`로 보존되고 `onContentReport`(`source: "insertContent"`)로 보고됩니다.
- 삽입한 표의 값(`colwidth` 등)은 문서를 열 때와 같이 다시 계산하지 않습니다.
- 알려진 한계: 삽입한 문서의 `footnotes`는 삽입 위치에 그대로 들어갑니다(대상 문서 끝의 `footnotes`와 합치지 않음).
