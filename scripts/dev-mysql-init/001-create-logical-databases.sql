-- Creates the logical databases needed by services that have reached a
-- checkpoint requiring local MySQL (build plan §3.9: one physical MySQL 8
-- container standing in for TiDB Cloud, multiple logical databases).
--
-- Mounted read-only into the mysql container's
-- /docker-entrypoint-initdb.d/, which MySQL runs once, only against an
-- empty data volume. Add a database here in the same checkpoint that
-- first needs it; do not pre-create databases for future phases.
CREATE DATABASE IF NOT EXISTS somnus_identity
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE DATABASE IF NOT EXISTS somnus_morpheo
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
