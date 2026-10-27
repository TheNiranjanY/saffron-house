from datetime import date, datetime
from decimal import Decimal

from flask.json.provider import DefaultJSONProvider

from .timeutil import LOCAL_TZ


class SaffronJSONProvider(DefaultJSONProvider):
    sort_keys = False

    @staticmethod
    def default(o):
        if isinstance(o, Decimal):
            return float(o)
        if isinstance(o, datetime):
            if o.tzinfo is None:
                o = o.replace(tzinfo=LOCAL_TZ)
            return o.isoformat()
        if isinstance(o, date):
            return o.isoformat()
        return DefaultJSONProvider.default(o)
