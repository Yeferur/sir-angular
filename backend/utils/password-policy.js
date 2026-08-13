function isStrongPassword(value) {
  const password = String(value || '');
  return password.length >= 8
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

module.exports = { isStrongPassword };
