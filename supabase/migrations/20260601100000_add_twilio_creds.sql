ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS twilio_sid   text,
  ADD COLUMN IF NOT EXISTS twilio_token text;

-- UPDATE app_settings SET twilio_sid = 'YOUR_TWILIO_SID', twilio_token = 'YOUR_TWILIO_TOKEN' WHERE id = 1;
