-- Seed de plantillas de notificación i18n (ES / EN / CA)
-- Ejecutar una sola vez: psql $DATABASE_URL -f this_file.sql

INSERT INTO notification_templates (key, locale, channel, title, body) VALUES
-- ── handshake_otp ───────────────────────────────────────────────────────────
('handshake_otp','es','both',
 'Código de verificación',
 'Tu código de entrega City2Cruise es: {{code}}. Válido 5 minutos.'),
('handshake_otp','en','both',
 'Verification code',
 'Your City2Cruise delivery code is: {{code}}. Valid for 5 minutes.'),
('handshake_otp','ca','both',
 'Codi de verificació',
 'El teu codi de lliurament City2Cruise és: {{code}}. Vàlid 5 minuts.'),

-- ── deposit_ready ───────────────────────────────────────────────────────────
('deposit_ready','es','both',
 '¡Tu paquete está en el locker!',
 'Locker {{locker}}. Código PIN: {{code}}. Expira hoy a medianoche.'),
('deposit_ready','en','both',
 'Your package is in the locker!',
 'Locker {{locker}}. PIN: {{code}}. Expires tonight at midnight.'),
('deposit_ready','ca','both',
 'El teu paquet és al locker!',
 'Locker {{locker}}. Codi PIN: {{code}}. Expira avui a mitjanit.'),

-- ── pickup_reminder ─────────────────────────────────────────────────────────
('pickup_reminder','es','both',
 'Recordatorio: paquete pendiente',
 'Tienes un paquete en el locker {{locker}} que lleva más de {{hours}} horas esperando.'),
('pickup_reminder','en','both',
 'Reminder: pending package',
 'You have a package in locker {{locker}} waiting for over {{hours}} hours.'),
('pickup_reminder','ca','both',
 'Recordatori: paquet pendent',
 'Tens un paquet al locker {{locker}} esperant més de {{hours}} hores.'),

-- ── request_assigned ────────────────────────────────────────────────────────
('request_assigned','es','push',
 'Conductor en camino',
 'Un conductor ha aceptado tu solicitud y está en camino.'),
('request_assigned','en','push',
 'Driver on the way',
 'A driver has accepted your request and is heading to you.'),
('request_assigned','ca','push',
 'Conductor en camí',
 'Un conductor ha acceptat la teva sol·licitud i s''acosta.'),

-- ── request_updated ─────────────────────────────────────────────────────────
('request_updated','es','push',
 'Solicitud actualizada',
 'El estado de tu solicitud ha cambiado.'),
('request_updated','en','push',
 'Request updated',
 'Your request status has changed.'),
('request_updated','ca','push',
 'Sol·licitud actualitzada',
 'L''estat de la teva sol·licitud ha canviat.')

ON CONFLICT (key, locale, channel) DO UPDATE
  SET title = EXCLUDED.title,
      body  = EXCLUDED.body,
      active = TRUE;
