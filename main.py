from scraper import BulletinScraper
from stats_feeder import StatsFeeder
from engine import SportsAnalyticsEngine
from firebase_sync import FirebaseSync
import requests

FIREBASE_DATABASE_URL = "https://mineora-web-default-rtdb.firebaseio.com"

def verify_and_update_successes(scraper, feeder, engine):
    """
    Tüm liglerde son 24 saatte biten maçları tarar.
    Olası veri bozukluklarında kesinlikle çökmez, güvenle Firebase'e yazar.
    """
    print("-> Biten maçlar taranıyor...")
    verified_successes = []

    for league_name, league_slug in scraper.leagues.items():
        url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league_slug}/scoreboard"
        try:
            res = requests.get(url, headers=scraper.headers, timeout=8)
            if res.status_code != 200:
                continue

            events = res.json().get("events", [])
            for ev in events:
                try:
                    status_obj = ev.get("status", {})
                    type_obj = status_obj.get("type", {})
                    
                    if not (type_obj.get("completed", False) or type_obj.get("state") == "post"):
                        continue

                    competition = ev.get("competitions", [{}])[0]
                    competitors = competition.get("competitors", [])
                    if len(competitors) < 2:
                        continue

                    home_c = next((c for c in competitors if c.get("homeAway") == "home"), competitors[0])
                    away_c = next((c for c in competitors if c.get("homeAway") == "away"), competitors[1])

                    home = home_c.get("team", {}).get("displayName", "Ev Sahibi")
                    away = away_c.get("team", {}).get("displayName", "Deplasman")
                    
                    # Güvenli skor ayrıştırma
                    try:
                        h_score = int(home_c.get("score") or 0)
                        a_score = int(away_c.get("score") or 0)
                    except (ValueError, TypeError):
                        continue

                    tot_goals = h_score + a_score

                    # Analiz motorunu çalıştır
                    mock_match = {"league": league_name, "home_team": home, "away_team": away, "is_live": False}
                    enriched = feeder.enrich_match_data(mock_match)
                    result = engine.analyze_match(enriched)
                    analysis = result.get("analysis", {})

                    pick_str = None
                    o25_prob = analysis.get("over_25", 0.0)
                    ms_h_prob = analysis.get("ms_home", 0.0)
                    ms_a_prob = analysis.get("ms_away", 0.0)
                    btts_prob = analysis.get("btts_yes", 0.0)

                    if o25_prob >= 60.0 and tot_goals > 2.5:
                        pick_str = f"2.5 Gol Üstü (%{o25_prob})"
                    elif (100.0 - o25_prob) >= 60.0 and tot_goals < 2.5:
                        pick_str = f"2.5 Gol Altı (%{round(100.0 - o25_prob, 1)})"
                    elif ms_h_prob >= 62.0 and h_score > a_score:
                        pick_str = f"MS 1: {home} (%{ms_h_prob})"
                    elif ms_a_prob >= 58.0 and a_score > h_score:
                        pick_str = f"MS 2: {away} (%{ms_a_prob})"
                    elif btts_prob >= 60.0 and h_score > 0 and a_score > 0:
                        pick_str = f"Karşılıklı Gol: VAR (%{btts_prob})"

                    if pick_str:
                        verified_successes.append({
                            "league": league_name,
                            "match": f"{home} vs {away}",
                            "score": f"{h_score} - {a_score}",
                            "pick": pick_str,
                            "status": "TUTTU",
                            "timestamp": ev.get("date", "")
                        })
                except Exception:
                    continue

        except Exception:
            continue

    if verified_successes:
        try:
            verified_successes.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
            top_successes = verified_successes[:8]
            requests.put(f"{FIREBASE_DATABASE_URL}/completed_successes.json", json=top_successes, timeout=6)
            print(f"-> Başarı Vitrini Güncellendi: {len(top_successes)} adet tescilli maç kaydedildi.")
        except Exception as e:
            print(f"[UYARI] Başarı vitrini Firebase'e yazılamadı: {e}")
    else:
        print("-> Yeni tescilli maç bulunamadı.")


def run_scientific_pipeline():
    print("=" * 60)
    print("MAS OTOMATİK VERİ VE BAŞARI DOĞRULAMA DÖNGÜSÜ")
    print("=" * 60)

    scraper = BulletinScraper()
    feeder = StatsFeeder()
    engine = SportsAnalyticsEngine()

    # 1. CANLI VE YAKLAŞAN MAÇLAR
    try:
        raw_matches = scraper.fetch_live_bulletin()
        print(f"-> Toplam {len(raw_matches)} bülten maçı çekildi.")

        if raw_matches:
            analyzed_matches = []
            for match in raw_matches:
                try:
                    enriched_match = feeder.enrich_match_data(match)
                    result = engine.analyze_match(enriched_match)
                    
                    result["match_id"] = enriched_match.get("match_id", "40100")
                    result["date"] = enriched_match.get("start_time", "")
                    result["league"] = enriched_match.get("league", "Futbol")
                    result["is_live"] = enriched_match.get("is_live", False)
                    result["live_clock"] = enriched_match.get("live_clock", "")
                    result["home_score"] = enriched_match.get("home_score", 0)
                    result["away_score"] = enriched_match.get("away_score", 0)
                    result["home_reds"] = enriched_match.get("home_reds", 0)
                    result["away_reds"] = enriched_match.get("away_reds", 0)

                    analyzed_matches.append(result)
                except Exception as e:
                    print(f"[UYARI] Tekil maç analizinde hata atlandı: {e}")
                    continue

            fb = FirebaseSync(FIREBASE_DATABASE_URL)
            fb.push_analyzed_matches(analyzed_matches)
    except Exception as e:
        print(f"[HATA] Bülten analizi genel döngüsünde hata: {e}")

    # 2. BİTEN MAÇLARI DOĞRULA
    try:
        verify_and_update_successes(scraper, feeder, engine)
    except Exception as e:
        print(f"[HATA] Başarı doğrulayıcı çalıştırılamadı: {e}")

    print("=" * 60)

if __name__ == "__main__":
    run_scientific_pipeline()
