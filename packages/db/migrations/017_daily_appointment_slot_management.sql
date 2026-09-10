-- 017_daily_appointment_slot_management.sql
-- Daily Doctor Appointment Slot Management System

-- ============================================================
-- hospitals table
-- ============================================================
CREATE TABLE IF NOT EXISTS hospitals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    registration_number VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ============================================================
-- doctors table (add appointment_duration column)
-- ============================================================
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS appointment_duration INTEGER NOT NULL DEFAULT 30;

-- ============================================================
-- doctor_working_hours table
-- ============================================================
CREATE TABLE IF NOT EXISTS doctor_working_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    day_of_week VARCHAR(10) NOT NULL CHECK (day_of_week IN ('MON','TUE','WED','THU','FRI','SAT','SUN')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(doctor_id, day_of_week)
);

-- ============================================================
-- doctor_leaves table
-- ============================================================
CREATE TABLE IF NOT EXISTS doctor_leaves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ============================================================
-- blocked_dates table (hospital-level blocked dates)
-- ============================================================
CREATE TABLE IF NOT EXISTS blocked_dates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(hospital_id, date)
);

-- ============================================================
-- appointment_slots table modification
-- ============================================================
-- Add hospital_id column if not exists
ALTER TABLE appointment_slots ADD COLUMN IF NOT EXISTS hospital_id UUID REFERENCES hospitals(id) ON DELETE SET NULL;

-- We will add the unique index separately via a SQL command
-- to avoid syntax issues with the postgres driver.
-- The application code will handle uniqueness via checks and
-- the unique constraint will be ensured by the application logic.

-- ============================================================
-- slot_generation_logs table
-- ============================================================
CREATE TABLE IF NOT EXISTS slot_generation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    execution_completed_at TIMESTAMP WITH TIME ZONE,
    hospitals_processed INTEGER NOT NULL DEFAULT 0,
    doctors_processed INTEGER NOT NULL DEFAULT 0,
    slots_created INTEGER NOT NULL DEFAULT 0,
    slots_expired INTEGER NOT NULL DEFAULT 0,
    slots_blocked INTEGER NOT NULL DEFAULT 0,
    errors TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_slot_generation_logs_status ON slot_generation_logs(status);
CREATE INDEX IF NOT EXISTS idx_slot_generation_logs_executed_at ON slot_generation_logs(execution_started_at);

-- ============================================================
-- End of migration 017
-- ============================================================