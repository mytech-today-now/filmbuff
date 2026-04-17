# Generate HTML/PDF from Fountain File

## Quick Instructions

To convert the Fountain file to a printable HTML/PDF:

### Method 1: Run the Python Script (Recommended)

1. Open Command Prompt or PowerShell
2. Navigate to the directory:
   ```
   cd "G:\_kyle\temp_documents\GitHub\screenplays\ai-prompts\self-destruct-oven"
   ```
3. Run the converter:
   ```
   python convert-to-html.py
   ```
4. Open the generated `SELF-DESTRUCT-OVEN.html` in your browser
5. Click "Print / Save as PDF" button or use Ctrl+P
6. Select "Save as PDF" as the printer
7. Save the PDF

### Method 2: Use Online Fountain Converter

1. Go to https://fountain.io/
2. Upload `SELF-DESTRUCT-OVEN-COMPLETE.fountain`
3. Export as PDF

### Method 3: Use Screenwriting Software

**Highland 2** (Mac/Windows):
- Open `SELF-DESTRUCT-OVEN-COMPLETE.fountain`
- File → Export → PDF

**Fade In**:
- Open `SELF-DESTRUCT-OVEN-COMPLETE.fountain`
- File → Export → PDF

**WriterDuet**:
- Import `SELF-DESTRUCT-OVEN-COMPLETE.fountain`
- File → Download → PDF

## What the Python Script Does

The `convert-to-html.py` script:
1. Reads the `.fountain` file
2. Parses all screenplay elements (scenes, dialogue, action, etc.)
3. Converts to HTML with professional screenplay CSS formatting
4. Creates a print-ready HTML file
5. Adds a "Print / Save as PDF" button for easy conversion

## Output Format

The HTML file will have:
- **Title page** with all metadata
- **Professional screenplay formatting**:
  - Scene headings in ALL CAPS
  - Character names centered and in ALL CAPS
  - Dialogue properly indented
  - Action flush left
  - Parentheticals indented
  - Transitions right-aligned
- **Print-optimized CSS** for 8.5" × 11" pages
- **Industry-standard margins** (1" top/bottom, 1.5" left, 1" right)
- **Courier New 12pt font** (screenplay standard)

## Browser Print Settings

When printing to PDF:
1. **Paper size**: Letter (8.5" × 11")
2. **Margins**: Default (or None if using @page CSS)
3. **Background graphics**: Enabled (for proper formatting)
4. **Headers/Footers**: Disabled

## Troubleshooting

**Python not found?**
- Install Python from https://python.org
- Or use Method 2 or 3 above

**Script doesn't run?**
- Make sure you're in the correct directory
- Check that `SELF-DESTRUCT-OVEN-COMPLETE.fountain` exists in the same folder

**HTML looks wrong?**
- Open in a modern browser (Chrome, Firefox, Edge)
- Make sure CSS is enabled

## File Locations

- **Input**: `SELF-DESTRUCT-OVEN-COMPLETE.fountain`
- **Script**: `convert-to-html.py`
- **Output**: `SELF-DESTRUCT-OVEN.html` (generated)
- **Final PDF**: Save wherever you like

---

**Ready to convert?** Run `python convert-to-html.py` now!

