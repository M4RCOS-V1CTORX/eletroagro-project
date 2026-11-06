export function validLabelContacts(body) {
  const { phone = '', email = '' } = body;

  if (typeof phone !== 'string' || typeof email !== 'string') {
    return false;
  }

  const trimmedPhone = phone.trim();
  const trimmedEmail = email.trim();
  const phoneDigits = trimmedPhone.replace(/\D/g, '');
  const validPhone = trimmedPhone === '' || (
    trimmedPhone.length <= 30
    && /^\+?[\d\s().-]+$/.test(trimmedPhone)
    && phoneDigits.length >= 10
    && phoneDigits.length <= 15
  );
  const validEmail = trimmedEmail === '' || (
    trimmedEmail.length <= 254
    && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(trimmedEmail)
  );

  return validPhone && validEmail;
}

export function labelContacts(body) {
  return {
    phone: (body.phone ?? '').trim(),
    email: (body.email ?? '').trim(),
  };
}
