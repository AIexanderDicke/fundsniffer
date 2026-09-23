const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** Structural check: two letters, nine alphanumerics, one check digit. */
export function hasIsinShape(value: string): boolean {
  return ISIN_PATTERN.test(value.toUpperCase());
}

/**
 * Full ISIN validation including the Luhn-style check digit.
 * Returns false for anything that is not a well-formed ISIN.
 */
export function isValidIsin(value: string): boolean {
  const isin = value.toUpperCase();
  if (!hasIsinShape(isin)) return false;

  const body = isin.slice(0, -1).replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));

  let sum = 0;
  let double = true;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    let digit = body.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }

  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === isin.charCodeAt(isin.length - 1) - 48;
}

export function normalizeIsin(value: string): string {
  return value.trim().toUpperCase();
}
