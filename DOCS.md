# FakturaApp v2 – Home Assistant Addon

Kompletní český fakturační systém přímo v Home Assistantu.

## Funkce

### Cenové nabídky
- Vytváření a správa nabídek s vlastní číselnou řadou
- Stavy: rozpracovaná → nová → odeslaná → schválená/odmítnutá → fakturováno
- Úvodní a závěrečný text (oslovení + poděkování)
- Sleva na celou nabídku (%)
- PDF export s vlastním designem (tyrkysový motiv)
- Jedním kliknutím převod schválené nabídky na fakturu nebo rozpracovanou fakturu

### Faktury
- ARES lookup – automatické načtení firmy podle IČO
- QR Platba na PDF (český standard SPD)
- Plátce i neplátce DPH
- Rozpracované faktury – průběžné přidávání položek, vystavení jedním kliknutím
- Odesílání emailem (mailto:)
- Pravidelné/opakující se faktury

### Další
- Dashboard s přehledy a grafy
- Databáze odběratelů (automaticky z faktur/nabídek)
- Přehled plateb s aging analýzou
- Logo firmy (obrázek nebo text)
- Vlastní formáty číselných řad
- Export/Import dat (JSON)
- Automatické denní zálohy SQLite

## Instalace

1. Nakopírujte složku `fakturaapp` do `/addons/` na Home Assistantu
   - Přes **Samba share**: připojte se na `\\homeassistant.local` → složka `addons`
   - Přes **SSH**: `scp -r fakturaapp root@homeassistant.local:/addons/`

2. V HA jděte do **Nastavení → Doplňky → Obchod s doplňky**

3. Klikněte **⋮** → **Znovu načíst**

4. V sekci **Lokální doplňky** najdete **FakturaApp**

5. **Nainstalovat** → **Spustit** → zapněte **"Zobrazit v postranním panelu"**

## Data
- Databáze: `/config/fakturace.db` (SQLite)
- Zálohy: `/config/backups/` (posledních 30 dní, automaticky)
