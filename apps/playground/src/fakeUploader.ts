const DELAY_MS = 300;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function uploadImage(file: File): Promise<{ src: string }> {
  await sleep(DELAY_MS);
  return { src: URL.createObjectURL(file) };
}

export async function uploadFile(file: File): Promise<{ href: string; name: string }> {
  await sleep(DELAY_MS);
  return { href: URL.createObjectURL(file), name: file.name };
}
