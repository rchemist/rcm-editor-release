const warned = new Set<string>();

export function isDevelopment(): boolean {
  // Bundlers statically replace `process.env.NODE_ENV`; in a browser without replacement
  // `process` is undefined and the access throws, which we treat as "not development".
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

/** `console.warn` once per page per code, development only. */
export function warnOnce(code: string, message: () => string): void {
  if (warned.has(code) || !isDevelopment()) return;
  warned.add(code);
  console.warn(message());
}

/** Test hook: re-arm every once-per-page warning. */
export function resetDevWarnings(): void {
  warned.clear();
}
