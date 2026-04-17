#!/usr/bin/env python3
"""
Fountain to HTML/PDF Converter
Converts SELF-DESTRUCT-OVEN-COMPLETE.fountain to printable HTML
"""

import re

def convert_fountain_to_html():
    # Read the fountain file
    with open('SELF-DESTRUCT-OVEN-COMPLETE.fountain', 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # Parse title page
    title = "SELF-DESTRUCT OVEN"
    credit = "An SNL Sketch"
    author = "Screenplays Project"
    draft_date = "2026-02-07"
    contact_info = "Runtime: 4:00 minutes<br>Format: Single-camera or live sketch<br>Setting: Corporate boardroom"
    
    # Start building HTML
    html_parts = []
    
    # Add HTML header with CSS
    html_parts.append('''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SELF-DESTRUCT OVEN - Screenplay</title>
    <style>
        @page { size: 8.5in 11in; margin: 1in 1in 1in 1.5in; }
        @media print { body { margin: 0; padding: 0; } .no-print { display: none; } }
        body { font-family: 'Courier New', Courier, monospace; font-size: 12pt; line-height: 1.5; max-width: 6in; margin: 0 auto; padding: 1in 0; background-color: #f5f5f5; }
        .screenplay { background-color: white; padding: 1in 1.5in; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        .title-page { text-align: center; padding-top: 3in; page-break-after: always; }
        .title { font-size: 18pt; font-weight: bold; text-transform: uppercase; margin-bottom: 0.5in; }
        .credit { font-size: 12pt; margin-bottom: 0.25in; }
        .author { font-size: 12pt; margin-bottom: 2in; }
        .contact { font-size: 10pt; text-align: left; margin-top: 2in; }
        .scene-heading { font-weight: bold; text-transform: uppercase; margin-top: 2em; margin-bottom: 1em; }
        .action { margin-bottom: 1em; }
        .character { margin-left: 2.2in; margin-top: 1em; margin-bottom: 0; text-transform: uppercase; }
        .parenthetical { margin-left: 1.7in; margin-bottom: 0; margin-top: 0; }
        .dialogue { margin-left: 1.2in; margin-right: 1.5in; margin-bottom: 1em; margin-top: 0; }
        .transition { text-align: right; margin-top: 1em; margin-bottom: 1em; text-transform: uppercase; }
        .centered { text-align: center; margin: 1em 0; font-weight: bold; }
        .act-heading { text-align: center; font-weight: bold; text-transform: uppercase; margin: 2em 0 1em 0; text-decoration: underline; }
        .print-button { position: fixed; top: 20px; right: 20px; padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-family: Arial, sans-serif; font-size: 14px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
        .print-button:hover { background-color: #0056b3; }
    </style>
</head>
<body>
    <button class="print-button no-print" onclick="window.print()">Print / Save as PDF</button>
    <div class="screenplay">
        <div class="title-page">
            <div class="title">SELF-DESTRUCT OVEN</div>
            <div class="credit">An SNL Sketch</div>
            <div class="author">by<br>Screenplays Project</div>
            <div class="contact">Draft date: 2026-02-07<br>Runtime: 4:00 minutes<br>Format: Single-camera or live sketch<br>Setting: Corporate boardroom</div>
        </div>
''')
    
    # Parse content (skip title page)
    in_content = False
    in_dialogue = False
    current_character = None
    
    for i, line in enumerate(lines):
        line = line.rstrip()
        
        # Skip until we hit ===
        if not in_content:
            if line.strip() == '===':
                in_content = True
            continue
        
        # Skip empty lines in certain contexts
        if not line.strip():
            if in_dialogue:
                in_dialogue = False
            continue
        
        # Act headings
        if line.startswith('# ACT'):
            html_parts.append(f'        <div class="act-heading">{line[2:].strip()}</div>\n')
        
        # Transitions
        elif line.strip() in ['FADE IN:', 'FADE OUT.', 'BLACKOUT.']:
            html_parts.append(f'        <div class="transition">{line.strip()}</div>\n')
        
        # Scene headings
        elif line.startswith(('INT.', 'EXT.')):
            html_parts.append(f'        <div class="scene-heading">{line.strip()}</div>\n')
        
        # Title cards
        elif line.startswith('>'):
            content = line[1:].strip().replace('**', '')
            html_parts.append(f'        <div class="centered">{content}</div>\n')
        
        # Character names (all caps, not a scene heading)
        elif line.strip().isupper() and len(line.strip()) > 0 and not line.startswith(('INT.', 'EXT.', '#', '>')):
            # Check if it's actually a character name (next line might be parenthetical or dialogue)
            if i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                if next_line.startswith('(') or (next_line and not next_line.isupper()):
                    html_parts.append(f'        <div class="character">{line.strip()}</div>\n')
                    current_character = line.strip()
                    in_dialogue = True
                    continue
            # Otherwise it's action
            html_parts.append(f'        <div class="action">{line.strip()}</div>\n')
        
        # Parentheticals
        elif line.strip().startswith('(') and line.strip().endswith(')'):
            html_parts.append(f'        <div class="parenthetical">{line.strip()}</div>\n')
        
        # Dialogue
        elif in_dialogue and current_character:
            html_parts.append(f'        <div class="dialogue">{line.strip()}</div>\n')
        
        # Action (default)
        else:
            if line.strip():
                html_parts.append(f'        <div class="action">{line.strip()}</div>\n')
    
    # Close HTML
    html_parts.append('''    </div>
</body>
</html>''')
    
    # Write output
    with open('SELF-DESTRUCT-OVEN.html', 'w', encoding='utf-8') as f:
        f.write(''.join(html_parts))
    
    print("✅ HTML file created: SELF-DESTRUCT-OVEN.html")
    print("📄 Open in browser and use Print/Save as PDF")

if __name__ == '__main__':
    convert_fountain_to_html()

