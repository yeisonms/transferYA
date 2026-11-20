import base64

def png_to_base64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')

b64_nequi = png_to_base64(r'C:/proyectos2026/transferYA/public/icons/brand-nequi-icon.png')
b64_davi = png_to_base64(r'C:/proyectos2026/transferYA/public/icons/brand-daviplata-horizontal.png')
b64_breb = png_to_base64(r'C:/proyectos2026/transferYA/public/icons/brand-breb-icon.png')
b64_banco = png_to_base64(r'C:/proyectos2026/transferYA/public/icons/brand-bancolombia-icon.png')

# 1. bank-nequi.svg
svg_nequi = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 115 36" fill="none">
  <image href="data:image/png;base64,{b64_nequi}" x="2" y="2" width="32" height="32" />
  <text x="42" y="24" font-family="'Plus Jakarta Sans', system-ui, sans-serif" font-weight="800" font-size="18" letter-spacing="-0.03em" fill="#200020">nequi</text>
</svg>'''
with open(r'C:/proyectos2026/transferYA/public/icons/bank-nequi.svg', 'w', encoding='utf-8') as f:
    f.write(svg_nequi)

# 2. bank-daviplata.svg
svg_davi = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 36" fill="none">
  <image href="data:image/png;base64,{b64_davi}" x="0" y="3" width="170" height="30" preserveAspectRatio="xMidYMid meet" />
</svg>'''
with open(r'C:/proyectos2026/transferYA/public/icons/bank-daviplata.svg', 'w', encoding='utf-8') as f:
    f.write(svg_davi)

# 3. bank-breb.svg
svg_breb = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 115 36" fill="none">
  <image href="data:image/png;base64,{b64_breb}" x="2" y="2" width="32" height="32" />
  <text x="42" y="24" font-family="'Plus Jakarta Sans', system-ui, sans-serif" font-weight="900" font-size="18" letter-spacing="-0.03em" fill="#0E1B2B">Bre-B</text>
</svg>'''
with open(r'C:/proyectos2026/transferYA/public/icons/bank-breb.svg', 'w', encoding='utf-8') as f:
    f.write(svg_breb)

# 4. bank-bancolombia.svg
svg_banco = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 36" fill="none">
  <image href="data:image/png;base64,{b64_banco}" x="2" y="3" width="30" height="30" />
  <text x="38" y="24" font-family="'Plus Jakarta Sans', system-ui, sans-serif" font-weight="800" font-size="16" letter-spacing="-0.02em" fill="#0E1B2B">Bancolombia</text>
</svg>'''
with open(r'C:/proyectos2026/transferYA/public/icons/bank-bancolombia.svg', 'w', encoding='utf-8') as f:
    f.write(svg_banco)

print("Generated all 4 SVGs successfully!")
