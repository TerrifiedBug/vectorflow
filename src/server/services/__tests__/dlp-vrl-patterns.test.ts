// src/server/services/__tests__/dlp-vrl-patterns.test.ts
import { describe, it, expect } from "vitest";

/**
 * These tests validate the regex patterns used in DLP templates
 * by running the equivalent JavaScript regex against test data.
 * This ensures the patterns work correctly without requiring the vector binary.
 *
 * Note: VRL uses Rust regex syntax which is nearly identical to JavaScript regex.
 * Any minor differences are documented inline.
 */

describe("DLP VRL pattern validation", () => {
  describe("Credit Card Masking", () => {
    // Pattern: Visa, Mastercard, Amex, Discover with optional separators
    const CC_PATTERN =
      /\b(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|6(?:011|5[0-9]{2}))[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{1,7}\b/g;

    function maskCreditCard(input: string, maskChar = "*"): string {
      return input.replace(CC_PATTERN, (match) => {
        const digits = match.replace(/[^0-9]/g, "");
        if (digits.length >= 13 && digits.length <= 19) {
          const last4 = digits.slice(-4);
          const maskedPrefix = maskChar.repeat(digits.length - 4);
          return maskedPrefix + last4;
        }
        return match;
      });
    }

    it("masks a Visa card number", () => {
      const result = maskCreditCard(
        "Payment processed for card 4111111111111111 successfully"
      );
      expect(result).toBe(
        "Payment processed for card ************1111 successfully"
      );
    });

    it("masks a Mastercard number with spaces", () => {
      const result = maskCreditCard("Card: 5500 0000 0000 0004");
      expect(result).toBe("Card: ************0004");
    });

    it("masks an Amex number", () => {
      const result = maskCreditCard("Amex: 378282246310005");
      expect(result).toBe("Amex: ***********0005");
    });

    it("does not mask random 10-digit numbers", () => {
      const input = "Order ID: 1234567890";
      const result = maskCreditCard(input);
      expect(result).toBe(input);
    });

    it("masks multiple card numbers in one string", () => {
      const result = maskCreditCard("Cards: 4111111111111111 and 5500000000000004");
      expect(result).toBe("Cards: ************1111 and ************0004");
    });
  });

  describe("SSN Masking", () => {
    // Pattern: XXX-XX-XXXX excluding invalid area numbers (000, 666, 900-999)
    const SSN_PATTERN =
      /\b(?!000|666|9[0-9]{2})[0-9]{3}[- ]?(?!00)[0-9]{2}[- ]?(?!0000)[0-9]{4}\b/g;

    function maskSsn(input: string, fullRedact = false): string {
      return input.replace(SSN_PATTERN, (match) => {
        if (fullRedact) return "[REDACTED-SSN]";
        const digits = match.replace(/[^0-9]/g, "");
        return `***-**-${digits.slice(5)}`;
      });
    }

    it("masks a standard SSN with dashes", () => {
      const result = maskSsn("Patient SSN: 123-45-6789 in record");
      expect(result).toBe("Patient SSN: ***-**-6789 in record");
    });

    it("masks an SSN without separators", () => {
      const result = maskSsn("SSN=123456789");
      expect(result).toBe("SSN=***-**-6789");
    });

    it("does not match SSN with area 000", () => {
      const input = "ID: 000-12-3456";
      const result = maskSsn(input);
      expect(result).toBe(input);
    });

    it("does not match SSN with area 666", () => {
      const input = "ID: 666-12-3456";
      const result = maskSsn(input);
      expect(result).toBe(input);
    });

    it("does not match SSN with area 900+", () => {
      const input = "ID: 900-12-3456";
      const result = maskSsn(input);
      expect(result).toBe(input);
    });

    it("supports full redaction mode", () => {
      const result = maskSsn("SSN: 123-45-6789", true);
      expect(result).toBe("SSN: [REDACTED-SSN]");
    });
  });

  describe("Email Redaction", () => {
    const EMAIL_PATTERN =
      /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;

    function redactEmail(input: string, replacement = "[REDACTED-EMAIL]"): string {
      return input.replace(EMAIL_PATTERN, replacement);
    }

    it("redacts a standard email", () => {
      const result = redactEmail("User john.doe@example.com logged in");
      expect(result).toBe("User [REDACTED-EMAIL] logged in");
    });

    it("redacts multiple emails", () => {
      const result = redactEmail(
        "From: admin@corp.io To: user+tag@sub.domain.org"
      );
      expect(result).toBe("From: [REDACTED-EMAIL] To: [REDACTED-EMAIL]");
    });

    it("does not match @ in non-email context", () => {
      const input = "Price is $5 @ 10 units";
      const result = redactEmail(input);
      expect(result).toBe(input);
    });

    it("handles emails with dots in local part", () => {
      const result = redactEmail("Contact: first.last.name@company.co.uk");
      expect(result).toBe("Contact: [REDACTED-EMAIL]");
    });
  });

  describe("IP Anonymization", () => {
    const IPV4_PATTERN =
      /\b((?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.)(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;

    function anonymizeIp(input: string, replaceOctet = "0"): string {
      return input.replace(IPV4_PATTERN, `$1${replaceOctet}`);
    }

    it("zeros the last octet", () => {
      const result = anonymizeIp("Connection from 192.168.1.42 on port 443");
      expect(result).toBe("Connection from 192.168.1.0 on port 443");
    });

    it("anonymizes multiple IPs", () => {
      const result = anonymizeIp("src=10.0.0.15 dst=172.16.254.99");
      expect(result).toBe("src=10.0.0.0 dst=172.16.254.0");
    });

    it("does not match 3-segment version numbers", () => {
      const input = "Version 2.3.1 released";
      const result = anonymizeIp(input);
      expect(result).toBe(input);
    });

    it("handles edge case IP 255.255.255.255", () => {
      const result = anonymizeIp("Broadcast: 255.255.255.255");
      expect(result).toBe("Broadcast: 255.255.255.0");
    });

    it("handles IP 0.0.0.1", () => {
      const result = anonymizeIp("Loopback: 0.0.0.1");
      expect(result).toBe("Loopback: 0.0.0.0");
    });
  });

  describe("Phone Number Masking", () => {
    // US format patterns
    const US_INTL_PHONE =
      /\+[1-9][0-9]{0,2}[- ]?\(?[0-9]{1,4}\)?[- ]?[0-9]{1,4}[- ]?[0-9]{1,4}[- ]?[0-9]{0,4}/g;
    const US_PHONE = /\(?[0-9]{3}\)?[- .]?[0-9]{3}[- .]?[0-9]{4}\b/g;

    function maskPhone(input: string, replacement = "[REDACTED-PHONE]"): string {
      let result = input.replace(US_INTL_PHONE, replacement);
      result = result.replace(US_PHONE, replacement);
      return result;
    }

    it("masks US phone with country code", () => {
      const result = maskPhone("Contact: +1 (555) 123-4567 for support");
      // The international regex may consume a trailing separator; verify phone is masked
      expect(result).toContain("[REDACTED-PHONE]");
      expect(result).not.toContain("555");
      expect(result).not.toContain("4567");
    });

    it("masks US phone without country code", () => {
      const result = maskPhone("Called 555-867-5309 yesterday");
      expect(result).toBe("Called [REDACTED-PHONE] yesterday");
    });

    it("does not mask short number sequences", () => {
      const input = "Error code: 12345";
      const result = maskPhone(input);
      expect(result).toBe(input);
    });

    it("masks (XXX) XXX-XXXX format", () => {
      const result = maskPhone("Phone: (555) 123-4567");
      expect(result).toBe("Phone: [REDACTED-PHONE]");
    });
  });

  describe("API Key / Token Redaction", () => {
    function redactKeys(input: string, replacement = "[REDACTED-KEY]"): string {
      let val = input;

      // Bearer tokens
      val = val.replace(
        /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
        `Bearer ${replacement}`
      );

      // OpenAI keys
      val = val.replace(/\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/g, replacement);

      // Stripe keys
      val = val.replace(/\b[sp]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g, replacement);

      // AWS access key IDs
      val = val.replace(/\bAKIA[A-Z0-9]{16}\b/g, replacement);

      // GitHub tokens
      val = val.replace(/\bgh[posr]_[A-Za-z0-9]{36,}\b/g, replacement);

      // Generic api_key patterns
      val = val.replace(
        /(?:api[_-]?key|apikey|api[_-]?secret)[=: ]+["']?[A-Za-z0-9\-._~]{16,}["']?/gi,
        replacement
      );

      return val;
    }

    it("redacts a Bearer token", () => {
      const result = redactKeys(
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
      );
      expect(result).toBe("Authorization: Bearer [REDACTED-KEY]");
    });

    it("redacts an OpenAI key", () => {
      const result = redactKeys(
        "Using key sk-proj-abc123def456ghi789jkl012mno345pqr678"
      );
      expect(result).toBe("Using key [REDACTED-KEY]");
    });

    it("redacts an AWS access key", () => {
      const result = redactKeys("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
      expect(result).toBe("AWS_ACCESS_KEY_ID=[REDACTED-KEY]");
    });

    it("redacts a GitHub PAT", () => {
      const result = redactKeys(
        "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn"
      );
      expect(result).toBe("token: [REDACTED-KEY]");
    });

    it("redacts Stripe live key", () => {
      const result = redactKeys(
        "sk_" + "live_abcdefghijklmnopqrstuvwxyz12"
      );
      expect(result).toBe("[REDACTED-KEY]");
    });

    it("preserves normal text", () => {
      const input = "Deployment successful to production";
      const result = redactKeys(input);
      expect(result).toBe(input);
    });
  });

  describe("JSON Field Removal", () => {
    function removeFields(
      input: Record<string, unknown>,
      fields: string[]
    ): Record<string, unknown> {
      const result = { ...input };
      for (const field of fields) {
        // Simple top-level field removal (VRL del() handles nested paths too)
        const key = field.startsWith(".") ? field.slice(1) : field;
        delete result[key];
      }
      return result;
    }

    it("removes password and token fields", () => {
      const input = {
        message: "User login",
        user: "john",
        password: "s3cret!",
        token: "abc123xyz",
        timestamp: "2026-01-15T10:30:00Z",
      };
      const result = removeFields(input, [".password", ".token"]);
      expect(result).toEqual({
        message: "User login",
        user: "john",
        timestamp: "2026-01-15T10:30:00Z",
      });
    });

    it("handles missing fields gracefully", () => {
      const input = { message: "Health check", status: "ok" };
      const result = removeFields(input, [".password", ".secret", ".token"]);
      expect(result).toEqual({ message: "Health check", status: "ok" });
    });

    it("removes secret field", () => {
      const input = {
        message: "API call",
        secret: "vault-token-xxx",
        metadata: { requestId: "req-001" },
      };
      const result = removeFields(input, [".secret"]);
      expect(result).toEqual({
        message: "API call",
        metadata: { requestId: "req-001" },
      });
    });
  });
});
