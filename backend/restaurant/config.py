import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")


class Config:
    MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
    MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3307"))
    MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "restaurant")
    MYSQL_USER = os.getenv("MYSQL_USER", "restaurant")
    MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "restaurantpass")
    MYSQL_SSL_CA = os.getenv("MYSQL_SSL_CA") or None

    TS_HOST = os.getenv("TS_HOST", "127.0.0.1")
    TS_PORT = int(os.getenv("TS_PORT", "5433"))
    TS_DATABASE = os.getenv("TS_DATABASE", "restaurant_analytics")
    TS_USER = os.getenv("TS_USER", "restaurant")
    TS_PASSWORD = os.getenv("TS_PASSWORD", "restaurantpass")
    TS_SSLMODE = os.getenv("TS_SSLMODE", "prefer")
    TS_SSLROOTCERT = os.getenv("TS_SSLROOTCERT") or None

    MYSQL_POOL_SIZE = int(os.getenv("MYSQL_POOL_SIZE", "12"))
    TS_POOL_MAX = int(os.getenv("TS_POOL_MAX", "6"))

    TZ = os.getenv("TZ", "Asia/Kolkata")
    FLASK_PORT = int(os.getenv("FLASK_PORT", "5001"))
    DEBUG = os.getenv("FLASK_DEBUG", "1") == "1"
    SQL_LAB_ENABLED = os.getenv("SQL_LAB_ENABLED", "1") == "1"

    TAX_RATE = 0.05

    @classmethod
    def mysql_config(cls):
        options = {
            "host": cls.MYSQL_HOST,
            "port": cls.MYSQL_PORT,
            "user": cls.MYSQL_USER,
            "password": cls.MYSQL_PASSWORD,
            "database": cls.MYSQL_DATABASE,
            "charset": "utf8mb4",
            "autocommit": False,
            "init_command": (
                "SET time_zone = '+05:30', "
                "SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,"
                "NO_ENGINE_SUBSTITUTION'"
            ),
        }
        if cls.MYSQL_SSL_CA:
            options["ssl_ca"] = cls.MYSQL_SSL_CA
            options["ssl_verify_cert"] = True
        return options

    @classmethod
    def ts_conninfo(cls):
        conninfo = (
            f"host={cls.TS_HOST} port={cls.TS_PORT} dbname={cls.TS_DATABASE} "
            f"user={cls.TS_USER} password={cls.TS_PASSWORD} "
            f"options='-c timezone={cls.TZ}' connect_timeout=10 "
            f"sslmode={cls.TS_SSLMODE}"
        )
        if cls.TS_SSLROOTCERT:
            cert = cls.TS_SSLROOTCERT
            if " " in cert:
                cert = f"'{cert}'"
            conninfo += f" sslrootcert={cert}"
        return conninfo
