import json
import time
from scraper import BulletinScraper
from stats_feeder import StatsFeeder
from engine import SportsAnalyticsEngine
from firebase_sync import FirebaseSync

# TEK 'https://' OLDUĞUNDAN EMİN OLUNMUŞ BAĞLANTI:
FIREBASE_DATABASE_URL = "https://mineora-web-default-rtdb.firebaseio.com"

def run_scientific_pipeline():
    print("=" * 60)
    print("MINE ANALİZ SYSTEM (MAS) - PIPELINE ÇALIŞTIRILIYOR")
    print("=" * 60)

    scraper = BulletinScraper()
    feeder = StatsFeeder()
    engine = SportsAnalyticsEngine()

    print("\n[1/4] İddaa bülteni taranıyor...")
    raw_matches = scraper.fetch_live_bulletin()
    print(f"-> Toplam {len(raw_matches)} maç bültenden çekildi.")

    analyzed_matches = []
    value_count = 0

    print("\n[2/4] Dixon-Coles simülasyonu ve +EV taraması yapılıyor...")
    for match in raw_matches:
        enriched_match = feeder.enrich_match_data(match)
        analysis = engine.analyze_match(enriched_match)
        analysis["match_id"] = enriched_match["match_id"]
        analysis["date"] = enriched_match["date"]

        if len(analysis.get("value_scenarios", [])) > 0:
            value_count += 1

        # Arayüzdeki 'Tüm Bülten' filtresinin dolu görünmesi için tüm analizleri listeye alıyoruz
        analyzed_matches.append(analysis)

    print("\n[3/4] Süzgeç Tamamlandı:")
    print(f"-> Analiz Edilen: {len(raw_matches)}")
    print(f"-> Pozitif Değer (+EV) Tespit Edilen: {value_count}")

    # 1. Yerel JSON çıktısı
    output_file = "analiz_raporu.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(analyzed_matches, f, indent=4, ensure_ascii=False)
    print(f"-> Sonuçlar '{output_file}' dosyasına yazıldı.")

    # 2. Firebase Bulut Aktarımı
    print("\n[4/4] Firebase Realtime Database senkronizasyonu başlatılıyor...")
    fb = FirebaseSync(FIREBASE_DATABASE_URL)
    fb.push_analyzed_matches(analyzed_matches)

    print("=" * 60)

if __name__ == "__main__":
    run_scientific_pipeline()