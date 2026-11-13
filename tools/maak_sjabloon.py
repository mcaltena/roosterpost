"""Maakt docs/rooster-sjabloon.xlsx: het invulsjabloon voor 'Importeren uit Excel'."""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from datetime import date, time
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else 'docs/rooster-sjabloon.xlsx'
BLAUW, GEEL, LICHT = '2343C4', 'FFF2CF', 'E5EAFB'
F = lambda **k: Font(name='Arial', size=k.pop('size', 11), **k)
kop = dict(font=F(bold=True, color='FFFFFF'), fill=PatternFill('solid', fgColor=BLAUW), alignment=Alignment(vertical='center'))
rand = Border(bottom=Side(style='thin', color='D9DEEC'))

def kopregel(ws, namen, breedtes, rolvanaf=None):
    for i, (n, b) in enumerate(zip(namen, breedtes), 1):
        c = ws.cell(row=1, column=i, value=n)
        c.font, c.fill, c.alignment = kop['font'], kop['fill'], kop['alignment']
        if rolvanaf and i >= rolvanaf: c.fill = PatternFill('solid', fgColor='1B2F8F')
        ws.column_dimensions[c.column_letter].width = b
    ws.row_dimensions[1].height = 24
    ws.freeze_panes = 'A2'

def voorbeeld(ws, waarden):
    for i, v in enumerate(waarden, 1):
        c = ws.cell(row=2, column=i, value=v)
        c.font = F(italic=True, color='7A4F00'); c.fill = PatternFill('solid', fgColor=GEEL)

wb = Workbook()

# ---- Rooster ----
ws = wb.active; ws.title = 'Rooster'
kopregel(ws, ['Datum', 'Begin', 'Einde', 'Bijeenkomst', 'Locatie', 'Opmerking', 'Leiding', 'Oppas', 'EHBO'], [13, 9, 9, 28, 20, 34, 30, 24, 24], rolvanaf=7)
voorbeeld(ws, [date(2027, 1, 10), time(9, 30), time(11, 0), 'Voorbeeld: Ochtenddienst', 'Kerkzaal', 'Sleutel ophalen bij de koster', 'Anna de Vries, Dirk Bakker', 'Bram Jansen', 'Carla Smit'])
for r in range(2, 502):
    ws.cell(row=r, column=1).number_format = 'DD-MM-YYYY'
    ws.cell(row=r, column=2).number_format = 'HH:MM'
    ws.cell(row=r, column=3).number_format = 'HH:MM'
    if r > 2:
        for col in range(1, 10): ws.cell(row=r, column=col).font = F()
dv = DataValidation(type='date', operator='greaterThan', formula1='40000', allow_blank=True, showErrorMessage=True,
                    errorTitle='Datum', error='Vul een datum in, bijvoorbeeld 10-01-2027.')
tv = DataValidation(type='time', operator='between', formula1='0', formula2='0.999988', allow_blank=True, showErrorMessage=True,
                    errorTitle='Tijd', error='Vul een tijd in, bijvoorbeeld 19:30.')
ws.add_data_validation(dv); ws.add_data_validation(tv); dv.add('A2:A501'); tv.add('B2:C501')

# ---- Mensen ----
wm = wb.create_sheet('Mensen')
kopregel(wm, ['Naam', 'E-mail', 'Rollen'], [28, 34, 30])
voorbeeld(wm, ['Voorbeeld Persoon', 'voorbeeld@voorbeeld.nl', 'Leiding, Oppas'])
for r in range(3, 302):
    for col in range(1, 4): wm.cell(row=r, column=col).font = F()

# ---- Uitleg ----
wu = wb.create_sheet('Uitleg')
wu.column_dimensions['A'].width = 24; wu.column_dimensions['B'].width = 92
regels = [
    ('Zo werkt het', None),
    ('1. Invullen', 'Vul de tabbladen Rooster en Mensen in. Elke rij is één bijeenkomst of één persoon. Lege rijen worden overgeslagen.'),
    ('2. Importeren', 'Ga in de app naar Rooster, kies "Importeren uit Excel" en selecteer dit bestand. Je ziet eerst wat er gaat gebeuren; pas na je akkoord wordt er iets opgeslagen.'),
    ('Voorbeeldrij', 'De gele rij 2 op elk tabblad laat zien hoe het moet. Rijen die met "Voorbeeld" beginnen worden niet geïmporteerd: overschrijf of verwijder ze.'),
    ('', None),
    ('Tabblad Rooster', None),
    ('Datum', 'Verplicht. Als datum (10-01-2027) of als tekst (2027-01-10).'),
    ('Begin, Einde', 'Optioneel. Als tijd (19:30).'),
    ('Bijeenkomst', 'Verplicht. De naam van de bijeenkomst.'),
    ('Locatie, Opmerking', 'Optioneel. De opmerking komt in de mail bij "Let op".'),
    ('Leiding, Oppas, EHBO', 'Rolkolommen (donkerblauw). Zet er de namen in van wie is ingeroosterd, gescheiden door een komma. Elke kolom rechts van Opmerking telt als rol: hernoem ze of voeg kolommen toe voor je eigen rollen.'),
    ('Namen', 'Schrijf een naam overal precies hetzelfde. Een naam die de app nog niet kent, wordt als nieuwe persoon zonder e-mailadres toegevoegd; het controlescherm laat zien welke dat zijn.'),
    ('', None),
    ('Tabblad Mensen', None),
    ('Naam', 'Verplicht.'),
    ('E-mail', 'Optioneel. Zonder e-mailadres krijgt iemand geen mail, wel een persoonlijke link.'),
    ('Rollen', 'Optioneel. Waarvoor iemand kan worden ingezet, gescheiden door een komma.'),
    ('', None),
    ('Opnieuw importeren', None),
    ('Bestaande gegevens', 'Je kunt hetzelfde bestand vaker importeren. Een bijeenkomst met dezelfde datum, begintijd en naam wordt bijgewerkt (de bezetting uit het bestand vervangt de oude); een persoon met dezelfde naam ook. Er wordt nooit iets verwijderd.'),
]
for i, (a, b) in enumerate(regels, 1):
    ca = wu.cell(row=i, column=1, value=a); cb = wu.cell(row=i, column=2, value=b)
    if b is None and a:
        ca.font = F(bold=True, size=13, color=BLAUW)
    else:
        ca.font = F(bold=True); cb.font = F(); cb.alignment = Alignment(wrap_text=True, vertical='top'); ca.alignment = Alignment(vertical='top')
        if b and len(b) > 95: wu.row_dimensions[i].height = 15 * (len(b) // 95 + 1)
wb.save(OUT); print('geschreven:', OUT)
