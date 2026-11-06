import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createCompaniesRouter } from '../apps/api/src/routes/companies.js';
import { createRequestPool } from '../apps/api/src/lib/request-pool.js';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const express = require('express');

test('acesso fechado preserva contas existentes e aceita apenas convite válido para o mesmo e-mail', async () => {
  const db = new PGlite();
  let server;
  try {
    const directory = new URL('../apps/api/src/db/migrations/', import.meta.url);
    const migrations = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
    for (const name of migrations) {
      await db.exec(await readFile(new URL(name, directory), 'utf8'));
    }
    const company = (await db.query("INSERT INTO companies(name) VALUES('Empresa atual') RETURNING id")).rows[0].id;
    const owner = (await db.query(`INSERT INTO company_memberships(company_id,auth_issuer,auth_subject,role,email)
      VALUES($1,'test','owner','owner','owner@example.com') RETURNING id`, [company])).rows[0].id;
    const invitationCode = 'a'.repeat(40);
    const invitationHash = createHash('sha256').update(invitationCode).digest('hex');
    await db.query(`INSERT INTO company_invitations(company_id,invited_email,token_hash,invited_by_membership_id,expires_at)
      VALUES($1,'invited@example.com',$2,$3,now()+interval '7 days')`, [company, invitationHash, owner]);

    const query = async (...args) => {
      const result = await db.query(...args);
      return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
    };
    const pool = createRequestPool({ query, connect: async () => ({ query, release() {} }) });
    const app = express();
    app.use(express.json());
    app.use('/api/company', createCompaniesRouter({
      pool,
      environment: { COMPANY_CREATION_ALLOWED_EMAILS: 'approved@example.com' },
      requireAuth(request, response, next) {
        const subject = request.get('x-user');
        if (!subject) return response.status(401).json({});
        request.auth = { issuer: 'test', subject, email: `${subject}@example.com` };
        next();
      },
    }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/company`;

    async function request(path, subject, body) {
      return fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(subject ? { 'x-user': subject } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    }

    assert.equal((await request('/me')).status, 401);
    const existing = await (await request('/me', 'owner')).json();
    assert.equal(existing.company.id, company);
    assert.equal(existing.company.role, 'owner');
    assert.equal(existing.canCreateCompany, false);
    assert.equal((await request('', 'stranger', { name: 'Não autorizada' })).status, 403);
    assert.equal((await request('/invitations/accept', 'stranger', { code: invitationCode })).status, 404);
    await db.query("UPDATE company_invitations SET expires_at=now()-interval '1 day'");
    assert.equal((await request('/invitations/accept', 'invited', { code: invitationCode })).status, 404);
    await db.query("UPDATE company_invitations SET expires_at=now()+interval '7 days',revoked_at=now()");
    assert.equal((await request('/invitations/accept', 'invited', { code: invitationCode })).status, 404);
    await db.query('UPDATE company_invitations SET revoked_at=NULL');
    const accepted = await request('/invitations/accept', 'invited', { code: invitationCode });
    assert.equal(accepted.status, 201);
    assert.equal((await accepted.json()).company.id, company);
    assert.equal((await request('/invitations/accept', 'invited', { code: invitationCode })).status, 404);
    assert.equal((await (await request('/me', 'invited')).json()).company.role, 'member');

    const approved = await (await request('/me', 'approved')).json();
    assert.equal(approved.canCreateCompany, true);
    assert.equal((await request('', 'approved', { name: 'Empresa autorizada' })).status, 201);
    assert.equal((await request('', 'approved', { name: 'Duplicada' })).status, 409);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM companies')).rows[0].total, 2);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.close();
  }
});
