# Upload server example

Example backends for the `@rchemist/editor` upload adapters. Plain Node (>= 20), no
dependencies, not part of the published package and not run in CI.

```sh
cd examples/upload-server
node server.mjs            # http://localhost:8787
```

## 1. Multipart receiver — `httpUploader`

`POST /upload` takes `multipart/form-data` with the file in field `file` and answers
`{ "url": "http://localhost:8787/files/<uuid>.png" }`. Files land in `./uploads`
(`UPLOAD_DIR`), the size limit is `MAX_BYTES` (20 MiB).

```tsx
import { httpUploader } from '@rchemist/editor/upload';

const uploadImage = httpUploader({
  endpoint: 'http://localhost:8787/upload',
  // fieldName: 'file',                       // default
  // getHeaders: () => ({ Authorization: `Bearer ${token()}` }),
  // withCredentials: true,                   // cookie sessions
  // mapResponse: (body) => `asset:sha256:${(body as { sha: string }).sha}`,
  maxBytes: 10 * 1024 * 1024,
  resize: { maxWidth: 1600, quality: 0.85 },   // optional canvas downscale
});

<RcmEditor uploadImage={uploadImage} />;
```

CORS: set `ALLOW_ORIGIN` to your app's origin (default `*` for local trials). A real backend
must also authenticate the request and check type/size again — the browser-side checks are
a convenience, not a security boundary.

## 2. MinIO / S3 presigned PUT — `presignedUploader`

`POST /presign` with `{ "name": "a.png", "type": "image/png" }` returns
`{ url, method: "PUT", headers, src }`. The server signs a SigV4 query-string URL with
credentials only **it** holds (`sigv4.mjs`, hand-written, Node built-ins, checked against
the AWS documentation vector). `@rchemist/editor` never receives a secret key and ships no
cloud SDK.

```sh
docker run --rm -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address ':9001'
# create the bucket "editor-assets" and allow anonymous read (public image URLs),
# then add a CORS rule for PUT from your app's origin.

S3_ACCESS_KEY=minioadmin S3_SECRET_KEY=minioadmin S3_BUCKET=editor-assets \
  node server.mjs
```

```tsx
import { presignedUploader } from '@rchemist/editor/upload';

const uploadImage = presignedUploader({
  presign: async (file) => {
    const res = await fetch('http://localhost:8787/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, type: file.type }),
    });
    return res.json(); // { url, method: 'PUT', headers, src }
  },
  maxBytes: 10 * 1024 * 1024,
});
```

For S3 POST policies return `{ url, method: 'POST', fields, src }` instead: the editor
sends the `fields` first and the file last, as S3 requires. For private buckets store an
`asset:` reference in `src` and resolve it for display with the `resolveAsset` prop (the
editor asks again once when a signed display URL fails to load).

Environment: `PORT`, `PUBLIC_URL`, `UPLOAD_DIR`, `MAX_BYTES`, `ALLOW_ORIGIN`, `S3_ENDPOINT`
(`http://localhost:9000`), `S3_BUCKET`, `S3_REGION` (`us-east-1`), `S3_ACCESS_KEY`,
`S3_SECRET_KEY`, `S3_PUBLIC_BASE`.
