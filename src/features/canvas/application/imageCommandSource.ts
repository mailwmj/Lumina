/** Commands accept raw paths, file/data/HTTP URLs; normalize WebView asset URLs to raw paths. */
export function resolveImageCommandSource(source: string): string | null {
  const value = source.trim();
  if (!value || value.startsWith('__img_ref__:')) return null; // Canvas stores decoded assets, never imagePool references.
  if (/^asset:\/\//i.test(value) || /^https?:\/\/asset\.localhost\//i.test(value)) {
    try {
      const path = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, '/');
      return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path;
    } catch { return null; }
  }
  return value;
}
