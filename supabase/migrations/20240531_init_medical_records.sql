-- Create medical_records table for persistent agent memory
CREATE TABLE IF NOT EXISTS medical_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_name TEXT NOT NULL,
  symptoms TEXT,
  diagnosis TEXT,
  treatment_plan TEXT,
  clinic_recommendations JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE medical_records ENABLE ROW LEVEL SECURITY;

-- Create policy to allow the service_role (used by our backend) full access
-- Note: In a production app with users, you'd add policies for auth.uid()
CREATE POLICY "Enable all access for service role" ON medical_records
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Index for faster lookups by patient name
CREATE INDEX IF NOT EXISTS idx_medical_records_patient_name ON medical_records(patient_name);
