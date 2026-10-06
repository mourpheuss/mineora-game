import json
import requests

class FirebaseSync:
    def __init__(self, database_url):
        """
        :param database_url: Firebase Realtime Database URL'niz.
        Örnek: "https://proje-adiniz-default-rtdb.firebaseio.com" veya "https://proje-adiniz-default-rtdb.europe-west1.firebasedatabase.app"
        """
        # URL'in sonundaki '/' işaretini temizle
        self.database_url = database_url.rstrip("/")

    def push_analyzed_matches(self, matches_data):
        """
        Analiz edilmiş maç verilerini Realtime Database'in 'analyzed_matches' düğümüne yazar.
        """
        endpoint = f"{self.database_url}/analyzed_matches.json"
        
        try:
            # PUT isteği mevcut listeyi taze analizle tamamen günceller
            response = requests.put(endpoint, json=matches_data, timeout=10)
            
            if response.status_code == 200:
                print(f"[FIREBASE BAŞARILI] {len(matches_data)} karşılaşma veritabanına aktarıldı.")
                return True
            else:
                print(f"[FIREBASE HATA] Yanıt Kodu: {response.status_code}, Detay: {response.text}")
                return False
        except Exception as error:
            print(f"[FIREBASE BAĞLANTI HATASI] {error}")
            return False


# --- TEST ÇALIŞTIRMASI ---
if __name__ == "__main__":
    # Kendi Firebase Database URL'nizi buraya yazarak test edebilirsiniz
    TEST_URL = "https://mine-analiz-system-default-rtdb.firebaseio.com"
    
    sync = FirebaseSync(TEST_URL)
    
    # Test verisi
    dummy_data = [
        {
            "match_id": "TEST_01",
            "match": "Sistem Bağlantı Testi",
            "status": "BAĞLANTI AKTİF",
            "entropy": 1.10,
            "expected_goals": {"home": 2.0, "away": 1.0},
            "probabilities": {"home_win": 50, "draw": 25, "away_win": 25, "over_25": 55},
            "value_scenarios": []
        }
    ]
    
    print("Firebase bağlantısı test ediliyor...")
    sync.push_analyzed_matches(dummy_data)