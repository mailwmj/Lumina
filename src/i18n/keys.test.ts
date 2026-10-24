import { describe, expect, it } from 'vitest';
import zh from './locales/zh.json';
import en from './locales/en.json';

const sources = import.meta.glob('../**/*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' });
const lookup = (locale: unknown, key: string) => key.split('.').reduce(
  (value: any, part) => value?.[part], locale,
);

describe('translation keys', () => {
  it.each([['zh', zh], ['en', en]])('defines every literal translation key in %s', (_, locale) => {
    const missing = new Set<string>();
    for (const [name, source] of Object.entries(sources)) {
      if (/\.test\./.test(name)) continue;
      for (const match of String(source).matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
        const key = match[1];
        if (lookup(locale, key) === undefined && lookup(locale, `${key}_other`) === undefined) missing.add(key);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
