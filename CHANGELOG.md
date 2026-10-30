# Changelog

이 파일은 `@rchemist/editor` 의 공개된 변경 이력을 기록합니다.

## [0.1.2] - 2026-10-30

### Fixed

- `RcmEditor`를 unmount하거나 `mountEditor().destroy()`를 호출할 때 이미지가 문서 src로 라이브 문서에 다시 그려지던 문제를 고쳤습니다. 이미지마다 `asset:` 요청 실패와 `net::ERR_UNKNOWN_URL_SCHEME` 콘솔 오류가 하나씩 나던 문제입니다(tiptap `EditorContent`가 unmount 때 노드뷰를 비우던 동작). destroy 전에 `setContent`로 문서를 비우는 우회는 더 이상 필요 없습니다.

## [0.1.1] - 2026-10-30

### Added

- 자산이 없는 이미지(`data-asset-state="missing"`)에 라벨(`그림 데이터 없음 · <sha 앞 8자>`)을 표시합니다. `features.image.missingAssetLabel`로 바꾸거나 빈 문자열로 끌 수 있고, 기본값은 `DEFAULT_MISSING_ASSET_LABEL`입니다.

### Fixed

- `getHTML()`(onChange·destroy 시 flush 포함)과 HTML 불러오기 검사가 이미지를 라이브 문서에서 만들지 않습니다. 브라우저가 `asset:` src를 불러오려다 `net::ERR_UNKNOWN_URL_SCHEME` 오류를 내던 문제를 고쳤습니다.
- 캡션 그림(`figure`)의 이미지를 선택한 채 글자를 입력하거나 Backspace·Delete·붙여넣기를 하면 키마다 빈 이미지(`src: null`)가 생기던 문제를 고쳤습니다. 이제 그림 전체가 바뀌거나 지워지고, 복사·끌기도 그림 전체를 대상으로 합니다.
- 자산이 없는 이미지가 보기 DOM에 원본 `asset:` src를 남기지 않습니다(이미지마다 콘솔 리소스 오류가 하나씩 나던 문제). 문서 JSON·HTML의 src는 그대로 유지됩니다.

## [0.1.0] - 2026-10-30

### Added

- 첫 공개 배포. tiptap v3 기반 React WYSIWYG 에디터 `RcmEditor`와 서브패스 `./react`·`./vanilla`·`./upload`·`./paste`·`./print`·`./listgrid`·`./docparser`·`./styles.css`.
- 표(병합·너비·테두리·셀 배경·세로 정렬), 이미지(크기·정렬·캡션·붙여넣기 업로드), 글꼴·pt 크기·색·줄간격, 정렬·들여쓰기·문단 간격, 목록, 찾기·바꾸기.
- Word·한글·웹 붙여넣기 정리, 쪽 나눔과 쪽 분할 미리보기, 서버 PDF 출력용 print HTML.
- 스키마 밖 HTML 보존(편집하지 않은 원본은 바이트 단위로 그대로 출력).
- `@rchemist/listgrid` 필드 슬롯 어댑터, docparser tiptap JSON 편집.
