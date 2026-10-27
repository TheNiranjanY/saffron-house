import time
from contextlib import contextmanager

import mysql.connector
from mysql.connector import pooling
from mysql.connector.errors import PoolError
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import Config

_mysql_pool: pooling.MySQLConnectionPool | None = None
_ts_pool: ConnectionPool | None = None

POOL_WAIT_SECONDS = 5.0


def init_pools():
    global _mysql_pool, _ts_pool
    if _mysql_pool is None:
        _mysql_pool = pooling.MySQLConnectionPool(
            pool_name="saffron_mysql",
            pool_size=12,
            pool_reset_session=True,
            **Config.mysql_config(),
        )
    if _ts_pool is None:
        _ts_pool = ConnectionPool(
            conninfo=Config.ts_conninfo(),
            min_size=1,
            max_size=6,
            timeout=15,
            kwargs={"row_factory": dict_row, "autocommit": True},
            open=True,
        )


def close_pools():
    global _ts_pool
    if _ts_pool is not None:
        _ts_pool.close()
        _ts_pool = None


def mysql_conn():
    if _mysql_pool is None:
        init_pools()
    # mysql.connector's pool fails fast when every connection is busy; page
    # loads fire several API calls at once, so wait briefly instead of 500ing.
    deadline = time.monotonic() + POOL_WAIT_SECONDS
    while True:
        try:
            return _mysql_pool.get_connection()
        except PoolError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.02)


@contextmanager
def mysql_tx():
    conn = mysql_conn()
    try:
        conn.start_transaction()
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def mysql_read():
    conn = mysql_conn()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def cursor(conn, dictionary=True):
    cur = conn.cursor(dictionary=dictionary)
    try:
        yield cur
    finally:
        cur.close()


@contextmanager
def ts_conn():
    if _ts_pool is None:
        init_pools()
    with _ts_pool.connection() as conn:
        yield conn


def mysql_rows(sql, params=(), dictionary=True):
    with mysql_read() as conn, cursor(conn, dictionary) as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def mysql_row(sql, params=(), dictionary=True):
    with mysql_read() as conn, cursor(conn, dictionary) as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def ts_rows(sql, params=None):
    with ts_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def ts_row(sql, params=None):
    rows = ts_rows(sql, params)
    return rows[0] if rows else None
