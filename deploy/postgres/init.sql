-- init.sql — se ejecuta UNA VEZ cuando el volumen de datos está vacío.
-- Crear la extensión necesaria para gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Las tablas se crean por migrate.ts al arrancar el api (idempotente).
