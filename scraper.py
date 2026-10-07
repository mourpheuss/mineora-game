import requests
from datetime import datetime, timedelta

class BulletinScraper:
    def __init__(self):
        self.leagues = {
            "Trendyol Süper Lig": "tur.1",
            "Trendyol 1. Lig": "tur.2",
            "Premier League": "eng.1",
            "İngiltere Championship": "eng.2",
            "La Liga": "esp.1",
            "La Liga 2": "esp.2",
            "Serie A": "ita.1",
            "Serie B": "ita.2",
            "Bundesliga": "ger.1",
            "Bundesliga 2": "ger.2",
            "Fransa Ligue 1": "fra.1",
            "Hollanda Eredivisie": "ned.1",
            "Portekiz Liga NOS": "por.1",
            "Belçika Pro League": "bel.1",
            "İskoçya Premiership": "sco.1",
            "UEFA Şampiyonlar Ligi": "uefa.champions",
            "UEFA Avrupa Ligi": "uefa.europa",
            "UEFA Konferans Ligi": "uefa.europa.conf",
            "Suudi Arabistan Pro Lig": "ksa.1",
            "Brezilya Serie A": "bra.1"
        }
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }

    def fetch_live_bulletin(self):
        all_matches = []
        now_utc = datetime.utcnow()
        now_tsi = now_utc + timedelta(hours=3)
        max_date_tsi = now_tsi + timedelta(days=4)

        for league_name, league_slug in self.leagues.items():
            url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league_slug}/scoreboard"
            try:
                res = requests.get(url, headers=self.headers, timeout=8)
                if res.status_code != 200:
                    continue

                events = res.json().get("events", [])
                for ev in events:
                    status_obj = ev.get("status", {})
                    type_obj = status_obj.get("type", {})
                    state = type_obj.get("state", "pre") # pre, in, post

                    # Biten maçları ele
                    if type_obj.get("completed", False) or state == "post":
                        continue

                    competition = ev.get("competitions", [{}])[0]
                    competitors = competition.get("competitors", [])
                    if len(competitors) < 2:
                        continue

                    home_c = next((c for c in competitors if c.get("homeAway") == "home"), competitors[0])
                    away_c = next((c for c in competitors if c.get("homeAway") == "away"), competitors[1])

                    home = home_c["team"]["displayName"]
                    away = away_c["team"]["displayName"]
                    if not home or not away:
                        continue

                    # Tarih & Saat
                    raw_date = ev.get("date", "")
                    try:
                        dt_utc = datetime.strptime(raw_date, "%Y-%m-%dT%H:%MZ")
                        dt_tsi = dt_utc + timedelta(hours=3)
                    except Exception:
                        continue

                    if state == "pre" and dt_tsi > max_date_tsi:
                        continue

                    date_str = dt_tsi.strftime("%Y-%m-%d %H:%M")
                    raw_id = str(ev.get("id", ""))
                    clean_code = raw_id[-5:] if len(raw_id) >= 5 else raw_id.zfill(5)

                    # CANLI MAÇ BİLGİLERİ (SKOR, DAKİKA, KIRMIZI KART)
                    is_live = (state == "in")
                    live_clock = status_obj.get("displayClock", "0'") if is_live else ""
                    
                    home_score = int(home_c.get("score", 0)) if is_live else 0
                    away_score = int(away_c.get("score", 0)) if is_live else 0

                    # Kırmızı Kart Sayısı (Varsa)
                    home_reds = int(home_c.get("redCards", 0))
                    away_reds = int(away_c.get("redCards", 0))

                    all_matches.append({
                        "match_id": clean_code,
                        "league": league_name,
                        "home_team": home,
                        "away_team": away,
                        "start_time": date_str,
                        "is_live": is_live,
                        "live_clock": live_clock,
                        "home_score": home_score,
                        "away_score": away_score,
                        "home_reds": home_reds,
                        "away_reds": away_reds
                    })

            except Exception:
                continue

        # Canlı maçları en üste al, ardından başlama saatine göre sırala
        all_matches.sort(key=lambda x: (not x["is_live"], x["start_time"]))
        print(f"-> Canlı ve Fikstür Taraması: Toplam {len(all_matches)} karşılaşma hazırlandı.")
        return all_matches
