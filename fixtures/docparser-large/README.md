# 대용량 합성 HWPX 전달 자료

최상위 블록은 실제 렌더 결과 기준 **600개**이다. revision은 `tiptap-0.1.1`, docparser 기준 커밋은 `147aae3`이다. `large.json`은 기본 tiptap 렌더러, `profile/large.json`은 같은 원본을 `tiptap_profile:"rcm-editor"`로 렌더한 결과다.

모든 문장·표·그림은 생성기가 만든 합성 자료이다. 실명·실제 기관·코퍼스 내용은 포함하지 않는다. PNG 10개는 16×12 픽셀의 결정적 색상 패턴이다. 표 20개에는 가로·세로 병합, 테두리, 배경색, 열 너비, 세로 정렬이 있다. 편·장·조 제목, 다양한 글자·문단 속성, 계층 글머리표 목록, 각주, 글상자, 수식도 포함한다.

HWPX 기본 렌더러는 계층 목록을 bulletList/listItem으로 바꾸지 않고 번호·기호와 들여쓰기가 있는 문단으로 보존한다. 원본에는 0~2 수준의 글머리표 속성이 있다. `large.json`은 그 기본 동작을 그대로 따르고, 프로필 렌더는 중첩 bulletList/listItem을 낸다. JSON을 수작업으로 편집하지 않았다.

## 파일

- `src/large.hwpx`: 결정적 ZIP 순서·타임스탬프를 쓰는 합성 OWPML 원본
- `large.json`: `{source, docparser_commit, render_revision, doc}`, 2칸 들여쓰기·끝 개행
- `profile/large.json`: 같은 형식, revision `<기본>+rcm-editor.<n>`
- `assets/<sha256>.png`: doc의 asset 참조 바이트
- `gen/`: 생성기·독립 Go 모듈. `synth.go`의 패키지·서식 작성기는 rcm-editor의 합성 생성 접근을 참조했다.

## 재생성

```sh
cd gen
go run . .. 147aae3
```

`gen/go.mod`의 replace는 docparser 체크아웃(`~/dev/docparser`)을 가리킨다. 렌더에는 1분 컨텍스트 기한과 명시적인 입력·출력·이미지 상한이 있고 외부 프로세스·네트워크·Docker를 사용하지 않는다. 메모리와 파일 외의 지속 자원은 만들지 않는다.

## 노드 수

| 노드 | 개수 |
|---|---:|
| `doc` | 1 |
| `equation` | 1 |
| `footnote` | 1 |
| `footnoteReference` | 1 |
| `footnotes` | 1 |
| `heading` | 106 |
| `image` | 10 |
| `paragraph` | 585 |
| `table` | 20 |
| `tableCell` | 80 |
| `tableHeader` | 40 |
| `tableRow` | 60 |
| `text` | 1222 |
| `textBox` | 1 |

## 마크 수

| 마크 | 개수 |
|---|---:|
| `bold` | 110 |
| `highlight` | 227 |
| `italic` | 110 |
| `strike` | 110 |
| `subscript` | 101 |
| `superscript` | 105 |
| `textStyle` | 458 |
| `underline` | 110 |

노드·마크 수는 기본 렌더(`large.json`) 기준이다.

## rcm-editor 반입

2026-10-29 docparser 세션 전달물을 반입한 뒤 rcm-editor가 이 생성기로 직접 재생성한다. 성능 측정·대형 왕복 게이트 전용이라 `fixtures/docparser/` 기본 세트와 분리.
