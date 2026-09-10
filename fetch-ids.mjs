import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5433/vaidya_test' });
await client.connect();
try {
  const clinics = (await client.query('SELECT id, name, city FROM clinics LIMIT 5')).rows;
  console.log('CLINICS:', JSON.stringify(clinics, null, 2));
  if (clinics.length > 0) {
    const cid = clinics[0].id;
    const doctors = (await client.query('SELECT id, name FROM doctors WHERE "clinicId" = $1 LIMIT 5', [cid])).rows;
    console.log('DOCTORS:', JSON.stringify(doctors, null, 2));
    const services = (await client.query('SELECT id, "serviceName", "serviceKey" FROM clinic_services WHERE "clinicId" = $1 AND active = true LIMIT 5', [cid])).rows;
    console.log('SERVICES:', JSON.stringify(services, null, 2));
    const slots = (await client.query('SELECT s.id, s."startTime", s."doctorId" FROM slots s WHERE s."clinicId" = $1 AND s."startTime" > NOW() ORDER BY s."startTime" LIMIT 5', [cid])).rows;
    console.log('SLOTS:', JSON.stringify(slots, null, 2));
  }
} finally {
  await client.end();
}
