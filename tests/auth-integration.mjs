// Uses an ephemeral signing key and local JWKS; never calls Neon or a real account.
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
const{generateKeyPair,exportJWK,SignJWT}=await import(pathToFileURL(require.resolve('jose')));
const{publicKey,privateKey}=await generateKeyPair('EdDSA');const jwk={...await exportJWK(publicKey),kid:'test-only',alg:'EdDSA',use:'sig'};
const server=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[jwk]}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const issuer=`http://127.0.0.1:${server.address().port}`;process.env.NEON_AUTH_ISSUER=issuer;process.env.NEON_AUTH_JWKS_URL=issuer+'/jwks';
 await import('../apps/api/src/routes/offline.js');
 const{requireNeonAuth}=await import('../apps/api/src/middleware/neon-auth.js');
 async function check(token,expected){let status=200,passed=false;const request={get:()=>token?`Bearer ${token}`:undefined};await requireNeonAuth(request,{status(n){status=n;return this},json(){return this}},()=>passed=true);assert.equal(status,expected);assert.equal(passed,expected===200);if(passed)assert.equal(request.auth.subject,'auth-test');}
 const sign=(options={})=>new SignJWT({email:'test@example.invalid'}).setProtectedHeader({alg:'EdDSA',kid:'test-only'}).setSubject('auth-test').setIssuer(options.issuer||issuer).setAudience(options.audience||issuer).setIssuedAt().setExpirationTime(options.expiration||'2m').sign(privateKey);
 await check(null,401);await check('invalid',401);await check(await sign(),200);await check(await sign({expiration:1}),401);await check(await sign({issuer:'https://untrusted.invalid'}),401);await check(await sign({audience:'https://wrong.invalid'}),401);
 console.log('✓ Autenticação real do middleware: assinatura válida aceita; ausência, corrupção, expiração, emissor e audiência inválidos bloqueados.');
}finally{await new Promise(resolve=>server.close(resolve));}
