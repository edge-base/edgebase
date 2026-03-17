"""AnalyticsClient — request metrics and custom event tracking for the admin SDK."""

from __future__ import annotations

from time import time
from typing import Any

from edgebase_admin.generated.admin_api_core import GeneratedAdminApi
from edgebase_core.generated.api_core import GeneratedDbApi
from edgebase_core.generated.client_wrappers import GeneratedAnalyticsMethods


class AnalyticsClient:
    """Analytics query and event tracking helpers."""

    def __init__(self, core: GeneratedDbApi, admin_core: GeneratedAdminApi) -> None:
        self._methods = GeneratedAnalyticsMethods(core)
        self._admin_core = admin_core

    def overview(
        self,
        *,
        range: str | None = None,
        category: str | None = None,
        group_by: str | None = None,
    ) -> dict[str, Any]:
        result = self._admin_core.query_analytics(
            self._build_query(metric="overview", range=range, category=category, group_by=group_by),
        )
        return result if isinstance(result, dict) else {}

    def time_series(
        self,
        *,
        range: str | None = None,
        category: str | None = None,
        group_by: str | None = None,
    ) -> list[dict[str, Any]]:
        result = self._admin_core.query_analytics(
            self._build_query(metric="timeSeries", range=range, category=category, group_by=group_by),
        )
        if isinstance(result, dict) and isinstance(result.get("timeSeries"), list):
            return result["timeSeries"]
        return []

    def breakdown(
        self,
        *,
        range: str | None = None,
        category: str | None = None,
        group_by: str | None = None,
    ) -> list[dict[str, Any]]:
        result = self._admin_core.query_analytics(
            self._build_query(metric="breakdown", range=range, category=category, group_by=group_by),
        )
        if isinstance(result, dict) and isinstance(result.get("breakdown"), list):
            return result["breakdown"]
        return []

    def top_endpoints(
        self,
        *,
        range: str | None = None,
        category: str | None = None,
        group_by: str | None = None,
    ) -> list[dict[str, Any]]:
        result = self._admin_core.query_analytics(
            self._build_query(metric="topEndpoints", range=range, category=category, group_by=group_by),
        )
        if isinstance(result, dict) and isinstance(result.get("topItems"), list):
            return result["topItems"]
        return []

    def track(
        self,
        name: str,
        properties: dict[str, str | int | float | bool] | None = None,
        user_id: str | None = None,
    ) -> None:
        event: dict[str, Any] = {
            "name": name,
            "timestamp": int(time() * 1000),
        }
        if properties:
            event["properties"] = properties
        if user_id:
            event["userId"] = user_id
        self._methods.track({"events": [event]})

    def track_batch(self, events: list[dict[str, Any]]) -> None:
        payload_events: list[dict[str, Any]] = []
        for event in events:
            payload = dict(event)
            payload.setdefault("timestamp", int(time() * 1000))
            payload_events.append(payload)
        if payload_events:
            self._methods.track({"events": payload_events})

    def query_events(
        self,
        *,
        range: str | None = None,
        event: str | None = None,
        user_id: str | None = None,
        metric: str | None = None,
        group_by: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> Any:
        query: dict[str, str] = {}
        if range:
            query["range"] = range
        if event:
            query["event"] = event
        if user_id:
            query["userId"] = user_id
        if metric:
            query["metric"] = metric
        if group_by:
            query["groupBy"] = group_by
        if limit is not None:
            query["limit"] = str(limit)
        if cursor:
            query["cursor"] = cursor
        return self._admin_core.query_custom_events(query or None)

    @staticmethod
    def _build_query(
        *,
        metric: str,
        range: str | None = None,
        category: str | None = None,
        group_by: str | None = None,
    ) -> dict[str, str]:
        query = {"metric": metric}
        if range:
            query["range"] = range
        if category:
            query["category"] = category
        if group_by:
            query["groupBy"] = group_by
        return query
