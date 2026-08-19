// Blocks contact-info sharing in TriChat messages (email/phone) so hosts and brands stay on
// Meetday's platform instead of moving conversations off it. Applied only to HOST/BRAND
// messages — Admin/Meetday messages are exempt.

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Matches phone-number-shaped digit runs (7+ digits, optionally grouped with spaces/dashes/dots/
// parens) while ignoring short numeric mentions like "50 guests" or a year.
const PHONE_REGEX = /(?:\+?\d[\d\-.\s()]{5,}\d)/g;

export function redactPersonalInfo(text: string): { content: string; wasRedacted: boolean } {
  let wasRedacted = false;

  let content = text.replace(EMAIL_REGEX, () => {
    wasRedacted = true;
    return '[contact info removed]';
  });

  content = content.replace(PHONE_REGEX, (match) => {
    const digitCount = (match.match(/\d/g) ?? []).length;
    if (digitCount < 7) return match; // not enough digits to plausibly be a phone number
    wasRedacted = true;
    return '[contact info removed]';
  });

  return { content, wasRedacted };
}
