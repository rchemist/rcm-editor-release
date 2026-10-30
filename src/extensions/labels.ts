/** Replaces `{name}` placeholders in an injected label template. */
export function fillLabel(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
