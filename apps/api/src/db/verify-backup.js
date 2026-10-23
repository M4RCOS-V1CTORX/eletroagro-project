import 'dotenv/config';
import { createDecipheriv, createHash, scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const file = process.argv[2];
if (!file || !process.env.BACKUP_ENCRYPTION_KEY) { console.error('Informe o arquivo e configure BACKUP_ENCRYPTION_KEY.'); process.exit(1); }
try {
  const [compressed, checksumFile] = await Promise.all([readFile(file), readFile(`${file}.sha256`, 'utf8')]);
  const actual = createHash('sha256').update(compressed).digest('hex');
  const expected = checksumFile.trim().split(/\s+/)[0];
  if (actual !== expected) throw new Error('Checksum divergente: o arquivo foi alterado ou corrompido.');
  if (compressed.subarray(0,5).toString() !== 'EAGB1') throw new Error('Formato criptografado inválido.');
  const salt=compressed.subarray(5,21);const iv=compressed.subarray(21,33);const tag=compressed.subarray(33,49);const encrypted=compressed.subarray(49);const key=scryptSync(process.env.BACKUP_ENCRYPTION_KEY,salt,32);const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);
  const parsed = JSON.parse(gunzipSync(Buffer.concat([decipher.update(encrypted),decipher.final()])).toString('utf8'));
  if (parsed.backupVersion !== 1 || !parsed.tables?.companies || !parsed.tables?.company_memberships) throw new Error('Estrutura de backup inválida.');
  console.log(`Backup íntegro: ${Object.keys(parsed.tables).length} tabelas, criado em ${parsed.createdAt}.`);
} catch (error) { console.error('Backup inválido:', error.message); process.exitCode = 1; }
