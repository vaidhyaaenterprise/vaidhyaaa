import postgres from 'postgres';
const sql = postgres('postgresql://postgres:postgres@localhost:5433/vaidya_test');
try {
  const rows = await sql`SELECT * FROM clinic_services`;
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await sql.end();
}
