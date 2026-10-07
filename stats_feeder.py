import requests
import re
import unicodedata

class StatsFeeder:
    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
        self.league_slugs = {
            "Trendyol Süper Lig": "tur.1",
            "Trendyol 1. Lig": "tur.2",
            "Premier League": "eng.1",
            "La Liga": "esp.1",
            "Serie A": "ita.1",
            "Bundesliga": "ger.1",
            "Fransa Ligue 1": "fra.1",
            "Hollanda Eredivisie": "ned.1",
            "Portekiz Liga NOS": "por.1",
            "İngiltere Championship": "eng.2"
        }
        self.standings_cache = {}

    def _normalize(self, text):
        if not text: return ""
        text = text.replace("İ", "I").replace("ı", "i")
        n = unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('utf-8')
        return re.sub(r'[^a-zA-Z0-9]', '', n).lower()

    def fetch_league_standings(self, league_name):
        if league_name in self.standings_cache:
            return self.standings_cache[league_name]

        slug = self.league_slugs.get(league_name)
        if not slug:
            return {}

        url = f"https://site.web.api.espn.com/apis/v2/sports/soccer/{slug}/standings"
        table = {}

        try:
            res = requests.get(url, headers=self.headers, timeout=8)
            if res.status_code == 200:
                data = res.json()
                entries = []
                if "children" in data and len(data["children"]) > 0:
                    entries = data["children"][0].get("standings", {}).get("entries", [])
                elif "standings" in data:
                    entries = data["standings"].get("entries", [])

                for idx, entry in enumerate(entries):
                    t_info = entry.get("team", {})
                    t_name = t_info.get("displayName", "")
                    norm_name = self._normalize(t_name)

                    stats_list = {s.get("name"): s for s in entry.get("stats", [])}
                    
                    rank = int(stats_list.get("rank", {}).get("value", idx + 1))
                    points = int(stats_list.get("points", {}).get("value", 0))
                    played = int(stats_list.get("gamesPlayed", {}).get("value", 1))
                    gf = float(stats_list.get("pointsFor", {}).get("value", 0))
                    ga = float(stats_list.get("pointsAgainst", {}).get("value", 0))

                    raw_form = stats_list.get("form", {}).get("displayValue", "")
                    form_list = []
                    if raw_form:
                        for ch in raw_form.replace(",", "").upper()[:5]:
                            if ch == 'W': form_list.append('G')
                            elif ch == 'D': form_list.append('B')
                            elif ch == 'L': form_list.append('M')
                    if not form_list:
                        form_list = ["G", "B", "G", "M", "G"]

                    table[norm_name] = {
                        "display_name": t_name,
                        "rank": rank,
                        "points": points,
                        "played": played,
                        "avg_scored": round(gf / max(1, played), 2),
                        "avg_conceded": round(ga / max(1, played), 2),
                        "form": form_list
                    }

                self.standings_cache[league_name] = table
        except Exception:
            pass

        return table

    def _calc_form_factor(self, form_list):
        """Son 5 maçın form puanını hesaplar (G=3, B=1, M=0)"""
        pts = sum(3 if x == 'G' else (1 if x == 'B' else 0) for x in form_list)
        # 15 üzerinden ortalama 7.5 puana göre %15 yukarı/aşağı çarpan
        return round(1.0 + ((pts - 7.5) * 0.015), 2)

    def enrich_match_data(self, match):
        league = match.get("league", "")
        home_team = match.get("home_team", "")
        away_team = match.get("away_team", "")

        table = self.fetch_league_standings(league)

        norm_h = self._normalize(home_team)
        norm_a = self._normalize(away_team)

        h_data = table.get(norm_h) or next((v for k, v in table.items() if k in norm_h or norm_h in k), None)
        a_data = table.get(norm_a) or next((v for k, v in table.items() if k in norm_a or norm_a in k), None)

        h_form = h_data["form"] if h_data else ["G", "B", "G", "M", "G"]
        a_form = a_data["form"] if a_data else ["M", "B", "G", "M", "B"]

        h_form_factor = self._calc_form_factor(h_form)
        a_form_factor = self._calc_form_factor(a_form)

        # İç Saha / Dış Saha ve Form Kalibrasyonlu xG Hesabı
        h_base = float(h_data["avg_scored"]) if h_data else 1.45
        a_conc = float(a_data["avg_conceded"]) if a_data else 1.30
        home_calc_xg = round((h_base * a_conc / 1.30) * 1.15 * h_form_factor, 2)

        a_base = float(a_data["avg_scored"]) if a_data else 1.20
        h_conc = float(h_data["avg_conceded"]) if h_data else 1.15
        away_calc_xg = round((a_base * h_conc / 1.30) * 0.88 * a_form_factor, 2)

        match["home_stats"] = {
            "rank": h_data["rank"] if h_data else "-",
            "points": h_data["points"] if h_data else "-",
            "form": h_form,
            "calc_xg": max(0.45, home_calc_xg)
        }

        match["away_stats"] = {
            "rank": a_data["rank"] if a_data else "-",
            "points": a_data["points"] if a_data else "-",
            "form": a_form,
            "calc_xg": max(0.35, away_calc_xg)
        }

        return match
