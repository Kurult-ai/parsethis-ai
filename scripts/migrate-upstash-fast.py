#!/usr/bin/env python3
"""Fast Upstash migration: SCAN source, DUMP each key, RESTORE into target via RESP.

Uses raw sockets + RESP to avoid redis-cli process spawn per key and to keep
DUMP payloads binary-safe. Preserves TTLs (PTTL) from source.
"""
import socket
import ssl
import sys
from urllib.parse import urlparse, unquote


def connect(url: str) -> ssl.SSLSocket | socket.socket:
    u = urlparse(url)
    host, port = u.hostname or "127.0.0.1", u.port or 6379
    raw = socket.create_connection((host, port), timeout=30)
    if url.startswith("rediss://"):
        ctx = ssl.create_default_context()
        s = ctx.wrap_socket(raw, server_hostname=host)
    else:
        s = raw
    # AUTH
    if u.password:
        _cmd(s, b"AUTH", (u.username or "default").encode(), u.password.encode())
    if u.path and u.path != "/":
        db = u.path.strip("/").split("?")[0]
        _cmd(s, b"SELECT", db.encode())
    return s


def _cmd(sock, *args) -> list:
    out = [b"*%d\r\n" % len(args)]
    for a in args:
        if isinstance(a, int):
            a = str(a).encode()
        elif isinstance(a, str):
            a = a.encode()
        out.append(b"$%d\r\n%s\r\n" % (len(a), a))
    sock.sendall(b"".join(out))
    return _read(sock)


class Reader:
    def __init__(self, sock):
        self.sock = sock
        self.buf = b""

    def _fill(self):
        chunk = self.sock.recv(65536)
        if not chunk:
            raise EOFError
        self.buf += chunk

    def _line(self):
        while b"\r\n" not in self.buf:
            self._fill()
        line, self.buf = self.buf.split(b"\r\n", 1)
        return line

    def _exact(self, n):
        while len(self.buf) < n + 2:
            self._fill()
        data, self.buf = self.buf[:n], self.buf[n + 2:]
        return data

    def value(self):
        line = self._line()
        kind, body = line[:1], line[1:]
        if kind == b"+" or kind == b"-":
            txt = body.decode(errors="replace")
            if kind == b"-":
                raise RuntimeError(txt[:120])
            return txt
        if kind == b":":
            return int(body)
        if kind == b"$":
            n = int(body)
            if n == -1:
                return None
            return self._exact(n)
        if kind == b"*":
            n = int(body)
            if n == -1:
                return None
            return [self.value() for _ in range(n)]
        raise RuntimeError("bad resp %r" % line[:40])


def _read(sock):
    return Reader(sock).value()


def main(src_url: str, tgt_url: str):
    src, tgt = connect(src_url), connect(tgt_url)
    print("source:", _cmd(src, "PING"), "target:", _cmd(tgt, "PING"))
    keys, cursor = [], b"0"
    while True:
        r = _cmd(src, "SCAN", cursor, b"COUNT", b"500")
        cursor = int(r[0])
        keys.extend(r[1])
        if cursor == 0:
            break
    print("keys:", len(keys))
    ok = fail = 0
    errs = {}
    for i, k in enumerate(keys):
        try:
            t = _cmd(src, "TYPE", k)
            ttl_ms = _cmd(src, "PTTL", k)
            if t == "string":
                v = _cmd(src, "GET", k)
                _cmd(tgt, "SET", k, v)
            elif t == "hash":
                h = _cmd(src, "HGETALL", k)
                if h:
                    _cmd(tgt, "DEL", k)
                    it = iter(h)
                    _cmd(tgt, "HSET", k, *h)
            elif t == "set":
                m = _cmd(src, "SMEMBERS", k)
                if m:
                    _cmd(tgt, "DEL", k)
                    _cmd(tgt, "SADD", k, *m)
            elif t == "zset":
                z = _cmd(src, "ZRANGE", k, 0, -1, "WITHSCORES")
                if z:
                    _cmd(tgt, "DEL", k)
                    _cmd(tgt, "ZADD", k, *z)
            elif t == "list":
                l = _cmd(src, "LRANGE", k, 0, -1)
                if l:
                    _cmd(tgt, "DEL", k)
                    _cmd(tgt, "RPUSH", k, *l)
            else:
                fail += 1
                errs["type:%s" % t] = errs.get("type:%s" % t, 0) + 1
                continue
            if isinstance(ttl_ms, int) and ttl_ms > 0:
                _cmd(tgt, "PEXPIRE", k, ttl_ms)
            ok += 1
        except RuntimeError as e:
            fail += 1
            errs[str(e)[:60]] = errs.get(str(e)[:60], 0) + 1
        if (i + 1) % 500 == 0:
            print("  %d/%d ok=%d fail=%d" % (i + 1, len(keys), ok, fail))
    print("done: ok=%d fail=%d" % (ok, fail))
    for e, c in sorted(errs.items(), key=lambda x: -x[1])[:5]:
        print("  err x%d: %s" % (c, e))
    print("target dbsize:", _cmd(tgt, "DBSIZE"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
