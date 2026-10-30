# tiptap 버전 맞추기

`@rchemist/editor`는 tiptap v3 위에서 동작합니다. tiptap 공식 패키지는 **서로 정확히 같은 버전**이어야 합니다. 이 문서는 그 이유와 확인·교정 방법을 설명합니다.

## 왜 같은 버전이어야 하나

- tiptap 공식 패키지는 서로를 정확한 버전으로 참조합니다. 예를 들어 `@tiptap/starter-kit@3.31.4`는 `@tiptap/core`·`@tiptap/pm`을 `3.31.4`로 고정한 **dependencies**로 갖고, `@tiptap/extension-*`는 `@tiptap/core`를 정확한 버전의 **peerDependencies**로 요구합니다.
- 버전이 하나라도 다르면 npm은 두 가지 중 하나로 반응합니다.
  - **설치 거부(ERESOLVE)**: 정확한 peer 요구가 충돌할 때(예: `@tiptap/extension-highlight@3.31.4`를 추가하면 `@tiptap/core@3.31.4`와 `@rchemist/editor`의 `^3.32.1` 요구가 충돌).
  - **사본 중복 설치**: 고정 dependencies는 하위 `node_modules`에 별도 사본으로 들어갑니다(예: `@tiptap/starter-kit@3.31.4`를 직접 설치하면 `node_modules/@tiptap/starter-kit/node_modules/@tiptap/core`가 생김).
- 사본이 둘이면 ProseMirror의 `instanceof` 판정(선택 영역, 플러그인, 스키마 노드)과 플러그인 키가 어긋나 명령이 조용히 실패하거나 에디터 생성이 오류로 끝날 수 있습니다.

`@rchemist/editor`는 `@tiptap/core`·`@tiptap/pm`·`@tiptap/react`를 `peerDependencies`(`^3.32.1`)로 두어 소비자 앱과 한 사본을 공유합니다. 빌드에 사용한 tiptap 버전은 `TIPTAP_VERSION`으로 노출됩니다.

```ts
import { TIPTAP_VERSION } from '@rchemist/editor';
console.log(TIPTAP_VERSION); // 예: "3.32.1"
```

## 확인 방법

```sh
npm ls @tiptap/pm @tiptap/core
```

각 패키지가 한 버전으로만 나오고 나머지 줄이 `deduped`이면 정상입니다. 다른 버전이 보이거나 하위 `node_modules` 경로가 따로 있으면 중복입니다. 설치 경로를 직접 세려면 다음을 씁니다.

```sh
npm ls @tiptap/pm --all --parseable | sort -u
```

개발 모드에서 `<RcmEditor>`는 다른 사본에서 만들어진 확장·ProseMirror 플러그인을 발견하면 콘솔에 `RCM_EDITOR_TIPTAP_DUPLICATE`로 시작하는 경고를 한 번 출력합니다. 프로덕션 빌드에서는 검사하지 않습니다. React 없이 쓰는 경우에는 `detectTiptapDuplicates(editor)`(또는 확장 배열)를 직접 호출해 결과 목록을 확인할 수 있습니다.

```ts
import { detectTiptapDuplicates } from '@rchemist/editor';
const findings = detectTiptapDuplicates(editor); // [] 이면 단일 사본
```

## 교정 방법

가장 좋은 방법은 앱의 모든 `@tiptap/*` 의존성을 `TIPTAP_VERSION`과 같은 버전으로 올리는 것입니다. 하위 패키지가 옛 버전을 고정하고 있어 그럴 수 없으면 패키지 관리자의 강제 해석 기능을 씁니다(아래 `3.32.1`은 `TIPTAP_VERSION`으로 바꿉니다).

### npm (`overrides`, npm 8.3+)

```json
{
  "overrides": {
    "@tiptap/core": "3.32.1",
    "@tiptap/pm": "3.32.1"
  }
}
```

앱이 직접 의존하는 패키지를 덮어쓸 때는 npm 규칙상 `dependencies`의 지정과 같아야 하므로 `"$@tiptap/core"`처럼 참조 문법을 쓰거나 `dependencies` 쪽 버전을 함께 맞춥니다. 수정 후 `node_modules`와 `package-lock.json`을 지우고 다시 설치합니다.

### pnpm (`pnpm.overrides`)

```json
{
  "pnpm": {
    "overrides": {
      "@tiptap/core": "3.32.1",
      "@tiptap/pm": "3.32.1"
    }
  }
}
```

### Yarn (`resolutions`)

```json
{
  "resolutions": {
    "@tiptap/core": "3.32.1",
    "@tiptap/pm": "3.32.1"
  }
}
```

## 업그레이드 원칙

- tiptap을 올릴 때는 `@tiptap/*`를 **한꺼번에** 같은 버전으로 올립니다(이 리포는 Renovate 그룹 규칙 `tiptap`으로 묶어 둡니다).
- `@rchemist/editor`를 올리면 `TIPTAP_VERSION`이 바뀔 수 있으니 앱의 `@tiptap/*` 버전과 `overrides`도 같이 확인합니다.
