/**
 * Component labels. Injected labels override per key; every UI string of the component comes
 * from here (toolbar item keys double as the labels of the toolbar buttons).
 */
export interface RcmEditorLabels {
  /** Accessible name of the editing area (`aria-label` of the textbox). */
  editorArea: string;
  /** Accessible name of the toolbar. */
  toolbar: string;
  /** Overflow ("more") button. */
  more: string;

  // toolbar items (one per `RcmToolbarItemKey`)
  undo: string;
  redo: string;
  /** Toolbar `heading` item (the paragraph-style menu). */
  heading: string;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  bold: string;
  italic: string;
  underline: string;
  strike: string;
  /** Toolbar `code` item (inline code). */
  code: string;
  superscript: string;
  subscript: string;
  color: string;
  highlight: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  alignJustify: string;
  indent: string;
  outdent: string;
  bulletList: string;
  orderedList: string;
  /** Toolbar `taskList` item (checklist). */
  taskList: string;
  blockquote: string;
  /** Toolbar `codeBlock` item. */
  codeBlock: string;
  horizontalRule: string;
  link: string;
  clearFormat: string;
  table: string;
  /** Toolbar `image` item (opens the file chooser). */
  image: string;
  /** Toolbar `file` item (opens the file chooser for non-image files). */
  file: string;
  /** Toolbar `youtube` item (the URL popover). */
  youtube: string;
  /** Toolbar `source` item: toggles the HTML source mode. */
  source: string;

  // inside menus and popovers
  /** "No font set" entry of the font menu. */
  fontDefault: string;
  /** "No line spacing set" entry of the line spacing menu. */
  lineHeightDefault: string;
  /** "Paragraph" entry of the paragraph-style (`heading`) menu. */
  paragraph: string;
  /** Heading level entries of the paragraph-style (`heading`) menu. */
  heading1: string;
  heading2: string;
  heading3: string;
  /** Custom colour input. */
  customColor: string;
  /** Remove the colour. */
  removeColor: string;
  /** Link address input. */
  linkUrl: string;
  linkApply: string;
  linkRemove: string;
  /** YouTube address input of the `youtube` popover. */
  youtubeUrl: string;
  youtubeApply: string;
  /** Accessible name of the table size grid. */
  tableGrid: string;

  // upload placeholder / error widgets
  /** Placeholder shown while a file uploads. */
  uploading: string;
  uploadFailed: string;
  uploadRetry: string;
  uploadDismiss: string;

  // table cell context menu
  tableMenu: string;
  tmAddRowBefore: string;
  tmAddRowAfter: string;
  tmAddColumnBefore: string;
  tmAddColumnAfter: string;
  tmDeleteRow: string;
  tmDeleteColumn: string;
  tmMergeCells: string;
  tmSplitCell: string;
  tmToggleHeaderRow: string;
  tmToggleHeaderColumn: string;
  tmCellBackground: string;
  tmCellBorder: string;
  tmVerticalAlign: string;
  tmTableWidthFit: string;
  tmTableWidthFull: string;
  tmDeleteTable: string;
  tmClearBackground: string;
  tmBorderAll: string;
  tmBorderNone: string;
  tmBorderTop: string;
  tmBorderRight: string;
  tmBorderBottom: string;
  tmBorderLeft: string;
  tmAlignTop: string;
  tmAlignMiddle: string;
  tmAlignBottom: string;

  // find & replace panel
  /** Toolbar `find` item and accessible name of the panel (`role="search"`). */
  find: string;
  findInput: string;
  /** Case-sensitivity toggle of the panel. */
  findCase: string;
  findPrev: string;
  findNext: string;
  findReplaceInput: string;
  findReplace: string;
  findReplaceAll: string;
  findClose: string;
  /** Result count phrase; `{current}`/`{total}` are replaced with the numbers. */
  findCount: string;

  // image bar
  /** Accessible name of the floating image toolbar (`role="toolbar"`). */
  imageBar: string;
  ibAlignLeft: string;
  ibAlignCenter: string;
  ibAlignRight: string;
  /** "Inline" alignment: the image flows with the text line. */
  ibAlignInline: string;
  /** Caption toggle (block images only). */
  ibCaption: string;
  /** Alt-text button and popover input. */
  ibAlt: string;
  ibAltApply: string;
  /** Accessible name of every resize handle (corners differ by `data-corner`). */
  ibResizeHandle: string;

  // HTML source mode & preservation notice
  /** Accessible name of the CodeMirror source editor. */
  sourceEditor: string;
  /** HTML notice after a source apply (raw fragments / policy removals). */
  htmlNotice: string;
  htmlNoticeClose: string;
  /** Item prefix for a fragment kept verbatim as `rawHtml`. */
  htmlNoticeRaw: string;
  /** Item prefix for content the policy removed. */
  htmlNoticeRemoved: string;
  /** Raw-fragment editor popover of a `rawHtml` node. */
  rawEditor: string;
  rawApply: string;
  /** Explicit "convert to editable" action (accepts the reported loss). */
  rawConvert: string;
  rawCancel: string;
}

