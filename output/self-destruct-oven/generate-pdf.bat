@echo off
echo ========================================
echo  Fountain to HTML/PDF Converter
echo  SELF-DESTRUCT OVEN Screenplay
echo ========================================
echo.

echo Converting fountain file to HTML...
python convert-to-html.py

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo  SUCCESS! HTML file created.
    echo ========================================
    echo.
    echo Opening HTML file in your default browser...
    start SELF-DESTRUCT-OVEN.html
    echo.
    echo NEXT STEPS:
    echo 1. Click the "Print / Save as PDF" button
    echo 2. Or press Ctrl+P to print
    echo 3. Select "Save as PDF" as your printer
    echo 4. Choose where to save your PDF
    echo.
) else (
    echo.
    echo ========================================
    echo  ERROR: Conversion failed
    echo ========================================
    echo.
    echo Possible issues:
    echo - Python is not installed
    echo - Fountain file is missing
    echo - Script has errors
    echo.
    echo Try running: python convert-to-html.py
    echo to see the error message.
    echo.
)

pause

