#!/bin/bash
# Re-extract all PDFs using pdftotext (no layout mode - preserves reading order)
# Much faster and cleaner than OCR!

PDF_DIR="../downloads/pdf/filestoprocess"
OUTPUT_DIR="../downloads/pdf/OCR_clean"

mkdir -p "$OUTPUT_DIR"

echo "=============================================="
echo "PDF Text Extraction (pdftotext - reading order)"
echo "=============================================="
echo ""
echo "Input:  $PDF_DIR"
echo "Output: $OUTPUT_DIR"
echo ""

count=0
total=$(ls -1 "$PDF_DIR"/*.pdf 2>/dev/null | wc -l | tr -d ' ')

for pdf in "$PDF_DIR"/*.pdf; do
    if [ -f "$pdf" ]; then
        filename=$(basename "$pdf" .pdf)
        output="$OUTPUT_DIR/${filename}.txt"
        
        count=$((count + 1))
        echo "[$count/$total] $filename"
        
        # Extract text with pdftotext (no -layout = reading order)
        pdftotext "$pdf" "$output" 2>/dev/null
        
        if [ -f "$output" ]; then
            chars=$(wc -c < "$output" | tr -d ' ')
            echo "  ✓ ${chars} characters"
        else
            echo "  ✗ Failed"
        fi
    fi
done

echo ""
echo "=============================================="
echo "Complete! Extracted $count files"
echo "Output: $OUTPUT_DIR"
echo "=============================================="

