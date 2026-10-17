/** Public files live under the GitHub Pages base path in production. */
export function asset(path: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${path.replace(/^\//, '')}`
}

export const REPO = 'https://github.com/sderosiaux/blaze-gallery'
