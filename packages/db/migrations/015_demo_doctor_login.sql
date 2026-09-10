-- 015_demo_doctor_login.sql
-- Seeds a real username/password login for the demo doctor (Dr. Priya Login, user 103 / doctor 202)
-- so the login page "Doctor" role card can authenticate against the database.
-- Username: priya.1000 (clinic unique number scheme), Password: vaidya-local-dev
UPDATE users
SET username = 'priya.1000',
    password_hash = 'b5ea7e8025333a54270255e3c171d9eb2dcd6d7529ff75dd358a0dec71852683738b2ce7aa8447fa16ecb45603c0c7af198dc0bfeb7bf08a067cb9c8f8bf7f33',
    password_salt = '205a864c9d9d378fa6d429e07b5b1f9e'
WHERE id = '00000000-0000-0000-0000-000000000103';