export const DEFAULT_EDITOR_LABELS: RcmEditorLabels = {
  editorArea: '본문 편집기',
  toolbar: '서식 도구',
  more: '더 보기',
  undo: '실행 취소',
  redo: '다시 실행',
  heading: '문단 스타일',
  fontFamily: '글꼴',
  fontSize: '글자 크기',
  lineHeight: '줄 간격',
  bold: '굵게',
  italic: '기울임',
  underline: '밑줄',
  strike: '취소선',
  code: '인라인 코드',
  superscript: '위 첨자',
  subscript: '아래 첨자',
  color: '글자색',
  highlight: '배경색',
  alignLeft: '왼쪽 정렬',
  alignCenter: '가운데 정렬',
  alignRight: '오른쪽 정렬',
  alignJustify: '양쪽 정렬',
  indent: '들여쓰기',
  outdent: '내어쓰기',
  bulletList: '글머리 기호 목록',
  orderedList: '번호 목록',
  taskList: '체크리스트',
  blockquote: '인용',
  codeBlock: '코드 블록',
  horizontalRule: '구분선',
  link: '링크',
  clearFormat: '서식 지우기',
  table: '표 삽입',
  image: '이미지',
  file: '파일 첨부',
  youtube: 'YouTube',
  find: '찾기',
  findInput: '찾을 내용',
  findCase: '대소문자 구분',
  findPrev: '이전 결과',
  findNext: '다음 결과',
  findReplaceInput: '바꿀 내용',
  findReplace: '바꾸기',
  findReplaceAll: '모두 바꾸기',
  findClose: '찾기 닫기',
  findCount: '결과 {current} / {total}',
  uploading: '업로드 중',
  uploadFailed: '업로드 실패',
  uploadRetry: '다시 시도',
  uploadDismiss: '닫기',
  fontDefault: '기본',
  lineHeightDefault: '기본',
  paragraph: '본문',
  heading1: '제목 1',
  heading2: '제목 2',
  heading3: '제목 3',
  customColor: '사용자 색',
  removeColor: '색 지우기',
  linkUrl: '링크 주소',
  linkApply: '적용',
  linkRemove: '링크 제거',
  youtubeUrl: 'YouTube 주소',
  youtubeApply: '적용',
  tableGrid: '표 크기 선택',
  tableMenu: '표 편집',
  tmAddRowBefore: '위에 행 추가',
  tmAddRowAfter: '아래에 행 추가',
  tmAddColumnBefore: '왼쪽에 열 추가',
  tmAddColumnAfter: '오른쪽에 열 추가',
  tmDeleteRow: '행 삭제',
  tmDeleteColumn: '열 삭제',
  tmMergeCells: '셀 병합',
  tmSplitCell: '셀 분할',
  tmToggleHeaderRow: '머리글 행 전환',
  tmToggleHeaderColumn: '머리글 열 전환',
  tmCellBackground: '셀 배경색',
  tmCellBorder: '셀 테두리',
  tmVerticalAlign: '세로 정렬',
  tmTableWidthFit: '표 너비 맞춤',
  tmTableWidthFull: '표 너비 100%',
  tmDeleteTable: '표 삭제',
  tmClearBackground: '배경색 지우기',
  tmBorderAll: '전체 테두리',
  tmBorderNone: '테두리 없음',
  tmBorderTop: '위쪽 테두리',
  tmBorderRight: '오른쪽 테두리',
  tmBorderBottom: '아래쪽 테두리',
  tmBorderLeft: '왼쪽 테두리',
  tmAlignTop: '위쪽 맞춤',
  tmAlignMiddle: '가운데 맞춤',
  tmAlignBottom: '아래쪽 맞춤',
  imageBar: '이미지 편집',
  ibAlignLeft: '왼쪽 정렬',
  ibAlignCenter: '가운데 정렬',
  ibAlignRight: '오른쪽 정렬',
  ibAlignInline: '글줄에 표시',
  ibCaption: '캡션',
  ibAlt: '대체 텍스트',
  ibAltApply: '적용',
  ibResizeHandle: '이미지 크기 조절',
  source: 'HTML 소스',
  sourceEditor: 'HTML 소스 편집기',
  htmlNotice: 'HTML 보존 알림',
  htmlNoticeClose: '알림 닫기',
  htmlNoticeRaw: '원문 그대로 보존한 조각',
  htmlNoticeRemoved: '정책이 제거한 항목',
  rawEditor: 'HTML 조각 편집',
  rawApply: '적용',
  rawConvert: '편집 가능한 내용으로 변환',
  rawCancel: '닫기',
};

/** Defaults with the non-empty injected labels on top. */
export function resolveLabels(labels: Partial<RcmEditorLabels> | undefined): RcmEditorLabels {
  const out = { ...DEFAULT_EDITOR_LABELS };
  if (!labels) return out;
  for (const key of Object.keys(out) as (keyof RcmEditorLabels)[]) {
    const value = labels[key];
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}
