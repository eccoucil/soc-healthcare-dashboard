import {
  sanitizePassword,
  containsDangerousPatterns,
  isCommonPassword,
  checkRequirements,
  calculateStrength,
  validatePassword,
  passwordsMatch,
  validateLoginPassword,
} from '../password-validation'

describe('sanitizePassword', () => {
  it('removes null bytes', () => {
    expect(sanitizePassword('pass\0word')).toBe('password')
  })

  it('removes control characters but keeps printable text', () => {
    expect(sanitizePassword('hello\x01\x02world')).toBe('helloworld')
  })

  it('preserves normal passwords unchanged', () => {
    expect(sanitizePassword('MyP@ss123!')).toBe('MyP@ss123!')
  })
})

describe('containsDangerousPatterns', () => {
  it('detects XSS script tags', () => {
    expect(containsDangerousPatterns('<script>alert(1)</script>')).toBe(true)
  })

  it('detects SQL injection OR pattern', () => {
    expect(containsDangerousPatterns("' or 1=1")).toBe(true)
  })

  it('detects SQL UNION SELECT', () => {
    expect(containsDangerousPatterns('foo UNION SELECT * FROM users')).toBe(true)
  })

  it('returns false for safe passwords', () => {
    expect(containsDangerousPatterns('MySecure#Pass99')).toBe(false)
  })
})

describe('isCommonPassword', () => {
  it('flags "password" as common', () => {
    expect(isCommonPassword('password')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isCommonPassword('PASSWORD')).toBe(true)
  })

  it('returns false for uncommon passwords', () => {
    expect(isCommonPassword('x9#Kz!mQ2r')).toBe(false)
  })
})

describe('checkRequirements', () => {
  it('returns all true for a strong password', () => {
    const reqs = checkRequirements('MyP@ss12')
    expect(reqs).toEqual({
      minLength: true,
      maxLength: true,
      hasUppercase: true,
      hasLowercase: true,
      hasNumber: true,
      hasSpecialChar: true,
    })
  })

  it('fails minLength for short passwords', () => {
    expect(checkRequirements('Ab1!').minLength).toBe(false)
  })

  it('fails maxLength for 129-char passwords', () => {
    expect(checkRequirements('A'.repeat(129)).maxLength).toBe(false)
  })
})

describe('calculateStrength', () => {
  it('returns weak when minLength is not met', () => {
    const reqs = checkRequirements('Ab1!')
    expect(calculateStrength(reqs, 'Ab1!')).toBe('weak')
  })

  it('returns strong for long complex passwords', () => {
    const pw = 'MyStr0ng!P@ssw0rd#2024'
    const reqs = checkRequirements(pw)
    expect(calculateStrength(reqs, pw)).toBe('strong')
  })
})

describe('validatePassword', () => {
  it('returns valid for a strong, safe password', () => {
    const result = validatePassword('Str0ng!P@ss99')
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.hasDangerousPatterns).toBe(false)
    expect(result.isCommonPassword).toBe(false)
  })

  it('rejects common passwords', () => {
    const result = validatePassword('password')
    expect(result.isValid).toBe(false)
    expect(result.isCommonPassword).toBe(true)
  })

  it('rejects passwords with XSS patterns', () => {
    const result = validatePassword('<script>Ab1!</script>')
    expect(result.isValid).toBe(false)
    expect(result.hasDangerousPatterns).toBe(true)
  })
})

describe('passwordsMatch', () => {
  it('returns true for identical passwords', () => {
    expect(passwordsMatch('abc123', 'abc123')).toBe(true)
  })

  it('returns false for different passwords', () => {
    expect(passwordsMatch('abc123', 'abc124')).toBe(false)
  })
})

describe('validateLoginPassword', () => {
  it('rejects empty password', () => {
    const result = validateLoginPassword('')
    expect(result.isValid).toBe(false)
    expect(result.error).toBe('Password required')
  })

  it('accepts a normal password', () => {
    const result = validateLoginPassword('anything-goes')
    expect(result.isValid).toBe(true)
    expect(result.error).toBeNull()
  })

  it('rejects passwords with dangerous patterns', () => {
    const result = validateLoginPassword("' or 1=1")
    expect(result.isValid).toBe(false)
  })
})
