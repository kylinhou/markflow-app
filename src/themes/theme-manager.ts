const themes: Record<string, string> = {
  light: 'theme-light',
  dark: 'theme-dark',
  elegant: 'theme-elegant',
  newsprint: 'theme-newsprint',
  paper: 'theme-paper'
}

let customStyleEl: HTMLStyleElement | null = null

export function applyTheme(name: string, customCSS?: string): void {
  const body = document.body

  // Remove all theme classes
  Object.values(themes).forEach(cls => body.classList.remove(cls))
  body.classList.remove('theme-custom')

  // Remove custom theme style
  if (customStyleEl) {
    customStyleEl.remove()
    customStyleEl = null
  }

  if (customCSS || name.startsWith('custom:')) {
    if (customCSS) {
      customStyleEl = document.createElement('style')
      customStyleEl.textContent = customCSS
      document.head.appendChild(customStyleEl)
    }
    body.classList.add('theme-custom')
  } else if (themes[name]) {
    body.classList.add(themes[name])
  }

  // Persist theme choice
  localStorage.setItem('markflow-theme', name)
}

export function loadSavedTheme(): string {
  return localStorage.getItem('markflow-theme') || 'elegant'
}

// ── Content Width ─────────────────────────────────────────────────────────────

const CONTENT_WIDTH_KEY = 'markflow-content-width'
const DEFAULT_CONTENT_WIDTH = 780
const MIN_CONTENT_WIDTH = 480
const MAX_CONTENT_WIDTH = 1400

/**
 * Apply a content width value (in px) to the CSS variable.
 * Does NOT persist — use setContentWidth() to both set and save.
 */
export function applyContentWidth(width: number): void {
  const clamped = Math.min(MAX_CONTENT_WIDTH, Math.max(MIN_CONTENT_WIDTH, width))
  document.documentElement.style.setProperty('--content-width', `${clamped}px`)
}

/** Save and apply content width, persisting to localStorage. */
export function setContentWidth(width: number): void {
  const clamped = Math.min(MAX_CONTENT_WIDTH, Math.max(MIN_CONTENT_WIDTH, width))
  localStorage.setItem(CONTENT_WIDTH_KEY, String(clamped))
  document.documentElement.style.setProperty('--content-width', `${clamped}px`)
}

/** Load the saved content width from localStorage, or the default. */
export function loadContentWidth(): number {
  const saved = localStorage.getItem(CONTENT_WIDTH_KEY)
  if (saved) {
    const n = parseInt(saved, 10)
    if (!isNaN(n) && n >= MIN_CONTENT_WIDTH && n <= MAX_CONTENT_WIDTH) return n
  }
  return DEFAULT_CONTENT_WIDTH
}

export { MIN_CONTENT_WIDTH, MAX_CONTENT_WIDTH }
