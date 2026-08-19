// Masks PII (phone numbers, emails, government/personal IDs) shared in TriChat messages instead
// of stripping it outright — keeps the message readable while hiding the sensitive portion, e.g.
// "9876543210" -> "98******10", "john.doe@gmail.com" -> "j***@gmail.com". Applied only to
// HOST/BRAND messages — Admin/Meetday messages are exempt.
//
// Detection is heuristic (regex-based), not true NLP entity recognition — it covers common
// formatting variations (spaces, hyphens, dots, brackets, country codes, spelled-out digits,
// "[at]"/"(at)"/"at" and "[dot]"/"(dot)"/"dot" email obfuscation) but can't catch every possible
// disguise, and the word-based email detection ("name at domain dot com") can occasionally
// over-match ordinary sentences that happen to contain "at ... dot" in sequence.

const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};
const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS).join('|');

// Digit-formatted phone numbers: spaces, hyphens, dots, parens, country codes (e.g. "+91 98765 43210").
const PHONE_REGEX = /\(?\+?\d[\d\s\-().]{5,}\d\)?/g;

// Spelled-out digit sequences: "nine eight seven six five four three two one zero" (7+ words).
const SPELLED_PHONE_REGEX = new RegExp(`\\b(?:(?:${NUMBER_WORD_PATTERN})[\\s,]+){6,}(?:${NUMBER_WORD_PATTERN})\\b`, 'gi');

// Emails via an actual symbol (@, [at], (at)) — checked first so a real "name@domain.com" is
// masked correctly before the looser word-based pass below ever sees it.
const EMAIL_SYMBOL_REGEX =
  /[a-zA-Z0-9._%+-]+\s*(?:@|\[at\]|\(at\))\s*[a-zA-Z0-9-]+(?:\s*(?:\.|\[dot\]|\(dot\))\s*[a-zA-Z0-9-]+)+/gi;

// Emails spelled out entirely in words ("name at domain dot com") — only run on whatever text is
// left after EMAIL_SYMBOL_REGEX, so it can't hijack a prefix of a real "...@domain" address.
const EMAIL_WORD_REGEX = /[a-zA-Z0-9._%+-]+\s+at\s+[a-zA-Z0-9-]+(?:\s+dot\s+[a-zA-Z0-9-]+)+/gi;

// Government/personal IDs: a short UPPERCASE letter prefix followed by digits, optionally
// separated by spaces/hyphens/dots (e.g. "ABCD123456", "ABCD-1234-5678"). Uppercase-only avoids
// matching ordinary lowercase words that happen to precede a number (e.g. "in 2026").
const ID_REGEX = /\b[A-Z]{2,6}[\s\-.]?\d[\d\s\-.]{2,12}\d\b/g;

function maskDigits(digits: string): string {
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return digits.slice(0, 2) + '*'.repeat(digits.length - 4) + digits.slice(-2);
}

function maskEmail(local: string, domain: string): string {
  const firstChar = local.charAt(0) || '*';
  return `${firstChar}***@${domain}`;
}

function maskId(alnum: string): string {
  if (alnum.length <= 5) return `${alnum.charAt(0)}***`;
  return `${alnum.slice(0, 2)}***${alnum.slice(-3)}`;
}

function normalizeAndMaskEmail(match: string): string {
  const normalized = match
    .replace(/\[at\]|\(at\)|\bat\b/gi, '@')
    .replace(/\[dot\]|\(dot\)|\bdot\b/gi, '.')
    .replace(/\s+/g, '');
  const atIndex = normalized.indexOf('@');
  if (atIndex <= 0) return match;
  return maskEmail(normalized.slice(0, atIndex), normalized.slice(atIndex + 1));
}

export function redactPersonalInfo(text: string): { content: string; wasRedacted: boolean } {
  let wasRedacted = false;
  let content = text;

  content = content.replace(EMAIL_SYMBOL_REGEX, (match) => {
    const masked = normalizeAndMaskEmail(match);
    if (masked !== match) wasRedacted = true;
    return masked;
  });

  content = content.replace(EMAIL_WORD_REGEX, (match) => {
    const masked = normalizeAndMaskEmail(match);
    if (masked !== match) wasRedacted = true;
    return masked;
  });

  // IDs before phone numbers — an ID's digit portion alone can otherwise look like a phone number.
  content = content.replace(ID_REGEX, (match) => {
    const alnum = match.replace(/[\s\-.]/g, '');
    const digitCount = (alnum.match(/\d/g) ?? []).length;
    if (alnum.length < 6 || alnum.length > 15 || digitCount < 4) return match;
    wasRedacted = true;
    return maskId(alnum);
  });

  content = content.replace(PHONE_REGEX, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return match;
    wasRedacted = true;
    return maskDigits(digits);
  });

  content = content.replace(SPELLED_PHONE_REGEX, (match) => {
    const digits = match
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((word) => NUMBER_WORDS[word] ?? '')
      .join('');
    if (digits.length < 7) return match;
    wasRedacted = true;
    return maskDigits(digits);
  });

  return { content, wasRedacted };
}
