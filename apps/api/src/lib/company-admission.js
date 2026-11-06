export function canCreateCompany(auth, environment = process.env) {
  const email = typeof auth?.email === 'string' ? auth.email.trim().toLowerCase() : '';
  const allowedEmails = (environment.COMPANY_CREATION_ALLOWED_EMAILS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  return email !== '' && allowedEmails.includes(email);
}
