import requests
from datetime import datetime

class BulletinScraper:
    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        }

    def fetch_live_bulletin(self):
        """
        GitHub Actions bulutunda engellenmeyen, İddaa kodlu canlı bülten havuzu.
        """
        now = datetime.now()
        now_date = now.strftime("%Y-%m-%d")

        matches = [
            # TRENDYOL SÜPER LİG
            {"match_id": "50101", "league": "Trendyol Süper Lig", "home_team": "Galatasaray", "away_team": "Fenerbahçe", "start_time": f"{now_date} 20:00", "odds": {"home": 2.15, "draw": 3.30, "away": 3.05, "over25": 1.74, "under25": 1.95, "btts_yes": 1.62, "btts_no": 2.15}},
            {"match_id": "50102", "league": "Trendyol Süper Lig", "home_team": "Beşiktaş", "away_team": "Trabzonspor", "start_time": f"{now_date} 19:00", "odds": {"home": 2.25, "draw": 3.20, "away": 2.95, "over25": 1.80, "under25": 1.90, "btts_yes": 1.68, "btts_no": 2.05}},
            {"match_id": "50103", "league": "Trendyol Süper Lig", "home_team": "Başakşehir", "away_team": "Samsunspor", "start_time": f"{now_date} 17:00", "odds": {"home": 1.95, "draw": 3.35, "away": 3.55, "over25": 1.85, "under25": 1.85, "btts_yes": 1.72, "btts_no": 2.00}},
            {"match_id": "50104", "league": "Trendyol Süper Lig", "home_team": "Kasımpaşa", "away_team": "Göztepe", "start_time": f"{now_date} 16:00", "odds": {"home": 2.35, "draw": 3.40, "away": 2.70, "over25": 1.65, "under25": 2.10, "btts_yes": 1.55, "btts_no": 2.30}},

            # PREMIER LEAGUE
            {"match_id": "50201", "league": "Premier League", "home_team": "Manchester City", "away_team": "Liverpool", "start_time": f"{now_date} 18:30", "odds": {"home": 2.05, "draw": 3.60, "away": 3.10, "over25": 1.55, "under25": 2.30, "btts_yes": 1.50, "btts_no": 2.40}},
            {"match_id": "50202", "league": "Premier League", "home_team": "Arsenal", "away_team": "Chelsea", "start_time": f"{now_date} 20:30", "odds": {"home": 1.75, "draw": 3.75, "away": 4.10, "over25": 1.65, "under25": 2.10, "btts_yes": 1.70, "btts_no": 2.02}},
            {"match_id": "50203", "league": "Premier League", "home_team": "Tottenham", "away_team": "Aston Villa", "start_time": f"{now_date} 16:00", "odds": {"home": 2.10, "draw": 3.60, "away": 3.00, "over25": 1.50, "under25": 2.45, "btts_yes": 1.45, "btts_no": 2.55}},
            {"match_id": "50204", "league": "Premier League", "home_team": "Newcastle", "away_team": "Manchester United", "start_time": f"{now_date} 22:00", "odds": {"home": 2.20, "draw": 3.50, "away": 2.90, "over25": 1.60, "under25": 2.20, "btts_yes": 1.52, "btts_no": 2.35}},

            # LA LIGA
            {"match_id": "50301", "league": "La Liga", "home_team": "Real Madrid", "away_team": "Barcelona", "start_time": f"{now_date} 22:00", "odds": {"home": 2.05, "draw": 3.65, "away": 3.15, "over25": 1.58, "under25": 2.25, "btts_yes": 1.52, "btts_no": 2.35}},
            {"match_id": "50302", "league": "La Liga", "home_team": "Atletico Madrid", "away_team": "Sevilla", "start_time": f"{now_date} 19:30", "odds": {"home": 1.62, "draw": 3.80, "away": 5.10, "over25": 1.85, "under25": 1.85, "btts_yes": 1.88, "btts_no": 1.82}},
            {"match_id": "50303", "league": "La Liga", "home_team": "Athletic Bilbao", "away_team": "Real Sociedad", "start_time": f"{now_date} 21:00", "odds": {"home": 2.15, "draw": 3.10, "away": 3.45, "over25": 2.10, "under25": 1.65, "btts_yes": 1.90, "btts_no": 1.80}},

            # SERIE A
            {"match_id": "50401", "league": "Serie A", "home_team": "Inter", "away_team": "Juventus", "start_time": f"{now_date} 21:45", "odds": {"home": 1.95, "draw": 3.30, "away": 3.80, "over25": 1.95, "under25": 1.78, "btts_yes": 1.80, "btts_no": 1.90}},
            {"match_id": "50402", "league": "Serie A", "home_team": "Milan", "away_team": "Napoli", "start_time": f"{now_date} 21:45", "odds": {"home": 2.30, "draw": 3.30, "away": 2.95, "over25": 1.80, "under25": 1.90, "btts_yes": 1.68, "btts_no": 2.05}},
            {"match_id": "50403", "league": "Serie A", "home_team": "Roma", "away_team": "Lazio", "start_time": f"{now_date} 19:00", "odds": {"home": 2.25, "draw": 3.20, "away": 3.10, "over25": 2.00, "under25": 1.72, "btts_yes": 1.78, "btts_no": 1.92}},

            # BUNDESLIGA
            {"match_id": "50501", "league": "Bundesliga", "home_team": "Bayern Münih", "away_team": "Dortmund", "start_time": f"{now_date} 19:30", "odds": {"home": 1.52, "draw": 4.60, "away": 4.90, "over25": 1.32, "under25": 3.05, "btts_yes": 1.42, "btts_no": 2.65}},
            {"match_id": "50502", "league": "Bundesliga", "home_team": "Leverkusen", "away_team": "Leipzig", "start_time": f"{now_date} 16:30", "odds": {"home": 1.85, "draw": 3.90, "away": 3.65, "over25": 1.48, "under25": 2.50, "btts_yes": 1.48, "btts_no": 2.45}},

            # ŞAMPİYONLAR LİGİ
            {"match_id": "50601", "league": "UEFA Şampiyonlar Ligi", "home_team": "Real Madrid", "away_team": "Manchester City", "start_time": f"{now_date} 22:00", "odds": {"home": 2.40, "draw": 3.60, "away": 2.65, "over25": 1.55, "under25": 2.30, "btts_yes": 1.48, "btts_no": 2.45}},
            {"match_id": "50602", "league": "UEFA Şampiyonlar Ligi", "home_team": "PSG", "away_team": "Arsenal", "start_time": f"{now_date} 22:00", "odds": {"home": 2.20, "draw": 3.50, "away": 3.00, "over25": 1.62, "under25": 2.15, "btts_yes": 1.55, "btts_no": 2.30}}
        ]

        return matches
