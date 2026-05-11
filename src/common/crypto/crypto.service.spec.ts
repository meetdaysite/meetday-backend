import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const TEST_KEY = 'a'.repeat(64); // 32-byte AES-256 key as 64-char hex

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CryptoService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'crypto.encryptionKey' ? TEST_KEY : undefined,
            ),
          },
        },
      ],
    }).compile();

    service = module.get(CryptoService);
  });

  describe('encrypt / decrypt round-trip', () => {
    it('decrypts to the original plaintext', () => {
      const plaintext = 'ABCDE1234F';
      expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
    });

    it('handles empty string', () => {
      expect(service.decrypt(service.encrypt(''))).toBe('');
    });

    it('handles Unicode and special characters', () => {
      const value = 'ñoño 🔑 <script>';
      expect(service.decrypt(service.encrypt(value))).toBe(value);
    });
  });

  describe('encrypt', () => {
    it('produces different ciphertext on each call due to random IV', () => {
      const plaintext = 'ABCDE1234F';
      const c1 = service.encrypt(plaintext);
      const c2 = service.encrypt(plaintext);
      expect(c1).not.toBe(c2);
    });

    it('returns a colon-delimited iv:authTag:ciphertext string', () => {
      const parts = service.encrypt('test').split(':');
      expect(parts).toHaveLength(3);
      parts.forEach((p) => expect(p.length).toBeGreaterThan(0));
    });
  });

  describe('decrypt', () => {
    it('throws when the auth tag is tampered with', () => {
      const encrypted = service.encrypt('secret');
      const [iv, , ciphertext] = encrypted.split(':');
      const tampered = `${iv}:${Buffer.from('bad-tag').toString('base64')}:${ciphertext}`;
      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('throws when the ciphertext is tampered with', () => {
      const encrypted = service.encrypt('secret');
      const [iv, authTag] = encrypted.split(':');
      const tampered = `${iv}:${authTag}:${Buffer.from('tampered').toString('base64')}`;
      expect(() => service.decrypt(tampered)).toThrow();
    });
  });
});
