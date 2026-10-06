import math
import json

class SportsAnalyticsEngine:
    def __init__(self, rho=-0.11):
        """
        MAS (Mine Analiz System) Çekirdek Matematik Motoru.
        Dixon-Coles parametresi: rho = -0.11
        """
        self.rho = rho

    def calculate_entropy(self, probabilities):
        """Shannon Entropisi: Kaotik maçları ayıklar."""
        entropy = 0.0
        for p in probabilities:
            if p > 0.0001:
                entropy -= p * math.log2(p)
        return round(entropy, 3)

    def apply_fatigue_penalty(self, rest_days):
        """Fikstür Yorgunluğu Süzgeci"""
        if rest_days <= 2:
            return {"attack_mult": 0.88, "defense_weakness": 1.14}
        elif rest_days == 3:
            return {"attack_mult": 0.95, "defense_weakness": 1.06}
        elif rest_days == 4:
            return {"attack_mult": 0.98, "defense_weakness": 1.02}
        return {"attack_mult": 1.00, "defense_weakness": 1.00}

    def _poisson_pmf(self, k, rate):
        if rate <= 0:
            return 1.0 if k == 0 else 0.0
        return (math.pow(rate, k) * math.exp(-rate)) / math.factorial(k)

    def _dixon_coles_tau(self, x, y, lambda_h, mu_a):
        """Düşük skor düzeltme çarpanı."""
        if x == 0 and y == 0:
            return 1.0 - (lambda_h * mu_a * self.rho)
        elif x == 0 and y == 1:
            return 1.0 + (lambda_h * self.rho)
        elif x == 1 and y == 0:
            return 1.0 + (mu_a * self.rho)
        elif x == 1 and y == 1:
            return 1.0 - self.rho
        else:
            return 1.0

    def analyze_match(self, match_data):
        home = match_data.get("home_team", "Ev Sahibi")
        away = match_data.get("away_team", "Deplasman")
        odds = match_data.get("odds", {})

        home_fatigue = self.apply_fatigue_penalty(match_data.get("home_rest_days", 5))
        away_fatigue = self.apply_fatigue_penalty(match_data.get("away_rest_days", 5))

        lambda_home = (match_data.get("home_xg_for", 1.4) * home_fatigue["attack_mult"] + 
                       match_data.get("away_xg_against", 1.2) * away_fatigue["defense_weakness"]) / 2.0
        
        mu_away = (match_data.get("away_xg_for", 1.2) * away_fatigue["attack_mult"] + 
                   match_data.get("home_xg_against", 1.4) * home_fatigue["defense_weakness"]) / 2.0

        lambda_home = max(lambda_home, 0.2)
        mu_away = max(mu_away, 0.2)

        home_win_prob = 0.0
        draw_prob = 0.0
        away_win_prob = 0.0
        over_15_prob = 0.0
        over_25_prob = 0.0
        over_35_prob = 0.0
        btts_yes_prob = 0.0
        exact_scores = {}

        for h in range(9):
            for a in range(9):
                base_prob = self._poisson_pmf(h, lambda_home) * self._poisson_pmf(a, mu_away)
                tau = self._dixon_coles_tau(h, a, lambda_home, mu_away)
                prob = max(0.0, base_prob * tau)
                exact_scores[f"{h}-{a}"] = prob

                if h > a:
                    home_win_prob += prob
                elif h == a:
                    draw_prob += prob
                else:
                    away_win_prob += prob

                total_goals = h + a
                if total_goals > 1.5:
                    over_15_prob += prob
                if total_goals > 2.5:
                    over_25_prob += prob
                if total_goals > 3.5:
                    over_35_prob += prob

                if h > 0 and a > 0:
                    btts_yes_prob += prob

        total_p = home_win_prob + draw_prob + away_win_prob
        if total_p > 0:
            home_win_prob /= total_p
            draw_prob /= total_p
            away_win_prob /= total_p

        under_25_prob = 1.0 - over_25_prob
        btts_no_prob = 1.0 - btts_yes_prob

        # Entropi kontrolü (Maksimum 1.58'dir. 1.56 üzeri aşırı rastlantısaldır)
        match_entropy = self.calculate_entropy([home_win_prob, draw_prob, away_win_prob])
        is_chaotic = match_entropy > 1.56

        sorted_scores = sorted(exact_scores.items(), key=lambda item: item[1], reverse=True)[:3]
        top_scores = [{"score": s[0], "prob": f"%{round(s[1] * 100, 1)}"} for s in sorted_scores]

        markets_to_check = [
            {"type": "MS 1", "prob": home_win_prob, "odd": odds.get("home", 0.0)},
            {"type": "MS X", "prob": draw_prob, "odd": odds.get("draw", 0.0)},
            {"type": "MS 2", "prob": away_win_prob, "odd": odds.get("away", 0.0)},
            {"type": "2.5 ÜST", "prob": over_25_prob, "odd": odds.get("over25", 0.0)},
            {"type": "2.5 ALT", "prob": under_25_prob, "odd": odds.get("under25", 0.0)},
            {"type": "KG VAR", "prob": btts_yes_prob, "odd": odds.get("btts_yes", 0.0)},
            {"type": "KG YOK", "prob": btts_no_prob, "odd": odds.get("btts_no", 0.0)}
        ]

        value_scenarios = []
        for m in markets_to_check:
            odd = float(m["odd"])
            if odd > 1.0:
                expected_value = (m["prob"] * odd) - 1.0
                if expected_value >= 0.04:
                    value_scenarios.append({
                        "market": m["type"],
                        "model_prob": f"%{round(m['prob'] * 100, 1)}",
                        "bulten_orani": odd,
                        "expected_value": f"+%{round(expected_value * 100, 1)}"
                    })

        return {
            "match": f"{home} vs {away}",
            "expected_goals": {
                "home": round(lambda_home, 2),
                "away": round(mu_away, 2)
            },
            "probabilities": {
                "home_win": round(home_win_prob * 100, 1),
                "draw": round(draw_prob * 100, 1),
                "away_win": round(away_win_prob * 100, 1),
                "over_15": round(over_15_prob * 100, 1),
                "over_25": round(over_25_prob * 100, 1),
                "under_25": round(under_25_prob * 100, 1),
                "btts_yes": round(btts_yes_prob * 100, 1),
                "btts_no": round(btts_no_prob * 100, 1)
            },
            "top_predicted_scores": top_scores,
            "entropy": match_entropy,
            "status": "ELENDİ (Kaotik Maç)" if is_chaotic else "ONAYLANDI (Stabil)",
            "value_scenarios": value_scenarios
        }

if __name__ == "__main__":
    engine = SportsAnalyticsEngine()
    sample_match = {
        "home_team": "Manchester City",
        "away_team": "Arsenal",
        "home_rest_days": 4,
        "away_rest_days": 3,
        "home_xg_for": 2.25,
        "home_xg_against": 0.85,
        "away_xg_for": 1.95,
        "away_xg_against": 0.90,
        "odds": {
            "home": 1.95,
            "draw": 3.40,
            "away": 3.80,
            "over25": 1.70,
            "under25": 2.05,
            "btts_yes": 1.65,
            "btts_no": 2.10
        }
    }
    result = engine.analyze_match(sample_match)
    print("=== MAS DIXON-COLES ANALİZ ÇIKTISI ===")
    print(json.dumps(result, indent=4, ensure_ascii=False))