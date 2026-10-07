import requests
from datetime import datetime, timedelta

class BulletinScraper:
    def __init__(self):
        self.leagues = {
            # TÜRKİYE
            "Trendyol Süper Lig": "tur.1",
            "Trendyol 1. Lig": "tur.2",
            
            # İNGİLTERE
            "Premier League": "eng.1",
            "İngiltere Championship": "eng.2",
            "İngiltere League One": "eng.3",
            
            # İSPANYA
            "La Liga": "esp.1",
            "La Liga 2": "esp.2",
            
            # İTALYA
            "Serie A": "ita.1",
            "Serie B": "ita.2",
            
            # ALMANYA
            "Bundesliga": "ger.1",
            "Bundesliga 2": "ger.2",
            
            # FRANSA
            "Fransa Ligue 1": "fra.1",
            "Fransa Ligue 2": "fra.2",
            
            # DİĞER AVRUPA
            "Hollanda Eredivisie": "ned.1",
            "Portekiz Liga NOS": "por.1",
            "Belçika Pro League": "bel.1",
            "İskoçya Premiership": "sco.1",
            "Avusturya Bundesliga": "aut.1",
            "İsviçre Süper Ligi": "sui.1",
            "Danimarka Superliga": "den.1",
            "Yunanistan Süper Ligi": "gre.1",
            
            # AVRUPA KUPALARI
            "UEFA Şampiyonlar Ligi": "uefa.champions",
            "UEFA Avrupa Ligi": "uefa.europa",
            "UEFA Konferans Ligi": "uefa.europa.conf",

            # DÜNYA LİGLERİ
            "Suudi Arabistan Pro Lig": "ksa.1",
            "Brezilya Serie A": "bra.1"
        }
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json"
        }

    def fetch_live_bulletin(self):
        all_matches = []
        now_utc = datetime.utcnow()
        now_tsi = now_utc + timedelta(hours=3) # Türkiye Saati (TSİ)
        max_date_tsi = now_tsi + timedelta(days=4) # En fazla 4 gün ilerisi

        for league_name, league_slug in self.leagues.items():
            url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league_slug}/scoreboard"
            try:
                res = requests.get(url, headers=self.headers, timeout=8)
                if res.status_code != 200:
                    continue

                events = res.json().get("events", [])
                for ev in events:
                    # 1. KONTROL: BİTMİŞ MAÇLARI KESİNLİKLE ELE
                    status = ev.get("status", {}).get("type", {})
                    if status.get("completed", False) or status.get("state") == "post":
                        continue

                    competition = ev.get("competitions", [{}])[0]
                    competitors = competition.get("competitors", [])
                    if len(competitors) < 2:
                        continue

                    home = next((c["team"]["displayName"] for c in competitors if c.get("homeAway") == "home"), competitors[0]["team"]["displayName"])
                    away = next((c["team"]["displayName"] for c in competitors if c.get("homeAway") == "away"), competitors[1]["team"]["displayName"])

                    if not home or not away:
                        continue

                    # 2. KONTROL: SAAT & TARİH FİLTRESİ
                    raw_date = ev.get("date", "")
                    try:
                        dt_utc = datetime.strptime(raw_date, "%Y-%m-%dT%H:%MZ")
                        dt_tsi = dt_utc + timedelta(hours=3)
                    except Exception:
                        continue

                    # Oynanıp bitmiş (geçmiş) veya başlamasının üzerinden 2 saat geçmiş maçları ele
                    if dt_tsi < (now_tsi - timedelta(hours=2)):
                        continue

                    # 4 günden daha ileri tarihli maçları ele (Bülteni temiz tut)
                    if dt_tsi > max_date_tsi:
                        continue

                    date_str = dt_tsi.strftime("%Y-%m-%d %H:%M")

                    # 3. KONTROL: 5 HANELİ TEMİZ İDDAA KODU ÜRETİMİ
                    raw_id = str(ev.get("id", ""))
                    clean_code = raw_id[-5:] if len(raw_id) >= 5 else raw_id.zfill(5)

                    all_matches.append({
                        "match_id": clean_code,
                        "league": league_name,
                        "home_team": home,
                        "away_team": away,
                        "start_time": date_str
                    })

            except Exception as e:
                continue

        # Tarihe göre kronolojik sırala (En yakın maç en üstte)
        all_matches.sort(key=lambda x: x["start_time"])
        print(f"-> Filtrelenmiş Aktif Canlı Bülten: {len(all_matches)} karşılaşma hazırlandı.")
        return all_matches
