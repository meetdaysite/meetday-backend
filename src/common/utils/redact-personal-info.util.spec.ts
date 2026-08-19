import { redactPersonalInfo } from './redact-personal-info.util';

describe('redactPersonalInfo()', () => {
  it('redacts an email address', () => {
    const result = redactPersonalInfo('Reach me at hello@example.com for details');
    expect(result.wasRedacted).toBe(true);
    expect(result.content).not.toContain('hello@example.com');
    expect(result.content).toContain('[contact info removed]');
  });

  it('redacts a phone number', () => {
    const result = redactPersonalInfo('Call me on +91 98765 43210 anytime');
    expect(result.wasRedacted).toBe(true);
    expect(result.content).not.toContain('98765');
  });

  it('leaves ordinary short numbers untouched (e.g. guest counts, years)', () => {
    const result = redactPersonalInfo('We expect around 50 guests in 2026');
    expect(result.wasRedacted).toBe(false);
    expect(result.content).toBe('We expect around 50 guests in 2026');
  });

  it('leaves plain text untouched', () => {
    const result = redactPersonalInfo('Looking forward to working together!');
    expect(result.wasRedacted).toBe(false);
    expect(result.content).toBe('Looking forward to working together!');
  });
});
