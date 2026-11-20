import os
from PIL import Image, ImageDraw, ImageFont

os.makedirs('android/screenshots', exist_ok=True)

# Fonts
font_dir = 'C:/Windows/Fonts/'
font_bold_lg = ImageFont.truetype(os.path.join(font_dir, 'segoeuib.ttf'), 52)
font_bold_md = ImageFont.truetype(os.path.join(font_dir, 'segoeuib.ttf'), 38)
font_bold_sm = ImageFont.truetype(os.path.join(font_dir, 'segoeuib.ttf'), 26)
font_regular_md = ImageFont.truetype(os.path.join(font_dir, 'segoeui.ttf'), 28)
font_regular_sm = ImageFont.truetype(os.path.join(font_dir, 'segoeui.ttf'), 22)
font_mono = ImageFont.truetype(os.path.join(font_dir, 'consola.ttf'), 24)

# 1. GENERATE FEATURE GRAPHIC (1024 x 500)
def generate_feature_graphic():
    width, height = 1024, 500
    img = Image.new('RGB', (width, height), color=(14, 27, 43)) # #0E1B2B (TransferYA ink dark)
    draw = ImageDraw.Draw(img)

    # Gradient/glow background accents
    for r in range(250, 0, -5):
        alpha = int(45 * (r / 250))
        # Top-right glow
        draw.ellipse([800 - r, -50 - r, 800 + r, -50 + r], fill=(19, 185, 129, alpha))
        # Bottom-left glow
        draw.ellipse([100 - r, 450 - r, 100 + r, 450 + r], fill=(0, 229, 255, alpha // 2))

    # Load and paste app icon
    if os.path.exists('android/google_play_icon_512.png'):
        icon = Image.open('android/google_play_icon_512.png').convert('RGBA')
        icon = icon.resize((150, 150), Image.Resampling.LANCZOS)
        img.paste(icon, (80, 175), icon)

    # Brand Title
    draw.text((260, 155), "transfer", fill=(255, 255, 255), font=font_bold_lg)
    bbox = font_bold_lg.getbbox("transfer")
    tw = bbox[2] - bbox[0]
    draw.text((260 + tw, 155), "YA", fill=(19, 185, 129), font=font_bold_lg)
    draw.text((260 + tw + 70, 168), "CENTINELA", fill=(0, 229, 255), font=font_bold_sm)

    # Subtitle & Claim
    draw.text((260, 235), "Pantallazo falso, no pasa.", fill=(255, 255, 255), font=font_bold_md)
    draw.text((260, 285), "Verificación instantánea de pagos de Nequi y DaviPlata", fill=(148, 163, 184), font=font_regular_md)
    draw.text((260, 325), "Aviso sonoro en mostrador y confirmación a tus cajeros por WhatsApp.", fill=(148, 163, 184), font=font_regular_sm)

    # Pill tags at bottom
    tags = ["⚡ MENOS DE 1 SEGUNDO", "🛡️ 100% ANTIFRAUDE", "🇨🇴 COLOMBIA"]
    tx = 260
    for tag in tags:
        draw.rounded_rectangle([tx, 380, tx + 200, 415], radius=8, fill=(30, 41, 59), outline=(19, 185, 129, 180), width=1)
        draw.text((tx + 15, 388), tag, fill=(241, 245, 249), font=font_mono)
        tx += 220

    out_path = 'android/google_play_feature_graphic_1024x500.png'
    img.save(out_path, format='PNG')
    print(f"Created: {out_path} ({width}x{height})")

# 2. GENERATE SCREENSHOTS (1080 x 1920)
def generate_screenshot(filename, tag_text, title_text, subtitle_text, card_title, card_details, accent_color):
    width, height = 1080, 1920
    img = Image.new('RGB', (width, height), color=(14, 27, 43))
    draw = ImageDraw.Draw(img)

    # Decorative top bar
    draw.rectangle([0, 0, width, 12], fill=accent_color)

    # Pill Badge
    draw.rounded_rectangle([90, 80, 90 + 380, 135], radius=12, fill=(30, 41, 59), outline=accent_color, width=2)
    draw.text((115, 95), tag_text, fill=accent_color, font=font_bold_sm)

    # Main Hero Header
    draw.text((90, 170), title_text, fill=(255, 255, 255), font=font_bold_lg)
    draw.text((90, 250), subtitle_text, fill=(148, 163, 184), font=font_regular_md)

    # Phone Frame representation
    fx1, fy1, fx2, fy2 = 90, 360, 990, 1800
    draw.rounded_rectangle([fx1, fy1, fx2, fy2], radius=40, fill=(16, 28, 45), outline=(51, 65, 85), width=4)

    # Inner app screen header
    draw.rounded_rectangle([fx1 + 10, fy1 + 10, fx2 - 10, fy1 + 130], radius=30, fill=(30, 41, 59))
    draw.text((fx1 + 40, fy1 + 45), "TransferYA Centinela", fill=(255, 255, 255), font=font_bold_md)
    draw.rounded_rectangle([fx2 - 220, fy1 + 40, fx2 - 40, fy1 + 95], radius=15, fill=accent_color)
    draw.text((fx2 - 195, fy1 + 52), "EN VIVO", fill=(15, 23, 42), font=font_bold_sm)

    # Central Card
    cx1, cy1, cx2, cy2 = fx1 + 40, fy1 + 180, fx2 - 40, fy2 - 60
    draw.rounded_rectangle([cx1, cy1, cx2, cy2], radius=24, fill=(11, 17, 26), outline=(30, 41, 59), width=2)

    # Card Content Header
    draw.text((cx1 + 40, cy1 + 50), card_title, fill=accent_color, font=font_bold_md)
    draw.line([cx1 + 40, cy1 + 115, cx2 - 40, cy1 + 115], fill=(51, 65, 85), width=2)

    # Card Content Rows
    cy = cy1 + 150
    for label, val in card_details:
        draw.text((cx1 + 40, cy), label, fill=(148, 163, 184), font=font_regular_md)
        draw.text((cx1 + 40, cy + 45), val, fill=(255, 255, 255), font=font_bold_md)
        draw.line([cx1 + 40, cy + 110, cx2 - 40, cy + 110], fill=(30, 41, 59), width=1)
        cy += 140

    out_path = os.path.join('android/screenshots', filename)
    img.save(out_path, format='PNG')
    print(f"Created: {out_path} ({width}x{height})")

generate_feature_graphic()

# Screenshot 1: POS Mostrador
generate_screenshot(
    '01_pantalla_mostrador_pos.png',
    'CONFIRMACIÓN EN VIVO',
    'Pantalla de Mostrador (POS)',
    'Confirmación de alto impacto y aviso sonoro automático',
    '¡Pago Verificado y Recibido!',
    [
        ('VALOR TRANSFERIDO', '$ 32.000 COP'),
        ('BILLETERA OFICIAL', 'NEQUI (Confirmado en cuenta)'),
        ('PAGADOR / CLIENTE', 'Yeison Stiven Murcia Calvo'),
        ('REFERENCIA BANCARIA', 'BREB-98DDB372'),
        ('TIEMPO DE AUDITORÍA', '168 milisegundos')
    ],
    (19, 185, 129) # Emerald
)

# Screenshot 2: Vinculación QR
generate_screenshot(
    '02_vinculacion_caja_qr.png',
    'CONFIGURACIÓN RÁPIDA',
    'Vincula tu Caja en 2 Minutos',
    'Escanea el código QR desde tu panel web TransferYA',
    'Asociación Segura de Teléfono',
    [
        ('COMERCIO VINCULADO', 'Mursat Solutions - Mostrador Principal'),
        ('IDENTIFICADOR DE CAJA', 'Caja 1 (Caja Registradora)'),
        ('SEGURIDAD', 'Token Criptográfico HMAC-SHA256'),
        ('PERMISOS REQUERIDOS', 'Solo Lectura de Notificaciones'),
        ('PRIVACIDAD BANCARIA', 'Cero Acceso a Claves o Saldo Total')
    ],
    (0, 229, 255) # Cyan
)

# Screenshot 3: Movimientos y Cierres
generate_screenshot(
    '03_historial_y_arqueo.png',
    'CONTROL FINANCIERO TOTAL',
    'Movimientos y Cierres de Turno',
    'Historial consolidado con arqueo en 1 clic',
    'Resumen del Turno Actual',
    [
        ('TOTAL COBRADO HOY', '$ 1.485.000 COP'),
        ('PAGOS CONFIRMADOS', '42 transferencias exitosas'),
        ('DESGLOSE NEQUI', '28 pagos ($ 980.000 COP)'),
        ('DESGLOSE DAVIPLATA', '14 pagos ($ 505.000 COP)'),
        ('ESTADO DEL CUADRE', '100% Cuadrado sin faltantes')
    ],
    (245, 158, 11) # Amber
)

# Screenshot 4: Respaldo Cloud
generate_screenshot(
    '04_respaldo_cloud_email.png',
    'SIEMPRE ACTIVO',
    'Respaldo por Correo Gmail',
    'Verifica transferencias aunque el celular se descargue',
    'Protección Continua en la Nube',
    [
        ('ESTADO DE LA RUTA CLOUD', 'Respaldo Activo y Operativo'),
        ('BUZÓN EXCLUSIVO', 'pago+bc8b5b58@transferya.app'),
        ('DISPONIBILIDAD', '100% Online en Vercel & Supabase'),
        ('TOLERANCIA A FALLAS', 'Funciona sin batería ni internet local'),
        ('NOTIFICACIÓN A CAJERO', 'Aviso por WhatsApp al Instante')
    ],
    (14, 165, 233) # Sky Blue
)
