from scraper import BulletinScraper
from stats_feeder import StatsFeeder
from engine import SportsAnalyticsEngine
from firebase_sync import FirebaseSync

FIREBASE_DATABASE_URL = "https://mineora-web-default-rtdb.firebaseio.com"

def run_scientific_pipeline():
    print("=" * 60)
    print("MAS PROFESYONEL ANALİZ MOTORU ÇALIŞTIRILIYOR")
    print("=" * 60)

    scraper = BulletinScraper()
    feeder = StatsFeeder()
    engine = SportsAnalyticsEngine()

    raw_matches = scraper.fetch_live_bulletin()
    print(f"-> Toplam {len(raw_matches)} bülten maçı çekildi.")

    if not raw_matches or len(raw_matches) == 0:
        print("[UYARI] Bülten boş döndü, mevcut Firebase verisi korundu.")
        return

    analyzed_matches = []

    for match in raw_matches:
        enriched_match = feeder.enrich_match_data(match)
        result = engine.analyze_match(enriched_match)
        
        # Arayüze gerekli tüm kimlik bilgileri
        result["match_id"] = enriched_match.get("match_id", "40100")
        result["date"] = enriched_match.get("start_time", "")
        result["league"] = enriched_match.get("league", "Futbol")

        analyzed_matches.append(result)

    print(f"-> Toplam {len(analyzed_matches)} maçın İY, 2Y, MS, Gol ve Kadro analizleri tamamlandı.")

    fb = FirebaseSync(FIREBASE_DATABASE_URL)
    fb.push_analyzed_matches(analyzed_matches)
    print("-> Analizler Firebase'e aktarıldı.")
    print("=" * 60)

if __name__ == "__main__":
    run_scientific_pipeline()
