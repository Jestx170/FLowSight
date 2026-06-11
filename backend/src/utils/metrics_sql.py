# =============================================================================
# metrics_sql.py — Single source of truth for analytics SQL fragments.
#
# Every report surface (Dashboard /api/stats, PDF, AI insight) must count the
# SAME way, or the same day produces three different numbers.  These constants
# are interpolated into f-strings; they contain NO user input, so they are safe
# from SQL injection.
# =============================================================================

# A "visitor" is identified by (cam_key, person_id), NOT person_id alone.
# Track IDs restart from 1 on every camera, so two different people who happen
# to share a track id on different cameras would otherwise be merged into one.
# NOTE: this still over-counts a single person who walks across two cameras
# (no cross-camera re-ID yet) — that's an accepted trade-off for now.
VISITOR_KEY = "(cam_key || '_' || person_id)"

# Behaviour ids that count as "interested" / "purchasing".  Kept tolerant so
# both the engine defaults (interested / checkout_ready) and the shipped example
# config (tasting / in_wine_zone / checkout) resolve to the same figure
# everywhere.  Edit here once to change it for all reports.
INTERESTED_IDS = ("interested", "tasting", "in_wine_zone", "viewing", "engaged")
PURCHASING_IDS = ("checkout", "checkout_ready", "purchasing")


def _in_clause(ids) -> str:
    return "(" + ",".join("'" + i + "'" for i in ids) + ")"


INTERESTED_IN = _in_clause(INTERESTED_IDS)   # e.g. ('interested','tasting',...)
PURCHASING_IN = _in_clause(PURCHASING_IDS)
