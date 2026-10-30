# 확장 포인트

`@rchemist/editor`를 바꾸지 않고 동작을 더하거나 교체하는 방법입니다. 아래 이름은 모두 패키지 소스에 있는 실제 심볼입니다.

## 확장 추가·교체

`extensions` prop은 두 가지로 동작합니다. 배열이면 기본 확장 목록 뒤에 추가하고, 함수이면 기본값(`defaults`)을 받아 반환한 목록을 그대로 씁니다(제거·교체·순서 변경).

```tsx
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { RcmEditor } from '@rchemist/editor/react';

// 추가: 기본 확장 뒤에 붙습니다.
const extra = [
  Extension.create({
    name: 'myProbe',
    addProseMirrorPlugins: () => [new Plugin({ key: new PluginKey('myProbe') })],
  }),
];
<RcmEditor extensions={extra} />;

// 교체: defaults에서 빼거나 순서를 바꿉니다.
<RcmEditor extensions={(defaults) => defaults.filter((e) => e.name !== 'tableKit')} />;
```

기본 목록은 `createEditorExtensions()`(`@rchemist/editor`)이 만들며, `features` prop으로 내장 확장을 끄거나 옵션을 줄 수 있습니다(`features={{ tableKit: false }}`처럼 `false`는 비활성). `extensions`와 `features`는 생성 시 1회만 읽으므로 바꾸려면 React `key`를 바꿔 다시 마운트합니다. 헤드리스(React 없음)에서는 `createEditorExtensions()`와 `@tiptap/core` `Editor`를 직접 씁니다.

## 툴바 구성

`toolbar` prop은 `'simple' | 'full' | false | RcmToolbarConfig`입니다. 기본값은 `'full'`이고, `false`면 툴바를 렌더하지 않습니다. 프리셋 목록은 `TOOLBAR_PRESETS`(`@rchemist/editor/react`)로 공개되어 있습니다(`'|'`는 구분선).

```tsx
import { RcmEditor } from '@rchemist/editor/react';

<RcmEditor
  toolbar={{
    preset: 'full',
    hide: ['youtube', 'codeBlock'],
    overflow: 'wrap',
  }}
/>;

// items를 주면 preset은 무시되고 그 목록을 그대로 씁니다.
<RcmEditor toolbar={{ items: ['undo', 'redo', '|', 'bold', 'italic', 'image'] }} />;
```

`RcmToolbarConfig` 필드는 `preset`, `items`(주면 `preset` 무시, 내장 키·`'|'`·사용자 항목 `RcmToolbarEntry` 배열을 그대로 사용), `hide`(내장·사용자 키 제거), `overflow`, `start`/`end`(React 전용 앞뒤 슬롯)입니다. `overflow`는 `'menu'`(기본: 넘치는 항목을 "더 보기" 메뉴로)와 `'wrap'`(여러 줄로 감아 모두 표시) 중 하나입니다. 사용자 항목 `RcmToolbarCustomItem`은 `{ key, label, icon?, run?, isActive?, isDisabled?, render? }` 형태이며 바닐라에서는 `run` 기반 버튼만 씁니다. 기본 글꼴 목록은 `DEFAULT_FONTS`이며 `fonts` prop(`RcmFontOption[]`의 `{ label, value }`)으로 교체합니다.

## 라벨(i18n)

모든 UI 문자열은 `labels` prop에서 옵니다. 넘긴 키만 교체하고 나머지는 한국어 기본값이 유지되며, 빈 문자열은 무시됩니다. 기본값 전체는 `DEFAULT_EDITOR_LABELS`(`RcmEditorLabels` 타입)에 있습니다. 툴바 항목 키가 곧 버튼 라벨 키이며, 인쇄 미리보기(`<PrintPreview />`)는 별도 `RcmPrintPreviewLabels`를 씁니다.

```tsx
<RcmEditor labels={{ bold: '굵게', toolbar: '서식 도구 모음' }} />
```

## 테마

`styles.css`의 `--rcm-editor-*` CSS 변수를 소비자 CSS에서 덮어씁니다. 토큰 정의는 `src/styles/tokens.css`에 있습니다(배경·전경·강조·테두리·툴바·메뉴·찾기 강조·셀 선택 등). 다크 모드는 `[data-theme='dark']` 셀렉터로 같은 변수를 바꿉니다.

```css
.my-editor {
  --rcm-editor-color-accent: #0e7490;
  --rcm-editor-min-height: 320px;
}
```

편집 영역 최소 높이는 `minHeight` prop(숫자는 px, 같은 변수에 반영)으로도 정합니다.

## 에디터 인스턴스 접근

tiptap `Editor`가 필요하면 `onReady` prop을 쓰거나 ref(`RcmEditorHandle`)로 받습니다. 핸들은 `editor`(생성 전에는 `null`)와 대기 중인 `onChange`를 즉시 발송하는 `flush()`를 갖습니다. 그 밖의 prop(`editorProps`, `readonly`, `value`, `labels` 등)은 마운트 뒤 변경이 반영됩니다.

```tsx
import { useRef } from 'react';
import { RcmEditor } from '@rchemist/editor/react';
import type { RcmEditorHandle } from '@rchemist/editor/react';

const ref = useRef<RcmEditorHandle>(null);
<RcmEditor
  ref={ref}
  onReady={(editor) => editor.commands.focus()}
  editorProps={{ attributes: { 'data-testid': 'my-editor' } }}
/>;
```

바닐라(`@rchemist/editor/vanilla`의 `mountEditor`)는 `editor`, `getJSON()`, `getHTML()`, `setContent()`, `setReadonly()`, `update()`, `destroy()`를 돌려줍니다.

## htmlPolicy

HTML 입력 보안 정책은 `htmlPolicy` prop(`'sanitize' | 'trusted' | (html, ctx) => string`, 기본 `'sanitize'`)입니다. `'sanitize'`는 DOMPurify로 `script`·`on*` 속성·`javascript:` URL을 지우고, `iframe`은 `iframeHosts`(기본 YouTube·Vimeo, `DEFAULT_IFRAME_HOSTS`)의 https src만 남깁니다. 제거 내역은 `onContentReport`의 `ContentReport.policyRemoved`로 보고됩니다. `'trusted'`는 원문을 그대로 보존·저장하므로 신뢰할 수 있는 통합에서만 쓰고, 서버에서 다시 검증해야 합니다.

```tsx
<RcmEditor htmlPolicy="sanitize" iframeHosts={['www.youtube.com']} />
```

직접 검사만 필요하면 `applyHtmlPolicy(html, options)`(`@rchemist/editor`)를 씁니다.

## raw HTML 보존

스키마로 표현하지 못한다는 이유로 들어온 HTML이 조용히 사라지지 않습니다. 보존 규칙은 들어온 블록을 스키마 왕복과 비교해 동등하지 않으면 블록 전체를 `rawHtml` 노드(속성 `html`에 원문 outerHTML, 출력 자리표시자 속성은 `RAW_HTML_ATTR`)로 감싸고, `getLosslessHTML()`·`getLosslessJSON()`·인쇄 출력은 저장된 원문을 그대로 냅니다. 관련 심볼은 `@rchemist/editor`의 `preserveHtmlForLoad`, `expandRawHtmlPlaceholders`, `getLosslessHTML`, `getLosslessJSON`, `RAW_HTML`입니다. 레거시 `<pre><code class="language-html">` 감싸개는 `unwrapHtmlCodeBlocks()`로 풉니다(listgrid 어댑터가 기본 적용).
