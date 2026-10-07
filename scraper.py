import requests
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

class BulletinScraper:
    def __init__(self):
        # 60+ LİG, YEREL KUPA VE ULUSLARARASI ELEME TURNUVALARI
        self.leagues = {
            # TÜRKİYE
            "Trendyol Süper Lig": "tur.1",
            "Trendyol 1. Lig": "tur.2",
            "Ziraat Türkiye Kupası": "tur.cup",
            
            # İNGİLTERE
            "Premier League": "eng.1",
            "İngiltere Championship": "eng.2",
            "İngiltere League One": "eng.3",
            "İngiltere League Two": "eng.4",
            "FA Cup": "eng.fa",
            "EFL Carabao Cup": "eng.league_cup",
            "EFL Trophy": "eng.trophy",

            # İSPANYA
            "La Liga": "esp.1",
            "La Liga 2": "esp.2",
            "Copa del Rey": "esp.copa_del_rey",

            # İTALYA
            "Serie A": "ita.1",
            "Serie B": "ita.2",
            "Coppa Italia": "ita.coppa_italia",

            # ALMANYA
            "Bundesliga": "ger.1",
            "Bundesliga 2": "ger.2",
            "DFB-Pokal": "ger.dfb_pokal",

            # FRANSA
            "Fransa Ligue 1": "fra.1",
            "Fransa Ligue 2": "fra.2",
            "Coupe de France": "fra.coupe_de_france",

            # AVRUPA DİĞER & KUPALARI
            "Hollanda Eredivisie": "ned.1",
            "Hollanda KNVB Beker": "ned.cup",
            "Portekiz Liga NOS": "por.1",
            "Portekiz Taça de Portugal": "por.cup",
            "Belçika Pro League": "bel.1",
            "Belçika Kupası": "bel.cup",
            "İskoçya Premiership": "sco.1",
            "İskoçya Kupası": "sco.cup",
            "Avusturya Bundesliga": "aut.1",
            "Avusturya Kupası": "aut.cup",
            "İsviçre Süper Ligi": "sui.1",
            "İsviçre Kupası": "sui.cup",
            "Danimarka Superliga": "den.1",
            "Danimarka Kupası": "den.cup",
            "Yunanistan Süper Ligi": "gre.1",
            "Yunanistan Kupası": "gre.cup",

            # UEFA & ULUSLARARASI TURNUVALAR
            "UEFA Şampiyonlar Ligi": "uefa.champions",
            "UEFA Avrupa Ligi": "uefa.europa",
            "UEFA Konferans Ligi": "uefa.europa.conf",
            "UEFA Uluslar Ligi": "uefa.nations",
            "Milli Hazırlık Maçları": "fifa.friendly",
            "Dünya Kupası Elemeleri (Avrupa)": "fifa.worldq.uefa",
            "Dünya Kupası Elemeleri (G.Amerika)": "fifa.worldq.conmebol",

            # GÜNEY AMERİKA & DÜNYA LİGLERİ
            "Copa Libertadores": "conmebol.libertadores",
            "Copa Sudamericana": "conmebol.sudamericana",
            "Brezilya Serie A": "bra.1",
            "Brezilya Serie B": "bra.2",
            "Copa do Brasil": "bra.cup",
            "Arjantin Liga Profesional": "arg.1",
            "Copa Argentina": "arg.cup",
            "Meksika Liga MX": "mex.1",
            "Meksika Copa MX": "mex.cup",
            "ABD MLS": "usa.1",
            "Suudi Arabistan Pro Lig": "ksa.1",
            "Suudi Arabistan Kral Kupası": "ksa.cup",
            "AFC Şampiyonlar Ligi": "afc.champions",
            "Japonya J1 League": "jpn.1"
        }
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }

    def _fetch_single_league(self, league_name, league_slug, now_tsi, max_date_tsi):
        league_matches = []
        url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league_slug}/scoreboard"
        try:
            res = requests.get(url, headers=self.headers, timeout=5)
            if res.status_code != 200:
                return league_matches

            events = res.json().get("events", [])
            for ev in events:
                status_obj = ev.get("status", {})
                type_obj = status_obj.get("type", {})
                state = type_obj.get("state", "pre")

                # Biten maçları bültenden düşür
                if type_obj.get("completed", False) or state == "post":
                    continue

                competition = ev.get("competitions", [{}])[0]
                competitors = competition.get("competitors", [])
                if len(competitors) < 2:
                    continue

                home_c = next((c for c in competitors if c.get("homeAway") == "home"), competitors[0])
                away_c = next((c for c in competitors if c.get("homeAway") == "away"), competitors[1])

                home = home_c.get("team", {}).get("displayName", "")
                away = away_c.get("team", {}).get("displayName", "")
                if not home or not away:
                    continue

                raw_date = ev.get("date", "")
                try:
                    dt_utc = datetime.strptime(raw_date, "%Y-%m-%dT%H:%MZ")
                    dt_tsi = dt_utc + timedelta(hours=3)
                except Exception:
                    continue

                # Başlamasının üzerinden 3 saatten fazla geçmiş maçları ele
                if state == "pre" and dt_tsi < (now_tsi - timedelta(hours=3)):
                    continue

                # 4 günden daha uzak maçları ele
                if state == "pre" and dt_tsi > max_date_tsi:
                    continue

                date_str = dt_tsi.strftime("%Y-%m-%d %H:%M")
                raw_id = str(ev.get("id", ""))
                clean_code = raw_id[-5:] if len(raw_id) >= 5 else raw_id.zfill(5)

                is_live = (state == "in")
                live_clock = status_obj.get("displayClock", "CANLI") if is_live else ""

                try:
                    home_score = int(home_c.get("score") or 0)
                    away_score = int(away_c.get("score") or 0)
                except (ValueError, TypeError):
                    home_score, away_score = 0, 0

                try:
                    home_reds = int(home_c.get("redCards") or 0)
                    away_reds = int(away_c.get("redCards") or 0)
                except (ValueError, TypeError):
                    home_reds, away_reds = 0, 0

                league_matches.append({
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
            pass

        return league_matches

    def fetch_live_bulletin(self):
        all_matches = []
        now_utc = datetime.utcnow()
        now_tsi = now_utc + timedelta(hours=3)
        max_date_tsi = now_tsi + timedelta(days=4)

        # 60+ Turnuvayı 12 İş Parçacığı ile Paralel Çek (Hızlı ve Güvenli)
        with ThreadPoolExecutor(max_workers=12) as executor:
            future_to_league = {
                executor.submit(self._fetch_single_league, name, slug, now_tsi, max_date_tsi): name
                for name, slug in self.leagues.items()
            }
            for future in as_completed(future_to_league):
                try:
                    res = future.result()
                    if res:
                        all_matches.extend(res)
                except Exception:
                    pass

        # Canlı maçları en üste al, ardından başlama saatine göre sırala
        all_matches.sort(key=lambda x: (not x["is_live"], x["start_time"]))
        print(f"-> Global Kupa ve Lig Taraması Tamamlandı: Toplam {len(all_matches)} karşılaşma hazırlandı.")
        return all_matches
