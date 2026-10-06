class StatsFeeder:
    def __init__(self):
        # Takımların ligdeki ortalama hücum ve savunma güç katsayıları
        self.team_database = {
            "Manchester City": {"xg_for": 2.30, "xg_against": 0.85, "rest_days": 4},
            "Liverpool": {"xg_for": 2.10, "xg_against": 1.05, "rest_days": 3},
            "Arsenal": {"xg_for": 2.05, "xg_against": 0.80, "rest_days": 5},
            "Chelsea": {"xg_for": 1.65, "xg_against": 1.35, "rest_days": 4},
            "Real Madrid": {"xg_for": 2.20, "xg_against": 0.95, "rest_days": 4},
            "Atletico Madrid": {"xg_for": 1.55, "xg_against": 0.85, "rest_days": 5},
            "Inter": {"xg_for": 1.95, "xg_against": 0.80, "rest_days": 4},
            "Juventus": {"xg_for": 1.45, "xg_against": 0.75, "rest_days": 6},
            "Galatasaray": {"xg_for": 2.25, "xg_against": 0.90, "rest_days": 5},
            "Fenerbahçe": {"xg_for": 2.15, "xg_against": 0.95, "rest_days": 4},
            "Beşiktaş": {"xg_for": 1.80, "xg_against": 1.15, "rest_days": 3},
            "Trabzonspor": {"xg_for": 1.50, "xg_against": 1.25, "rest_days": 5}
        }

    def enrich_match_data(self, raw_match):
        home = raw_match.get("home_team")
        away = raw_match.get("away_team")

        # Veritabanında varsa al, yoksa lig ortalaması varsayılanı ata
        home_stats = self.team_database.get(home, {"xg_for": 1.45, "xg_against": 1.25, "rest_days": 5})
        away_stats = self.team_database.get(away, {"xg_for": 1.25, "xg_against": 1.45, "rest_days": 5})

        return {
            "match_id": raw_match.get("match_id"),
            "date": raw_match.get("start_time"),
            "league": raw_match.get("league", "Futbol"),
            "home_team": home,
            "away_team": away,
            "home_xg_for": home_stats["xg_for"],
            "home_xg_against": home_stats["xg_against"],
            "home_rest_days": home_stats["rest_days"],
            "away_xg_for": away_stats["xg_for"],
            "away_xg_against": away_stats["xg_against"],
            "away_rest_days": away_stats["rest_days"],
            "odds": raw_match.get("odds", {})
        }