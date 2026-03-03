export type ThemeMode = 'system' | 'light' | 'dark';

let currentMode: ThemeMode = 'system';
let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function setDarkClass(enabled: boolean) {
  document.documentElement.classList.toggle('dark', enabled);
}

function detachSystemListener() {
  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener('change', mediaListener);
  }
  mediaQuery = null;
  mediaListener = null;
}

export function applyTheme(mode: ThemeMode) {
  currentMode = mode;
  detachSystemListener();

  if (mode === 'dark') {
    setDarkClass(true);
    return;
  }
  if (mode === 'light') {
    setDarkClass(false);
    return;
  }

  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  setDarkClass(mediaQuery.matches);
  mediaListener = (e) => {
    if (currentMode !== 'system') return;
    setDarkClass(e.matches);
  };
  mediaQuery.addEventListener('change', mediaListener);
}

