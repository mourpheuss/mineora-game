import json
from scraper import BulletinScraper
from stats_feeder import StatsFeeder
from engine import SportsAnalyticsEngine
from firebase_sync import FirebaseSync

FIREBASE_DATABASE_URL = "https://mineora-web-default-rtdb.firebaseio.com"

def run_scientific_pipeline():
    print("=" * 60)
    print("MAS PIPELINE ÇALIŞTIRILIYOR (5 DAKİKALIK DÖNGÜ)")
    print("=" * 60)

    scraper = BulletinScraper()
    feeder = StatsFeeder()
    engine = SportsAnalyticsEngine()

    raw_matches = scraper.fetch_live_bulletin()
    print(f"-> Toplam {len(raw_matches)} maç bültenden çekildi.")

    # GÜVENLİK KİLİDİ: Eğer API boş dönerse veritabanını ASLA silme!
    if not raw_matches or len(raw_matches) == 0:
        print("[KRİTİK UYARI] Bülten boş döndü, mevcut Firebase verisi korunuyor!")
        return

    analyzed_matches = []
    value_count = 0

    for match in raw_matches:
        enriched_match = feeder.enrich_match_data(match)
        analysis = engine.analyze_match(enriched_match)
        
        analysis["match_id"] = enriched_match.get("match_id", "40100")
        analysis["date"] = enriched_match.get("start_time", enriched_match.get("date", ""))
        analysis["league"] = enriched_match.get("league", "Futbol")
        analysis["odds"] = enriched_match.get("odds", {})

        if len(analysis.get("value_scenarios", [])) > 0:
            value_count += 1

        analyzed_matches.append(analysis)

    print(f"-> Analiz Edilen: {len(analyzed_matches)}, +EV Bulunan: {value_count}")

    # Firebase'e Aktar
    fb = FirebaseSync(FIREBASE_DATABASE_URL)
    fb.push_analyzed_matches(analyzed_matches)
    print("-> Firebase senkronizasyonu tamamlandı.")
    print("=" * 60)

if __name__ == "__main__":
    run_scientific_pipeline()
