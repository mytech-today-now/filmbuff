# Fountain Format Files for "Self-Destruct Oven"

## Overview

The screenplay "Self-Destruct Oven" has been converted to **Fountain format** (.fountain), which is a plain text markup language for screenwriting that can be used with various screenwriting applications.

## Files Created

1. **SELF-DESTRUCT-OVEN.fountain** - Main fountain file (Act 1 beginning)
2. **fountain-part2.txt** - Act 1 ending and Act 2 beginning
3. **fountain-part3.txt** - Act 2 continuation and ending
4. **fountain-part4.txt** - Act 3 complete

## How to Combine the Files

To create a single complete .fountain file, concatenate all parts in order:

### On Windows (PowerShell):
```powershell
Get-Content SELF-DESTRUCT-OVEN.fountain, fountain-part2.txt, fountain-part3.txt, fountain-part4.txt | Set-Content SELF-DESTRUCT-OVEN-COMPLETE.fountain
```

### On Mac/Linux (Terminal):
```bash
cat SELF-DESTRUCT-OVEN.fountain fountain-part2.txt fountain-part3.txt fountain-part4.txt > SELF-DESTRUCT-OVEN-COMPLETE.fountain
```

## Fountain Format Features Used

### Title Page
- `Title:` - Screenplay title
- `Credit:` - Credit line
- `Author:` - Author name
- `Draft date:` - Date of draft
- `Contact:` - Contact information and metadata

### Scene Headings
- `INT.` / `EXT.` - Interior/Exterior locations
- Scene descriptions in plain text

### Character Names
- ALL CAPS on their own line before dialogue
- Parentheticals in (parentheses) for direction

### Action
- Plain text for action/description
- Action lines describe what happens on screen

### Dialogue
- Character name in ALL CAPS
- Parenthetical direction in (parentheses)
- Dialogue text follows

### Transitions
- `FADE IN:` - Opening transition
- `FADE OUT.` - Closing transition
- `BLACKOUT.` - Instant to black

### Notes
- `> **TITLE CARD**:` - For on-screen text/graphics
- `# ACT 1:` - Section headers

## Compatible Applications

The .fountain format can be opened in:

- **Highland 2** (Mac/Windows) - Professional screenwriting app
- **Fade In** (Mac/Windows/Linux) - Professional screenwriting software
- **WriterDuet** (Web/Mac/Windows) - Collaborative screenwriting
- **Fountain.io** - Online Fountain editor
- **Final Draft** (with import) - Industry standard software
- **Celtx** (with import) - Pre-production software
- **Any text editor** - Fountain is plain text

## Fountain Syntax Reference

### Basic Elements

```
INT. LOCATION - DAY

Action description goes here.

CHARACTER NAME
(parenthetical)
Dialogue goes here.

CHARACTER NAME
More dialogue.
```

### Special Formatting

- **Bold**: `**text**`
- *Italic*: `*text*`
- ***Bold Italic***: `***text***`
- Underline: `_text_`

### Forced Elements

- Force scene heading: `.INT. LOCATION`
- Force character: `@CHARACTER`
- Force action: `!Action`
- Force dialogue: (automatic)

## Conversion Notes

The original markdown screenplay (FINAL-SCRIPT.md) has been converted to Fountain format with the following changes:

1. **Title page metadata** - Converted to Fountain title page format
2. **Scene headings** - Converted to proper INT./EXT. format
3. **Character names** - Ensured ALL CAPS formatting
4. **Dialogue** - Maintained parenthetical directions
5. **Action** - Converted stage directions to action lines
6. **Act breaks** - Marked with section headers (#)
7. **Production notes** - Removed (not part of screenplay proper)
8. **Title cards** - Converted to centered text with `>`

## Runtime

**Total Runtime**: 4:00 minutes (as specified in original)

## Usage

Once combined into a single .fountain file, you can:

1. **Import into screenwriting software** for professional formatting
2. **Export to PDF** in industry-standard screenplay format
3. **Collaborate** using Fountain-compatible tools
4. **Version control** using Git (plain text format)
5. **Convert to other formats** (PDF, FDX, HTML, etc.)

## Benefits of Fountain Format

- **Plain text** - Easy to version control and diff
- **Future-proof** - Not tied to proprietary software
- **Portable** - Works on any platform
- **Readable** - Human-readable even without special software
- **Professional** - Exports to industry-standard formats
- **Free** - No licensing required for the format itself

## Next Steps

1. Combine the four parts into a single .fountain file
2. Open in your preferred screenwriting application
3. Export to PDF for distribution
4. Use for production planning and script breakdown

---

**Created**: 2026-02-07  
**Source**: FINAL-SCRIPT.md  
**Format**: Fountain (.fountain)  
**Runtime**: 4:00 minutes

