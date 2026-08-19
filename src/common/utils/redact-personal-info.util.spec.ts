import { redactPersonalInfo } from './redact-personal-info.util';

describe('redactPersonalInfo()', () => {
  describe('phone numbers', () => {
    it('masks a plain digit phone number, keeping first 2 and last 2 digits', () => {
      const result = redactPersonalInfo('Call me on 9876543210');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toContain('98******10');
      expect(result.content).not.toContain('9876543210');
    });

    it('masks a phone number with spaces', () => {
      const result = redactPersonalInfo('Call me on 98765 43210');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toContain('98******10');
    });

    it('masks a phone number with hyphens', () => {
      const result = redactPersonalInfo('Call me on 98765-43210');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toContain('98******10');
    });

    it('masks a phone number with a country code', () => {
      const result = redactPersonalInfo('Reach me at +91 9876543210');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).not.toContain('9876543210');
    });

    it('masks a phone number with brackets around the country code', () => {
      const result = redactPersonalInfo('Reach me at (+91) 98765 43210');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).not.toContain('98765');
    });

    it('masks a phone number with mixed formatting', () => {
      const result = redactPersonalInfo('Reach me at 987-65-43210');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toContain('98******10');
    });

    it('masks a spelled-out phone number', () => {
      const result = redactPersonalInfo('nine eight seven six five four three two one zero');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toBe('98******10');
    });

    it('masks a spelled-out phone number with commas', () => {
      const result = redactPersonalInfo('nine eight seven, six five four, three two one zero');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).not.toMatch(/nine|eight|seven/);
    });

    it('masks digits separated one-by-one with spaces', () => {
      const result = redactPersonalInfo('9 8 7 6 5 4 3 2 1 0');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toContain('98******10');
    });

    it('leaves ordinary short numbers untouched (guest counts, years)', () => {
      const result = redactPersonalInfo('We expect around 50 guests in 2026');
      expect(result.wasRedacted).toBe(false);
      expect(result.content).toBe('We expect around 50 guests in 2026');
    });
  });

  describe('emails', () => {
    it('masks a standard email, keeping the first character of the local part', () => {
      const result = redactPersonalInfo('Reach me at john.doe@gmail.com');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toContain('j***@gmail.com');
      expect(result.content).not.toContain('john.doe');
    });

    it('masks an email with spaces around @ and .', () => {
      const result = redactPersonalInfo('Reach me at john.doe @ gmail . com');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toContain('j***@gmail.com');
    });

    it('masks an email using [at]/[dot] obfuscation', () => {
      const result = redactPersonalInfo('Reach me at john.doe[at]gmail[dot]com');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toContain('j***@gmail.com');
    });

    it('masks an email using textual "at"/"dot"', () => {
      const result = redactPersonalInfo('Reach me at john at gmail dot com');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toContain('j***@gmail.com');
    });
  });

  describe('IDs', () => {
    it('masks a plain alphanumeric ID', () => {
      const result = redactPersonalInfo('My ID is ABCD123456');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toContain('AB***456');
      expect(result.content).not.toContain('ABCD123456');
    });

    it('masks an ID with hyphens while preserving surrounding text', () => {
      const result = redactPersonalInfo('My ID is ABCD-1234-5678, please verify');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toContain('please verify');
      expect(result.content).not.toContain('1234-5678');
    });
  });

  describe('full message example from spec', () => {
    it('masks both a phone number and an email in the same message', () => {
      const result = redactPersonalInfo('You can call me at 98765 43210 or email me at john@gmail.com');
      expect(result.wasRedacted).toBe(true);
      expect(result.content).toBe('You can call me at 98******10 or email me at j***@gmail.com');
    });
  });

  it('leaves plain text with no sensitive info untouched', () => {
    const result = redactPersonalInfo('Looking forward to working together!');
    expect(result.wasRedacted).toBe(false);
    expect(result.content).toBe('Looking forward to working together!');
  });
});
