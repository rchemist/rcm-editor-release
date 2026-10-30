# 업로드 레시피

이미지 붙여넣기·끌어놓기·툴바 `image` 항목은 모두 같은 파이프라인을 거칩니다(정책 검증 → 선택적 축소 → 업로더 → 결과 `src`로 삽입). 이미지 이외 파일은 `uploadFile`이 있을 때만 링크로 삽입되고, 없으면 무시됩니다. 업로더 팩토리는 `@rchemist/editor/upload`에 있으며 프레임워크에 의존하지 않습니다. 아래 이름은 모두 패키지 소스에 있는 실제 심볼입니다. 동작하는 서버 예제는 `examples/upload-server/`(`node server.mjs`, `README.md`)에 있습니다.

공통 사항: 모든 팩토리는 `RcmUploader`(`(file, { signal, onProgress }) => Promise<string | RcmUploadResult>`)를 돌려주며 `UploadPolicy`(`accept`, `maxBytes`, `resize`)를 받습니다. `resize`(`UploadResize`: `maxWidth`·`maxHeight`·`quality`·`mimeType`)는 이미지만 캔버스로 축소·재인코딩하며 GIF·SVG는 건드리지 않습니다. 실패는 `RcmUploadError`(`code`: `'type' | 'size' | 'http' | 'network' | 'abort' | 'other'`)로 `onUploadError(error, file)` prop에 알리고, 문서는 바뀌지 않습니다.

## 1. 인라인 base64(서버 없음)

`uploadImage`를 주지 않으면 이 방식이 기본값입니다. `base64Uploader()`는 파일을 `data:` URL로 읽어 문서에 직접 넣습니다. 기본값은 `accept: ['image/*']`, `maxBytes: 2 MiB`(`DEFAULT_BASE64_MAX_BYTES`)이며, 문서에 URL이 통째로 들어가므로 작은 이미지에만 씁니다.

```tsx
import { base64Uploader } from '@rchemist/editor/upload';
import { RcmEditor } from '@rchemist/editor/react';

<RcmEditor uploadImage={base64Uploader({ maxBytes: 2 * 1024 * 1024 })} />;
```

## 2. 자체 서버 multipart POST

`httpUploader()`는 XHR multipart로 여러분의 백엔드에 올립니다(진행률·취소 지원). `endpoint`는 필수이며, 파일 필드는 `fieldName`(기본 `'file'`) 하나에 `fields`를 앞에 붙여 보냅니다. `headers`·`getHeaders(file)`·`withCredentials`로 인증을 붙이고, `mapResponse(body, xhr)`로 응답을 `src`(URL 또는 `asset:` 참조)나 `{ src, name }`(`RcmUploadResult`)에 매핑합니다. 기본 매핑은 JSON의 `url` 또는 `src`입니다.

```tsx
import { httpUploader } from '@rchemist/editor/upload';

const uploadImage = httpUploader({
  endpoint: 'https://example.com/upload',
  getHeaders: () => ({ Authorization: `Bearer ${token()}` }),
  mapResponse: (body) => (body as { url: string }).url,
  maxBytes: 10 * 1024 * 1024,
  resize: { maxWidth: 1600, quality: 0.85 },
});
<RcmEditor uploadImage={uploadImage} />;
```

예제 서버는 `POST /upload`(multipart, `file` 필드)에 `{ "url": "http://localhost:8787/files/<이름>" }`으로 답합니다. 브라우저 측 검사는 편의 기능이므로 서버에서도 타입·크기를 다시 검사해야 합니다.

## 3. Presigned URL(S3·R2·GCS·MinIO)

`presignedUploader()`는 서버가 서명한 URL로 직접 올립니다. 패키지는 자격증명·클라우드 SDK를 받지 않으며(`npm run check:no-cloud-sdk`로 검사), `presign(file)`(`PresignedUploaderOptions`)이 돌려준 `{ url, method, headers?, fields?, src }`(`PresignedTarget`)로 보냅니다. `method: 'PUT'`이면 본문에 파일을, `'POST'`이면 `fields` 뒤에 `file`을 마지막에 붙인 폼을 보냅니다. 성공하면 `src`(공개 URL 또는 `asset:` 참조)를 문서에 씁니다.

```tsx
import { presignedUploader } from '@rchemist/editor/upload';

const uploadImage = presignedUploader({
  presign: async (file) => {
    const res = await fetch('/presign', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, type: file.type }),
    });
    return res.json(); // { url, method: 'PUT', headers, src }
  },
});
<RcmEditor uploadImage={uploadImage} />;
```

예제 서버는 `POST /presign`(`{ name, type }`)에 SigV4 서명 URL을 답합니다(`sigv4.mjs`, 비밀키는 서버에만 있음).

## 4. 임의 함수에 정책 씌우기

직접 쓴 함수에 검증·축소만 빌리려면 `withPolicy(fn, policy)`로 감쌉니다. prop으로 준 함수에는 정책이 자동으로 걸리지 않으므로 필요하면 감싸서 씁니다.

```tsx
import { withPolicy } from '@rchemist/editor/upload';

const uploadImage = withPolicy(async (file) => ({ src: await myBackend.put(file) }), {
  accept: ['image/*'],
  maxBytes: 5 * 1024 * 1024,
});
<RcmEditor uploadImage={uploadImage} onUploadError={(e) => console.error(e.code, e.message)} />;
```

## 5. listgrid 어댑터

`createListgridEditor(options)`(`@rchemist/editor/listgrid`)의 옵션은 listgrid가 운전하는 값(`value`·`defaultValue`·`onChange`·`readonly`)을 뺀 나머지 `RcmEditor` prop이므로, 업로드 prop을 그대로 넘기면 어댑터 안에서 같은 파이프라인이 동작합니다.

```tsx
import { createListgridEditor } from '@rchemist/editor/listgrid';
import { httpUploader } from '@rchemist/editor/upload';

const MarkdownEditor = createListgridEditor({
  uploadImage: httpUploader({ endpoint: 'https://example.com/upload' }),
});
```

## 참고: 파일 업로드와 대기

- `uploadFile` prop이 있으면 이미지 이외 파일을 같은 파이프라인으로 올려 링크 텍스트(`RcmUploadResult.name`, 기본 파일명)로 삽입합니다. 툴바 `file` 항목도 이 prop이 있을 때만 렌더됩니다.
- 헤드리스·바닐라에서는 `editor.commands.uploadFiles(files, { at? })`로 직접 올리고, 시작한 업로드가 모두 끝나길 기다리려면 `await editor.storage.upload.whenSettled()`를 씁니다.
