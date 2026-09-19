const net = require('net');
const { closeDatabaseConnection, createDatabaseConnection } = require('./dist/index.js');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const parsedDatabaseUrl = new URL(databaseUrl);
const databaseHost = parsedDatabaseUrl.hostname;
const databasePort = Number(parsedDatabaseUrl.port || 5432);

function tcpConnectTime(host, port) {
  return new Promise((resolve) => {
    const t = Date.now();
    const sock = net.connect({ host, port });
    sock.once('connect', () => {
      sock.destroy();
      resolve(Date.now() - t);
    });
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
  console.log(
    'DNS (database):',
    await dnsTime(databaseHost),
    'ms | TCP:',
    await tcpConnectTime(databaseHost, databasePort),
    'ms',
  );

  const conn = createDatabaseConnection(databaseUrl);
  try {
    let t = Date.now();
    await conn.client`SELECT 1`;
    console.log('COLD first query (includes TLS+auth):', Date.now() - t, 'ms');

    t = Date.now();
    await conn.client`SELECT 1`;
    console.log('WARM second query:', Date.now() - t, 'ms');

    t = Date.now();
    await conn.client`SELECT 1`;
    console.log('WARM third query:', Date.now() - t, 'ms');
  } finally {
    await closeDatabaseConnection(conn);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
