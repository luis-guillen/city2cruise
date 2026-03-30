#!/bin/bash
# Script de inicio: crea la base de datos de testing si no existe
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE cruise_connect_test'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cruise_connect_test')\gexec

    \c cruise_connect_test
    CREATE EXTENSION IF NOT EXISTS postgis;
EOSQL
