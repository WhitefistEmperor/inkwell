-- The RealWorld spec represents "no bio / no picture" as null, not as an
-- empty string. NULL is also the honest database value for "unknown".
ALTER TABLE users ALTER COLUMN bio DROP NOT NULL, ALTER COLUMN bio DROP DEFAULT;
ALTER TABLE users ALTER COLUMN image DROP NOT NULL, ALTER COLUMN image DROP DEFAULT;
UPDATE users SET bio = NULLIF(bio, ''), image = NULLIF(image, '');
