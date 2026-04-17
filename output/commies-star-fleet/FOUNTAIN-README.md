# Space Commies - Fountain Screenplay

## Overview

This directory contains the complete Fountain-formatted screenplay for **"Space Commies"**, an SNL sketch in production-ready format.

**File:** `SPACE-COMMIES.fountain`  
**Format:** Fountain markup language  
**Status:** Production Ready (Version 1.0 FINAL)  
**Lock Date:** 2026-02-19

---

## What is Fountain?

Fountain is a simple markup syntax for writing, editing, and sharing screenplays in plain text. It's designed to be human-readable and easily converted to industry-standard screenplay formats.

**Benefits:**
- Plain text format (works with any text editor)
- Version control friendly (Git-compatible)
- Converts to PDF, Final Draft, and other formats
- Industry-standard formatting
- Free and open-source

**Learn more:** https://fountain.io

---

## File Structure

### SPACE-COMMIES.fountain

The complete screenplay includes:

1. **Title Page**
   - Title, author, draft date, contact info

2. **Script Metadata** (in comments)
   - Logline
   - Cast list
   - Set description
   - Runtime specifications

3. **Complete Screenplay**
   - Cold Open (0:00-0:30)
   - The Escalation (0:30-2:00)
   - The Twisted Logic (1:20-2:00)
   - The Button (2:00-3:30)

4. **Production Notes** (in comments)
   - Timing cues
   - Performance emphasis
   - Technical requirements
   - Set dressing
   - Props and costumes
   - Legal clearances

---

## Converting to PDF

### Option 1: Online Converters

**Fountain.io Web App:**
1. Go to https://fountain.io/dingus
2. Paste the contents of `SPACE-COMMIES.fountain`
3. Download as PDF

**Afterwriting:**
1. Go to https://afterwriting.com
2. Upload `SPACE-COMMIES.fountain`
3. Export as PDF

### Option 2: Command Line Tools

**Using Afterwriting CLI:**
```bash
npm install -g afterwriting
afterwriting --source SPACE-COMMIES.fountain --pdf SPACE-COMMIES.pdf
```

**Using Fountain CLI:**
```bash
npm install -g fountain-cli
fountain SPACE-COMMIES.fountain > SPACE-COMMIES.pdf
```

### Option 3: Desktop Applications

**Highland 2** (Mac/Windows)
- Free screenplay software
- Native Fountain support
- Professional PDF export
- Download: https://highland2.app

**Fade In** (Mac/Windows/Linux)
- Professional screenwriting software
- Imports Fountain files
- Industry-standard PDF export
- Download: https://www.fadeinpro.com

**WriterDuet** (Web/Desktop)
- Collaborative screenwriting
- Fountain import/export
- Real-time collaboration
- https://writerduet.com

---

## Fountain Syntax Quick Reference

### Scene Headings
```
INT. STARFLEET BRIDGE - CONTINUOUS
```

### Character Names
```
CAPTAIN
```

### Dialogue
```
CAPTAIN
I'm not going to follow Starfleet regulations.
```

### Parentheticals
```
CAPTAIN
(deadpan)
I'm not going to follow morality.
```

### Action
```
Red alert lights FLASH. Klaxon BLARES softly in background.
```

### Transitions
```
FADE OUT.
```

### Comments (not printed)
```
/* This is a comment */
```

### Section Headings (not printed)
```
> COLD OPEN (0:00-0:30) <
```

---

## Production Workflow

### 1. Script Development ✅
- Table read conducted
- Feedback incorporated
- Timing marks finalized
- S&P approval obtained
- **Status:** COMPLETE

### 2. Casting ✅
- All roles cast
- Chemistry read approved
- Final cast confirmed
- **Status:** COMPLETE

### 3. Legal & Clearances ✅
- Parody protection confirmed
- S&P approval obtained
- **Status:** COMPLETE

### 4. Production Design (Next Phase)
- Set design
- Costume design
- Props creation

### 5. Technical Production
- Sound design
- Visual effects
- Lighting design

### 6. Rehearsals
- Blocking rehearsal
- Performance rehearsal

### 7. Filming
- Technical setup
- Sketch takes
- Coverage shots

### 8. Post-Production
- Editing
- Sound mix
- VFX integration
- Color correction
- Final delivery

---

## Documentation References

### OpenSpec Documentation
- `openspec/specs/script-spec.md` - Detailed script with timing marks
- `openspec/specs/character-spec.md` - Character profiles
- `openspec/specs/production-spec.md` - Set, costume, props
- `openspec/specs/technical-spec.md` - Lighting, sound, VFX
- `openspec/design.md` - Creative direction
- `openspec/tasks.md` - Production task breakdown

### Production Documentation
- `production/script-development-complete.md` - Script development report
- `production/casting-complete.md` - Casting report
- `production/legal-clearances-complete.md` - Legal clearances report
- `production/phase1-completion-summary.md` - Phase 1 summary

### Source Material
- `commies-star-fleet.md` - Original sketch concept

---

## Version History

**Version 1.0 FINAL** (2026-02-19)
- Complete screenplay with timing marks
- Production notes included
- Legal clearances confirmed
- Ready for production

---

## Contact

**Production Team:** SNL Writers Room  
**Status:** Production Ready  
**Next Phase:** Production Design

For questions or updates, refer to the OpenSpec documentation in `openspec/` directory.

---

**Generated from Bead Tasks:**
- screenplays-y35 (Pre-Production Planning)
- screenplays-y35.1 (Script Development)
- screenplays-y35.2 (Casting)
- screenplays-y35.3 (Legal & Clearances)

