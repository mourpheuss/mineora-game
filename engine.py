import math
import re

class SportsAnalyticsEngine:
    def __init__(self, rho=-0.13):
        self.rho = rho

    def _poisson(self, k, lamb):
        if lamb <= 0:
            return 1.0 if k == 0 else 0.0
        return (math.exp(-lamb) * (lamb ** k)) / math.factorial(k)

    def _parse_minute(self, clock_str):
        """'65'' veya '45+2'' gibi saat stringlerini tam sayı dakikaya çevirir"""
        if not clock_str:
            return 0
        match = re.search(r'\d+', str(clock_str))
        return int(match.group()) if match else 0

    def analyze_match(self, match_data):
        home_team = match_data.get("home_team", "Ev Sahibi")
        away_team = match_data.get("away_team", "Deplasman")
        
        h_stats = match_data.get("home_stats", {})
        a_stats = match_data.get("away_stats", {})

        is_live = match_data.get("is_live", False)
        live_clock = match_data.get("live_clock", "0'")
        cur_h = int(match_data.get("home_score", 0))
        cur_a = int(match_data.get("away_score", 0))
        h_reds = int(match_data.get("home_reds", 0))
        a_reds = int(match_data.get("away_reds", 0))

        # Maç Öncesi Temel xG
        h_xg = max(0.45, float(h_stats.get("calc_xg", 1.55)))
        a_xg = max(0.35, float(a_stats.get("calc_xg", 1.15)))

        # CANLI MAÇ KALİBRASYONU (Dakika ve Kırmızı Kart)
        if is_live:
            minute = self._parse_minute(live_clock)
            rem_ratio = max(0.05, (95 - minute) / 90.0) # Kalan süre oranı

            # Kırmızı Kart Cezası (10 kişi kalan takımın xG'si %35 düşer, kalesinde gol görme riski %30 artar)
            if h_reds > 0:
                h_xg *= (0.65 ** h_reds)
                a_xg *= (1.30 ** h_reds)
            if a_reds > 0:
                a_xg *= (0.65 ** a_reds)
                h_xg *= (1.30 ** a_reds)

            rem_h_xg = h_xg * rem_ratio
            rem_a_xg = a_xg * rem_ratio
        else:
            rem_h_xg = h_xg
            rem_a_xg = a_xg

        # Poisson Simülasyonu (Kalan Olası Goller)
        ms_h, ms_d, ms_a = 0.0, 0.0, 0.0
        o15, o25, o35 = 0.0, 0.0, 0.0
        btts_yes = 0.0
        matrix = []

        for gh in range(6):
            for ga in range(6):
                p = self._poisson(gh, rem_h_xg) * self._poisson(ga, rem_a_xg)

                # Nihai Skor = Anlık Skor + Kalan Süredeki Goller
                final_h = cur_h + gh
                final_a = cur_a + ga

                if final_h > final_a: ms_h += p
                elif final_h == final_a: ms_d += p
                else: ms_a += p

                tg = final_h + final_a
                if tg > 1.5: o15 += p
                if tg > 2.5: o25 += p
                if tg > 3.5: o35 += p
                if final_h > 0 and final_a > 0: btts_yes += p

                matrix.append((f"{final_h}-{final_a}", p))

        tot_ms = ms_h + ms_d + ms_a or 1.0

        # İlk Yarı / İkinci Yarı (Maç öncesiyse standart, canlıysa duruma göre)
        iy_h = round((rem_h_xg * 0.44 / (rem_h_xg * 0.44 + rem_a_xg * 0.44 + 0.8)) * 100, 1)
        iy_a = round((rem_a_xg * 0.44 / (rem_h_xg * 0.44 + rem_a_xg * 0.44 + 0.8)) * 100, 1)
        iy_d = round(100.0 - iy_h - iy_a, 1)

        matrix.sort(key=lambda x: x[1], reverse=True)
        top_scores = [
            {"score": s[0], "prob": f"%{round((s[1]/tot_ms)*100, 1)}"}
            for s in matrix[:3]
        ]

        volatility_warning = None
        if h_reds > 0 or a_reds > 0:
            red_team = home_team if h_reds > 0 else away_team
            volatility_warning = f"⚠️ KIRMIZI KART UYARISI: {red_team} sahada 10 kişi! Canlı olasılıklar eksik kadroya göre yeniden hesaplandı."

        return {
            "match": f"{home_team} vs {away_team}",
            "home_team": home_team,
            "away_team": away_team,
            "is_live": is_live,
            "live_clock": live_clock,
            "live_score": f"{cur_h} - {cur_a}" if is_live else "",
            "home_reds": h_reds,
            "away_reds": away_reds,
            "volatility_warning": volatility_warning,
            "analysis": {
                "ms_home": round((ms_h / tot_ms) * 100, 1),
                "ms_draw": round((ms_d / tot_ms) * 100, 1),
                "ms_away": round((ms_a / tot_ms) * 100, 1),
                "iy_home": iy_h,
                "iy_draw": iy_d,
                "iy_away": iy_a,
                "y2_home": round((ms_h / tot_ms) * 80, 1),
                "y2_draw": round((ms_d / tot_ms) * 100, 1),
                "y2_away": round((ms_a / tot_ms) * 80, 1),
                "over_15": round((o15 / tot_ms) * 100, 1),
                "over_25": round((o25 / tot_ms) * 100, 1),
                "over_35": round((o35 / tot_ms) * 100, 1),
                "btts_yes": round((btts_yes / tot_ms) * 100, 1),
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
