/**
 * Password Validation Module
 *
 * Provides security-focused password validation to prevent:
 * - XSS attacks (script tags, event handlers, javascript: protocol)
 * - SQL injection (OR/AND patterns, SQL commands, comment sequences)
 * - Weak passwords (common passwords, insufficient complexity)
 */

// Top 100 most common passwords to block
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '123456789', '12345678',
  '12345', '1234567', '1234567890', 'qwerty', 'qwerty123', 'abc123',
  'monkey', 'letmein', 'dragon', 'master', 'login', 'admin', 'welcome',
  'shadow', 'sunshine', 'princess', 'michael', 'football', 'baseball',
  'iloveyou', 'trustno1', 'hello', 'charlie', 'donald', 'passw0rd',
  'qazwsx', 'ninja', 'mustang', 'access', 'solo', 'batman', 'whatever',
  'superman', 'ashley', 'bailey', 'buster', 'tigger', 'soccer', 'harley',
  'ranger', 'jordan', 'hunter', 'jennifer', 'thomas', 'pepper', 'ginger',
  'joshua', 'maggie', 'jessica', 'andrew', 'michelle', 'amanda', 'nicole',
  'summer', 'chelsea', 'biteme', 'matthew', 'access14', 'yankees', 'dallas',
  'austin', 'thunder', 'taylor', 'matrix', 'minemine', 'hannah', 'corvette',
  'blahblah', 'secret', 'fuckyou', 'asshole', 'computer', 'cheese',
  'starwars', 'silver', 'cookie', 'george', 'asdfgh', 'zxcvbn', 'qwertyuiop',
  '121212', '696969', '666666', '111111', '654321', 'football1', 'baseball1',
  'mercedes', 'chicken', 'internet', 'killer', 'boomer', 'flower', 'freedom',
  'compaq', 'samantha', 'jasmine', 'brandon', 'daniel', 'robert', 'anthony',
]);

// XSS attack patterns
const XSS_PATTERNS = [
  /<script\b/i,
  /<\/script>/i,
  /javascript:/i,
  /on\w+\s*=/i,        // Event handlers: onclick=, onerror=, etc.
  /<img\b/i,
  /<iframe\b/i,
  /<embed\b/i,
  /<object\b/i,
  /<svg\b/i,
  /<math\b/i,
  /<link\b/i,
  /<style\b/i,
  /data:/i,            // Data URIs
  /vbscript:/i,
  /expression\s*\(/i,  // CSS expression()
];

// SQL injection patterns
const SQL_INJECTION_PATTERNS = [
  /'\s*or\s*'?\d*\s*=\s*'?\d*/i,     // ' OR '1'='1
  /'\s*or\s+'[^']+'\s*=\s*'[^']+'/i, // ' OR 'x'='x
  /'\s*and\s*'?\d*\s*=\s*'?\d*/i,    // ' AND '1'='1
  /;\s*drop\s+/i,                     // ; DROP
  /;\s*delete\s+/i,                   // ; DELETE
  /;\s*insert\s+/i,                   // ; INSERT
  /;\s*update\s+/i,                   // ; UPDATE
  /;\s*select\s+/i,                   // ; SELECT
  /--\s*$/,                           // SQL comment at end
  /\/\*.*\*\//,                       // SQL block comment
  /union\s+select/i,                  // UNION SELECT
  /exec\s*\(/i,                       // EXEC()
  /xp_cmdshell/i,                     // xp_cmdshell
];

export type PasswordStrength = 'weak' | 'medium' | 'strong';

export interface PasswordRequirements {
  minLength: boolean;
  maxLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
}

export interface PasswordValidationResult {
  isValid: boolean;
  strength: PasswordStrength | null;
  requirements: PasswordRequirements;
  errors: string[];
  hasDangerousPatterns: boolean;
  isCommonPassword: boolean;
}

/**
 * Sanitizes password by removing control characters and null bytes
 */
export function sanitizePassword(password: string): string {
  // Remove null bytes
  let sanitized = password.replace(/\0/g, '');
  // Remove control characters (ASCII 0-31 except tab, newline, carriage return)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return sanitized;
}

/**
 * Checks if password contains dangerous XSS or SQL injection patterns
 */
export function containsDangerousPatterns(password: string): boolean {
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(password)) {
      return true;
    }
  }
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(password)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if password is in the common passwords list
 */
export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

/**
 * Checks password against strength requirements
 */
export function checkRequirements(password: string): PasswordRequirements {
  return {
    minLength: password.length >= 8,
    maxLength: password.length <= 128,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password),
  };
}

/**
 * Calculates password strength based on requirements met
 */
export function calculateStrength(requirements: PasswordRequirements, password: string): PasswordStrength {
  const reqsMet = Object.values(requirements).filter(Boolean).length;
  const length = password.length;

  // Must meet basic requirements for anything above weak
  if (!requirements.minLength || !requirements.maxLength) {
    return 'weak';
  }

  // Calculate score based on requirements and length
  let score = reqsMet;

  // Bonus for length
  if (length >= 12) score += 1;
  if (length >= 16) score += 1;

  // Bonus for variety of special characters
  const specialChars = password.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/g) || [];
  const uniqueSpecials = new Set(specialChars).size;
  if (uniqueSpecials >= 2) score += 1;

  if (score >= 8) return 'strong';
  if (score >= 5) return 'medium';
  return 'weak';
}

/**
 * Validates a password and returns detailed validation result
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  // Sanitize first
  const sanitized = sanitizePassword(password);

  // Check for dangerous patterns
  const hasDangerousPatterns = containsDangerousPatterns(sanitized);
  if (hasDangerousPatterns) {
    errors.push('Password contains invalid characters');
  }

  // Check if common password
  const common = isCommonPassword(sanitized);
  if (common) {
    errors.push('This password is too common');
  }

  // Check requirements
  const requirements = checkRequirements(sanitized);

  if (!requirements.minLength) {
    errors.push('Password must be at least 8 characters');
  }
  if (!requirements.maxLength) {
    errors.push('Password must be no more than 128 characters');
  }
  if (!requirements.hasUppercase) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!requirements.hasLowercase) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!requirements.hasNumber) {
    errors.push('Password must contain at least one number');
  }
  if (!requirements.hasSpecialChar) {
    errors.push('Password must contain at least one special character');
  }

  // Calculate strength
  const strength = sanitized.length > 0 ? calculateStrength(requirements, sanitized) : null;

  // Determine overall validity
  const meetsAllRequirements = Object.values(requirements).every(Boolean);
  const isValid = meetsAllRequirements && !hasDangerousPatterns && !common && strength !== 'weak';

  return {
    isValid,
    strength,
    requirements,
    errors,
    hasDangerousPatterns,
    isCommonPassword: common,
  };
}

/**
 * Validates that two passwords match
 */
export function passwordsMatch(password: string, confirmPassword: string): boolean {
  return password === confirmPassword;
}

/**
 * Quick validation for login - less strict, just checks for dangerous patterns
 */
export function validateLoginPassword(password: string): { isValid: boolean; error: string | null } {
  if (!password || password.length === 0) {
    return { isValid: false, error: 'Password required' };
  }

  const sanitized = sanitizePassword(password);
  if (containsDangerousPatterns(sanitized)) {
    return { isValid: false, error: 'Password contains invalid characters' };
  }

  return { isValid: true, error: null };
}
