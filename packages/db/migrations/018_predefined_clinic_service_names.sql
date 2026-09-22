UPDATE clinic_services
SET
  service_name = CASE service_key
    WHEN 'orthopaedic_consultation' THEN 'Orthopaedic Consultation'
    WHEN 'paediatric_consultation' THEN 'Paediatric Consultation'
    WHEN 'general_consultation' THEN 'General Consultation'
    WHEN 'dermatology_consultation' THEN 'Dermatology Consultation'
    WHEN 'ent_consultation' THEN 'ENT Consultation'
    WHEN 'dental_consultation' THEN 'Dental Consultation'
    WHEN 'cardiology_consultation' THEN 'Cardiology Consultation'
    WHEN 'ophthalmology_consultation' THEN 'Ophthalmology Consultation'
    WHEN 'gynaecology_consultation' THEN 'Gynaecology Consultation'
    WHEN 'neurology_consultation' THEN 'Neurology Consultation'
    WHEN 'gastroenterology_consultation' THEN 'Gastroenterology Consultation'
    ELSE service_name
  END,
  updated_at = now()
WHERE service_key IN (
  'orthopaedic_consultation',
  'paediatric_consultation',
  'general_consultation',
  'dermatology_consultation',
  'ent_consultation',
  'dental_consultation',
  'cardiology_consultation',
  'ophthalmology_consultation',
  'gynaecology_consultation',
  'neurology_consultation',
  'gastroenterology_consultation'
)
AND service_name IS DISTINCT FROM CASE service_key
  WHEN 'orthopaedic_consultation' THEN 'Orthopaedic Consultation'
  WHEN 'paediatric_consultation' THEN 'Paediatric Consultation'
  WHEN 'general_consultation' THEN 'General Consultation'
  WHEN 'dermatology_consultation' THEN 'Dermatology Consultation'
  WHEN 'ent_consultation' THEN 'ENT Consultation'
  WHEN 'dental_consultation' THEN 'Dental Consultation'
  WHEN 'cardiology_consultation' THEN 'Cardiology Consultation'
  WHEN 'ophthalmology_consultation' THEN 'Ophthalmology Consultation'
  WHEN 'gynaecology_consultation' THEN 'Gynaecology Consultation'
  WHEN 'neurology_consultation' THEN 'Neurology Consultation'
  WHEN 'gastroenterology_consultation' THEN 'Gastroenterology Consultation'
  ELSE service_name
END;
