#!/usr/bin/env python3
"""Add English variants to witness index for better matching."""

import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
WITNESS_INDEX = PROJECT_ROOT / "eichmann-entities" / "witness-index.json"

# Known name variations in transcripts vs index
NAME_VARIANTS = {
    "Abba Kowner": ["Abba Kovner", "Kovner"],
    "Yhiel De-Nur (Ka-Tzetnik)": ["Yehiel Dinur", "Dinur", "Ka-Tzetnik", "K. Zetnik", "Ka Tzetnik"],
    "Yitzhak Zukermann": ["Yitzhak Zuckerman", "Zuckerman", "Zukerman"],
    "Zivia Lubetkin Zukermann": ["Zivia Lubetkin", "Lubetkin"],
    "Yoel Brand": ["Joel Brand", "Brand"],
    "Hansie Brand": ["Hansi Brand"],
    "Dr. Mark Dworzecki": ["Mark Dworzecki", "Dworzecki", "Dvorjetski", "Dvorzhetski"],
    "Dr. Moshe Beisky": ["Moshe Beisky", "Beisky", "Bejski"],
    "Dr. Joseph Buzminsky": ["Josef Buzminsky", "Buzminsky", "Buzminski"],
    "Dr. Leon Wells": ["Leon Wells", "Wells", "Weliczker Wells"],
    "Zyndel Shmuel Grynszpan": ["Zindel Grynszpan", "Grynszpan", "Sendel Grynszpan"],
    "Dr. Adolf Berman": ["Adolf Berman", "Berman"],
    "Dr. Aharon Beilin": ["Aharon Beilin", "Beilin"],
    "Dr. Aharon Peretz": ["Aharon Peretz", "Peretz"],
    "Dr. Arieh Breslauer": ["Arieh Breslauer", "Breslauer"],
    "Dr. Bedrich Steiner": ["Bedrich Steiner", "Steiner"],
    "Dr. David Wdowinsky": ["David Wdowinski", "Wdowinski", "Wdowinsky"],
    "Dr. Ernst Abeles": ["Ernst Abeles", "Abeles"],
    "Dr. Franz Meyer": ["Franz Meyer", "Meyer"],
    "Dr. George Wellers": ["George Wellers", "Georges Wellers", "Wellers"],
    "Dr. Jacob Kratky": ["Jacob Kratky", "Kratky"],
    "Dr. Josef Melkmann-Michman": ["Josef Melkmann", "Melkmann", "Michman"],
    "Dr. Martin Poeldy": ["Martin Poeldy", "Poeldy", "Peldi"],
    "Dr. Mordehai Chen": ["Mordehai Chen", "Chen"],
    "Dr. Theodor Lowenstein": ["Theodor Lowenstein", "Lowenstein", "Loewenstein"],
    "Dr. Tibor Ferencz": ["Tibor Ferencz", "Ferencz"],
    "Prof. Salo Baron": ["Salo Baron", "Baron"],
    "Prof. Gustave Gilbert": ["Gustave Gilbert", "Gilbert"],
    "Judge Michael Musmanno": ["Michael Musmanno", "Musmanno"],
    "Aharon Choter Yishai": ["Aharon Hoter-Yishai", "Hoter-Yishai", "Hoter Yishai", "Choter-Yishai"],
    "Aharon Walter Lindenstrauss": ["Walter Lindenstrauss", "Lindenstrauss"],
    "Aharon Zilberman": ["Zilberman", "Silberman"],
    "Alexander Brodie": ["Brodie"],
    "Aviva Flieschman": ["Flieschman", "Fleischman"],
    "Baruch Duvdevani": ["Duvdevani"],
    "Benno Cohen": ["Cohen"],
    "Charlotte Salzberger": ["Salzberger"],
    "Ernst Recht": ["Recht"],
    "Ester Shilo": ["Esther Shilo", "Shilo", "Shiloh"],
    "Freida Mazia": ["Mazia", "Frieda Mazia"],
    "Gedalia Ben Zvi": ["Ben Zvi", "Ben-Zvi"],
    "Henriette Samuel": ["Samuel"],
    "Henryk Ross": ["Ross"],
    "Henryk Zvi Zimerman": ["Zimerman", "Zimmerman"],
    "Hinko Zaltz": ["Zaltz"],
    "Hulda Campagnana": ["Campagnana", "Campagnano"],
    "Israel Carmel": ["Carmel"],
    "Israel Gutman": ["Gutman", "Yisrael Gutman"],
    "Kalman Teigmann": ["Teigmann", "Teigman"],
    "Leanna Neumann": ["Neumann"],
    "Mordeichai Eliezer Greenspan": ["Greenspan"],
    "Moshe Bahir": ["Bahir"],
    "Moshe Rosenberg": ["Rosenberg"],
    "Eliyahu Rosenberg": ["Eliyahu Rosenberg"],
    "Adolf Rosenberg": ["Rosenberg"],
    "Naftali Bar-Shalom": ["Bar-Shalom"],
    "Noach Zabludowicz": ["Zabludowicz"],
    "Philippe Freudiger": ["Freudiger", "Fulop Freudiger", "Philip Freudiger"],
    "Rivka Kupper": ["Kupper"],
    "Rivka Yoselevska": ["Yoselevska", "Rivka Yosselevska"],
    "Shalom Chulawski": ["Cholawski", "Shalom Cholawski"],
    "Shimon Servernik": ["Servernik"],
    "Shmuel Horowitz": ["Horowitz"],
    "Vali Zimmet": ["Zimmet"],
    "Vera Alexander": ["Alexander"],
    "Werner David Melchior": ["Melchior", "Werner Melchior"],
    "Yacov Vernik": ["Vernik", "Jacob Vernik"],
    "Yehuda Bacon": ["Bacon", "Jehuda Bacon"],
    "Yitzhak Nehama": ["Nehama"],
    "Abraham Buchmann": ["Buchmann"],
    "Abraham Hadjaj": ["Hadjaj"],
    "Abraham Karassik": ["Karassik"],
    "Abraham Levinsohn": ["Levinsohn", "Levinson"],
    "Zvi Pachter": ["Pachter"],
    "Rachel Auerbach": ["Auerbach"],
    "Raya Cagan": ["Cagan", "Kagan"],
}

def main():
    # Load witness index
    with open(WITNESS_INDEX, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    updated = 0
    for witness in data["witnesses"]:
        english = witness.get("english", "")
        if english in NAME_VARIANTS:
            # Get existing variants or create empty list
            existing = set(witness.get("variants", []))
            new_variants = set(NAME_VARIANTS[english])
            
            # Merge variants
            all_variants = existing.union(new_variants)
            witness["variants"] = list(all_variants)
            updated += 1
            print(f"  {english}: added {new_variants - existing}")
    
    # Save updated index
    with open(WITNESS_INDEX, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f"\nUpdated {updated} witnesses with variants")

if __name__ == "__main__":
    main()

# Additional variants discovered
MORE_VARIANTS = {
    "Rivka Yoselevska": ["Rivka Yoselewska", "Yoselewska"],
    "Yehuda Bacon": ["Yehuda Bakon", "Bakon"],
    "Zivia Lubetkin Zukermann": ["Lubetkin-Zuckerman", "Zivia Lubetkin-Zuckerman"],
    "Zvi Pachter": ["Zvi Pechter", "Pechter"],
    "Moshe Bahir": ["Bahir"],
    "Rivka Kupper": ["Rivka Kuper", "Kuper"],
}

# Merge with existing
NAME_VARIANTS.update(MORE_VARIANTS)
