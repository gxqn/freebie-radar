export type Theme = 'light' | 'dark';

export function normalizeTheme(value: unknown): Theme {
  return value === 'dark' ? 'dark' : 'light';
}

export function readTheme(storage: Pick<Storage, 'getItem'>): Theme {
  try {
    const value = storage.getItem('radar_theme');
    return normalizeTheme(value);
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme, root: { classList: Pick<DOMTokenList, 'toggle'> }): void {
  root.classList.toggle('dark', theme === 'dark');
}

export function saveTheme(theme: Theme, storage: Pick<Storage, 'setItem'>): void {
  try {
    storage.setItem('radar_theme', theme);
  } catch {}
}
