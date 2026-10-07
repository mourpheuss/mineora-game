class StatsFeeder:
    def __init__(self):
        # Takımların genel lig güç profilleri (1-20 arası sıralama bazlı)
        self.team_ratings = {
            "Galatasaray": {"rank": 1, "xg": 2.25, "missing": "Sakat: Icardi (Hafif)"},
            "Fenerbahçe": {"rank": 2, "xg": 2.15, "missing": "Tam Kadro"},
            "Beşiktaş": {"rank": 3, "xg": 1.85, "missing": "1 Cezalı Oyuncu"},
            "Trabzonspor": {"rank": 4, "xg": 1.60, "missing": "Sakat: 2 Oyuncu"},
            "Başakşehir": {"rank": 5, "xg": 1.55, "missing": "Tam Kadro"},
            "Kasımpaşa": {"rank": 9, "xg": 1.25, "missing": "Sakat: 1 As Kaleci"},
            "Manchester City": {"rank": 1, "xg": 2.45, "missing": "Tam Kadro"},
            "Liverpool": {"rank": 2, "xg": 2.30, "missing": "Sakat: Alisson"},
            "Arsenal": {"rank": 3, "xg": 2.20, "missing": "Sakat: Odegaard"},
            "Real Madrid": {"rank": 1, "xg": 2.40, "missing": "Sakat: Courtois"},
            "Barcelona": {"rank": 2, "xg": 2.35, "missing": "Tam Kadro"},
            "Bayern Münih": {"rank": 1, "xg": 2.65, "missing": "Tam Kadro"},
            "Inter": {"rank": 1, "xg": 2.10, "missing": "1 Cezalı Oyuncu"}
        }

    def enrich_match_data(self, match):
        h_name = match.get("home_team", "")
        a_name = match.get("away_team", "")

        # Ev Sahibi Profili
        h_prof = self.team_ratings.get(h_name, {
            "rank": 6 + (abs(hash(h_name)) % 10),
            "xg": 1.45 + (abs(hash(h_name)) % 40) / 100.0,
            "missing": "Kadroda Kritik Eksik Yok"
        })

        # Deplasman Profili
        a_prof = self.team_ratings.get(a_name, {
            "rank": 7 + (abs(hash(a_name)) % 10),
            "xg": 1.15 + (abs(hash(a_name)) % 40) / 100.0,
            "missing": "1 Önemli Eksik"
        })

        # Son 5 maç form dizisi simülasyonu
        forms = [["G", "G", "B", "G", "G"], ["G", "B", "G", "M", "G"], ["B", "M", "B", "G", "M"], ["G", "G", "M", "B", "G"]]

        match["home_stats"] = {
            "rank": h_prof["rank"],
            "calc_xg": h_prof["xg"],
            "form": forms[abs(hash(h_name)) % len(forms)],
            "missing": h_prof["missing"]
        }
        match["away_stats"] = {
            "rank": a_prof["rank"],
            "calc_xg": a_prof["xg"],
            "form": forms[abs(hash(a_name)) % len(forms)],
            "missing": a_prof["missing"]
        }

        return match
