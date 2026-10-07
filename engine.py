import math

class SportsAnalyticsEngine:
    def __init__(self, rho=-0.13):
        self.rho = rho

    def _poisson(self, k, lamb):
        if lamb <= 0:
            return 1.0 if k == 0 else 0.0
        return (math.exp(-lamb) * (lamb ** k)) / math.factorial(k)

    def _dixon_coles_tau(self, x, y, lambda_h, mu_a):
        if x == 0 and y == 0: return 1.0 - (lambda_h * mu_a * self.rho)
        elif x == 0 and y == 1: return 1.0 + (lambda_h * self.rho)
        elif x == 1 and y == 0: return 1.0 + (mu_a * self.rho)
        elif x == 1 and y == 1: return 1.0 - self.rho
        return 1.0

    def _generate_ai_verdict(self, home_team, away_team, ms_h, ms_d, ms_a, o25, btts, h_xg, a_xg):
        """Yapay Zeka Nihai Karar ve Güvenilirlik Süzgeci"""
        # En baskın piyasayı bul
        best_market = ""
        confidence = 70
        reason = ""

        if ms_h >= 62.0:
            best_market = f"Maç Sonu: {home_team} Galibiyeti"
            confidence = int(ms_h * 1.08)
            reason = f"{home_team} iç saha üstünlüğü ve xG beklentisi ({h_xg}) net galibiyet senaryosunu teyit ediyor."
        elif ms_a >= 58.0:
            best_market = f"Maç Sonu: {away_team} Galibiyeti"
            confidence = int(ms_a * 1.1)
            reason = f"{away_team} deplasman hücum üretkenliği rakip savunma zaafiyetine karşı belirgin üstünlük kuruyor."
        elif o25 >= 63.0:
            best_market = "Toplam Gol: 2.5 Üst"
            confidence = int(o25 * 1.12)
            reason = f"Her iki takımın toplam {round(h_xg + a_xg, 2)} gol beklentisi yüksek tempolu ve gollü bir maçı işaret ediyor."
        elif btts >= 61.0:
            best_market = "Karşılıklı Gol: VAR"
            confidence = int(btts * 1.1)
            reason = "Karşılıklı geçiş oyunu zaafiyetleri iki takımın da skor üretme ihtimalini kuvvetlendiriyor."
        elif (100.0 - o25) >= 58.0:
            best_market = "Toplam Gol: 2.5 Alt"
            confidence = int((100.0 - o25) * 1.08)
            reason = "Düşük xG ortalamaları ve kontrollü taktik kurgu kısır bir skor profilini öne çıkarıyor."
        else:
            best_market = "İlk Yarı: Beraberlik (Dengeli Tercih)"
            confidence = 74
            reason = "Kuvvetler dengesi yakın; takımların ilk 45 dakikada temkinli ve savunma ağırlıklı kalması bekleniyor."

        confidence = min(94, max(68, confidence))

        return {
            "pick": best_market,
            "confidence": f"%{confidence}",
            "rationale": reason
        }

    def analyze_match(self, match_data):
        home_team = match_data.get("home_team", "Ev Sahibi")
        away_team = match_data.get("away_team", "Deplasman")
        
        h_stats = match_data.get("home_stats", {})
        a_stats = match_data.get("away_stats", {})

        h_xg = max(0.45, float(h_stats.get("calc_xg", 1.55)))
        a_xg = max(0.35, float(a_stats.get("calc_xg", 1.15)))

        h_1h, a_1h = h_xg * 0.44, a_xg * 0.44
        h_2h, a_2h = h_xg * 0.56, a_xg * 0.56

        ms_h, ms_d, ms_a = 0.0, 0.0, 0.0
        o15, o25, o35 = 0.0, 0.0, 0.0
        btts_yes = 0.0
        matrix = []

        for h in range(7):
            for a in range(7):
                p = max(0.0, self._poisson(h, h_xg) * self._poisson(a, a_xg) * self._dixon_coles_tau(h, a, h_xg, a_xg))
                if h > a: ms_h += p
                elif h == a: ms_d += p
                else: ms_a += p

                tg = h + a
                if tg > 1.5: o15 += p
                if tg > 2.5: o25 += p
                if tg > 3.5: o35 += p
                if h > 0 and a > 0: btts_yes += p

                matrix.append((f"{h}-{a}", p))

        # Devreler
        iy_h, iy_d, iy_a = 0.0, 0.0, 0.0
        for h in range(5):
            for a in range(5):
                p = self._poisson(h, h_1h) * self._poisson(a, a_1h)
                if h > a: iy_h += p
                elif h == a: iy_d += p
                else: iy_a += p

        y2_h, y2_d, y2_a = 0.0, 0.0, 0.0
        for h in range(5):
            for a in range(5):
                p = self._poisson(h, h_2h) * self._poisson(a, a_2h)
                if h > a: y2_h += p
                elif h == a: y2_d += p
                else: y2_a += p

        tot_ms = ms_h + ms_d + ms_a or 1.0
        tot_iy = iy_h + iy_d + iy_a or 1.0
        tot_2y = y2_h + y2_d + y2_a or 1.0

        p_home = round((ms_h / tot_ms) * 100, 1)
        p_draw = round((ms_d / tot_ms) * 100, 1)
        p_away = round((ms_a / tot_ms) * 100, 1)
        p_o25 = round((o25 / tot_ms) * 100, 1)
        p_btts = round((btts_yes / tot_ms) * 100, 1)

        # YAPAY ZEKA FİLTRESİ
        ai_verdict = self._generate_ai_verdict(home_team, away_team, p_home, p_draw, p_away, p_o25, p_btts, h_xg, a_xg)

        # Volatilite kontrolü
        volatility_warning = None
        if abs(p_home - p_away) < 8.0:
            volatility_warning = "YÜKSEK VOLATİLİTE: İki takımın kazanma ihtimali birbirine çok yakın. Modelimiz taraf tercihi yerine Gol / Devre seçeneklerine odaklanmanızı tavsiye eder."

        matrix.sort(key=lambda x: x[1], reverse=True)
        top_scores = [
            {"score": s[0], "prob": f"%{round((s[1]/tot_ms)*100, 1)}"}
            for s in matrix[:3]
        ]

        return {
            "match": f"{home_team} vs {away_team}",
            "home_team": home_team,
            "away_team": away_team,
            "ai_verdict": ai_verdict,
            "volatility_warning": volatility_warning,
            "analysis": {
                "ms_home": p_home,
                "ms_draw": p_draw,
                "ms_away": p_away,
                "iy_home": round((iy_h / tot_iy) * 100, 1),
                "iy_draw": round((iy_d / tot_iy) * 100, 1),
                "iy_away": round((iy_a / tot_iy) * 100, 1),
                "y2_home": round((y2_h / tot_2y) * 100, 1),
                "y2_draw": round((y2_d / tot_2y) * 100, 1),
                "y2_away": round((y2_a / tot_2y) * 100, 1),
                "over_15": round((o15 / tot_ms) * 100, 1),
                "over_25": p_o25,
                "over_35": round((o35 / tot_ms) * 100, 1),
                "btts_yes": p_btts,
                "btts_no": round((1.0 - (btts_yes / tot_ms)) * 100, 1)
            },
            "top_scores": top_scores,
            "team_details": {
                "home_rank": h_stats.get("rank", "-"),
                "away_rank": a_stats.get("rank", "-"),
                "home_points": h_stats.get("points", "-"),
                "away_points": a_stats.get("points", "-"),
                "home_form": h_stats.get("form", ["G", "B", "G", "M", "G"]),
                "away_form": a_stats.get("form", ["M", "B", "G", "M", "B"])
            }
        }
