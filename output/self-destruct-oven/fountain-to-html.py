#!/usr/bin/env python3
"""
Fountain to HTML Converter
Converts a .fountain screenplay file to a printable HTML/PDF format
"""

import re
import sys
from pathlib import Path

def parse_fountain_to_html(fountain_file, output_file):
    """Parse fountain file and convert to HTML screenplay format"""
    
    with open(fountain_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Parse title page
    title_match = re.search(r'^Title:\s*(.+)$', content, re.MULTILINE)
    credit_match = re.search(r'^Credit:\s*(.+)$', content, re.MULTILINE)
    author_match = re.search(r'^Author:\s*(.+)$', content, re.MULTILINE)
    draft_match = re.search(r'^Draft date:\s*(.+)$', content, re.MULTILINE)
    
    # Extract contact info (everything after Contact: until ===)
    contact_match = re.search(r'Contact:\s*\n(.*?)\n===', content, re.DOTALL)
    contact_info = contact_match.group(1).strip() if contact_match else ""
    
    title = title_match.group(1) if title_match else "Untitled"
    credit = credit_match.group(1) if credit_match else ""
    author = author_match.group(1) if author_match else ""
    draft_date = draft_match.group(1) if draft_match else ""
    
    # Remove title page from content
    content = re.sub(r'^.*?===\n', '', content, flags=re.DOTALL)
    
    # Start HTML
    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - Screenplay</title>
    <style>
        @page {{
            size: 8.5in 11in;
            margin: 1in 1in 1in 1.5in;
        }}
        
        @media print {{
            body {{ margin: 0; padding: 0; }}
            .page-break {{ page-break-after: always; }}
            .no-print {{ display: none; }}
        }}
        
        body {{
            font-family: 'Courier New', Courier, monospace;
            font-size: 12pt;
            line-height: 1.5;
            max-width: 6in;
            margin: 0 auto;
            padding: 1in 0;
            background-color: #f5f5f5;
        }}
        
        .screenplay {{
            background-color: white;
            padding: 1in 1.5in 1in 1in;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
            min-height: 9in;
        }}
        
        .title-page {{
            text-align: center;
            padding-top: 3in;
            page-break-after: always;
        }}
        
        .title {{
            font-size: 18pt;
            font-weight: bold;
            text-transform: uppercase;
            margin-bottom: 0.5in;
        }}
        
        .credit {{ font-size: 12pt; margin-bottom: 0.25in; }}
        .author {{ font-size: 12pt; margin-bottom: 2in; }}
        
        .contact {{
            font-size: 10pt;
            text-align: left;
            margin-top: 2in;
        }}
        
        .scene-heading {{
            font-weight: bold;
            text-transform: uppercase;
            margin-top: 2em;
            margin-bottom: 1em;
        }}
        
        .action {{ margin-bottom: 1em; white-space: pre-wrap; }}
        
        .character {{
            margin-left: 2.2in;
            margin-top: 1em;
            margin-bottom: 0;
            text-transform: uppercase;
        }}
        
        .parenthetical {{
            margin-left: 1.7in;
            margin-bottom: 0;
            margin-top: 0;
        }}
        
        .dialogue {{
            margin-left: 1.2in;
            margin-right: 1.5in;
            margin-bottom: 1em;
            margin-top: 0;
            white-space: pre-wrap;
        }}
        
        .transition {{
            text-align: right;
            margin-top: 1em;
            margin-bottom: 1em;
            text-transform: uppercase;
        }}
        
        .centered {{
            text-align: center;
            margin: 1em 0;
            font-weight: bold;
        }}
        
        .act-heading {{
            text-align: center;
            font-weight: bold;
            text-transform: uppercase;
            margin: 2em 0 1em 0;
            text-decoration: underline;
        }}
        
        .print-button {{
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 10px 20px;
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-family: Arial, sans-serif;
            font-size: 14px;

