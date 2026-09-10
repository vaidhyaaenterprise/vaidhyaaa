const net = require('net');
const { createDatabaseConnection } = require('C:/Users/Karthikeyan/Documents/vaidhyaa_workspace/vaidhyaa/packages/db/dist/index.js');

const POOLER = 'aws-0-us-east-2.pooler.supabase.com';
const DIRECT = 'db.gojcwilexckowjcbwrpn.supabase.co';

function tcpConnectTime(host, port) {
  return new Promise((resolve) => {
    const t = Date.now();
    const sock = net.connect({ host, port });
    sock.once('connect', () => { sock.destroy(); resolve(Date.now() - t); });
    sock.once('error', (e) => resolve(-1));
  });
}

function dnsTime(host) {
  return new Promise((resolve) => {
    const t = Date.now();
    require('dns').resolve4(host, () => resolve(Date.now() - t));
  });
}

(async () => {
  console.log('DNS (pooler):', await dnsTime(POOLER), 'ms | TCP:', await tcpConnectTime(POOLER, 5432), 'ms');
  console.log('DNS (direct):', await dnsTime(DIRECT), 'ms | TCP:', await tcpConnectTime(DIRECT, 5432), 'ms');

  const conn = createDatabaseConnection('postgresql://postgres.gojcwilexckowjcbwrpn:ifzoxFAgLEq7XaYh@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require');

  let t = Date.now();
  await conn.client`SELECT 1`;
  console.log('COLD first query (includes TLS+auth):', Date.now() - t, 'ms');

  t = Date.now();
  await conn.client`SELECT 1`;
  console.log('WARM second query:', Date.now() - t, 'ms');

  t = Date.now();
  await conn.client`SELECT 1`;
  console.log('WARM third query:', Date.now() - t, 'ms');

  await conn.client.end({ timeout: 5 });
})().catch((e) => { console.error(e.message); process.exit(1); });