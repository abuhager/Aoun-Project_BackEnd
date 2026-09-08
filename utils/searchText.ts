const ARABIC_DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

export const normalizeSearchText = (value: unknown): string => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('ar')
  .replace(ARABIC_DIACRITICS, '')
  .replace(/[إأآٱ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(NON_WORD, ' ')
  .trim()
  .replace(/\s+/g, ' ');

export const buildSearchTokens = (...values: unknown[]): string[] => {
  const tokens = normalizeSearchText(values.filter(Boolean).join(' '))
    .split(' ')
    .filter((token) => token.length >= 2)
    .slice(0, 80);
  return [...new Set(tokens)];
};

const MAX_PREFIX_LENGTH = 20;
const MAX_PREFIX_TOKENS = 240;

export const buildSearchPrefixes = (...values: unknown[]): string[] => {
  const prefixes = new Set<string>();

  for (const token of buildSearchTokens(...values)) {
    const prefixLimit = Math.min(token.length, MAX_PREFIX_LENGTH);
    for (let length = 2; length <= prefixLimit; length += 1) {
      prefixes.add(token.slice(0, length));
      if (prefixes.size >= MAX_PREFIX_TOKENS) return [...prefixes];
    }

    if (token.length > MAX_PREFIX_LENGTH) {
      prefixes.add(token);
      if (prefixes.size >= MAX_PREFIX_TOKENS) return [...prefixes];
    }
  }

  return [...prefixes];
};

export default { normalizeSearchText, buildSearchTokens, buildSearchPrefixes };
