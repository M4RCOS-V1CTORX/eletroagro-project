import test from 'node:test';
import assert from 'node:assert/strict';
import { labelContacts, validLabelContacts } from '../apps/api/src/lib/label-contacts.js';

test('contatos opcionais aceitam formatos usuais sem alterar o telefone informado', () => {
  assert.equal(validLabelContacts({}), true);
  assert.equal(validLabelContacts({ phone: ' ', email: ' ' }), true);
  assert.equal(validLabelContacts({ phone: '+55 (77) 99999-1234', email: 'contato+vendas@fazenda.com.br' }), true);
  assert.deepEqual(labelContacts({ phone: ' (77) 99999-1234 ', email: ' contato@fazenda.com.br ' }), {
    phone: '(77) 99999-1234',
    email: 'contato@fazenda.com.br',
  });
  assert.deepEqual(labelContacts({}), { phone: '', email: '' });
});

test('contatos recusam tipos inválidos, texto no telefone e e-mail com quebra de linha', () => {
  const invalidContacts = [
    { phone: null },
    { phone: 77999991234 },
    { phone: '123' },
    { phone: 'ligue 77999991234' },
    { phone: '+1234567890123456' },
    { email: null },
    { email: 'sem-arroba' },
    { email: 'contato@fazenda.com\nBcc:outro@fazenda.com' },
    { email: '<script>@fazenda.com' },
  ];

  for (const contacts of invalidContacts) {
    assert.equal(validLabelContacts(contacts), false);
  }
});
