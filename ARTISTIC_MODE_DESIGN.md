# Artistic/Brand Mode Design Document

**Branch**: `artistic-brand-mode-experiment`  
**Date**: March 10, 2026  
**Baseline**: `stable-v1-baseline` branch

## Research Findings (ChatGPT Recommendations)

1. **Keep QRCode.js** for stable mode - proven, reliable
2. **Add qr-code-styling** or styled-qr-code for Artistic/Brand mode
3. **Keep jsQR** for validation/scan testing

## Implementation Strategy

### Phase 1: Add Mode Toggle
- Add "Generation Mode" selector in UI
  - ⚡ Standard Mode (QRCode.js - current)
  - 🎨 Artistic Mode (qr-code-styling - new)
- Save mode preference to state history

### Phase 2: Integrate qr-code-styling Library
```html
<!-- Add to index.html -->
<script src="https://unpkg.com/qr-code-styling@1.6.0-rc.1/lib/qr-code-styling.js"></script>
```

### Phase 3: Artistic Mode Features
**qr-code-styling capabilities:**
- ✨ Gradient fills (linear/radial)
- 🔘 Rounded/dotted patterns
- 🎯 Custom corner styles (square, extra-rounded, dot)
- 🖼️ Better logo integration
- 🎨 Per-element coloring (dots, corners, background separately)

### Phase 4: UI Enhancements
**New Controls for Artistic Mode:**
- Dot style: square | dots | rounded | extra-rounded | classy | classy-rounded
- Corner square style: square | extra-rounded | dot
- Corner dot style: square | dot
- Gradient options: none | linear | radial
- Gradient colors (if enabled)

**Hide these when in Standard Mode** (keep UI simple)

## Code Structure

### Current Flow
```javascript
function generateQRCode() {
    // Uses QRCode.js
    const qr = new QRCode(tempDiv, { ... });
}
```

### New Flow
```javascript
function generateQRCode() {
    if (generationMode === 'standard') {
        generateStandardQR(); // current QRCode.js logic
    } else {
        generateArtisticQR(); // new qr-code-styling logic
    }
}

function generateStandardQR() {
    // Existing QRCode.js code (unchanged)
}

function generateArtisticQR() {
    // New qr-code-styling implementation
    const qrCode = new QRCodeStyling({
        width: qrSize,
        height: qrSize,
        data: text,
        dotsOptions: {
            color: currentDarkColor,
            type: dotStyle // 'rounded', 'dots', 'classy', etc.
        },
        backgroundOptions: {
            color: currentLightColor,
        },
        cornersSquareOptions: {
            color: currentDarkColor,
            type: cornerSquareStyle
        },
        cornersDotOptions: {
            color: currentDarkColor,
            type: cornerDotStyle
        },
        imageOptions: {
            crossOrigin: "anonymous",
            margin: 10
        }
    });
}
```

## Rollback Plan

If experiments don't work out:
```bash
git checkout main
git merge stable-v1-baseline
```

## Success Criteria

- ✅ Standard mode works exactly as before
- ✅ Artistic mode generates scannable QR codes
- ✅ All existing features (logo, colors, labels) work in both modes
- ✅ Performance is acceptable
- ✅ No breaking changes to existing functionality

## Libraries Comparison

| Feature | QRCode.js | qr-code-styling |
|---------|-----------|-----------------|
| File Size | ~26KB | ~67KB |
| Gradients | ❌ | ✅ |
| Rounded Dots | ❌ | ✅ |
| Custom Corners | ❌ | ✅ |
| Logo Support | ⚠️ (manual) | ✅ (built-in) |
| Browser Support | ✅ Excellent | ✅ Good (ES6+) |
| Reliability | ✅ Battle-tested | ⚠️ Newer |

## Next Steps

1. Add mode selector to UI
2. Load qr-code-styling library
3. Implement generateArtisticQR() function
4. Add artistic mode controls (collapsible section)
5. Test thoroughly with various QR code types
6. Validate scannability
7. Decide: merge to main or continue iterating

---

## Notes
- Keep both libraries loaded for easy switching
- Cache artistic mode settings in localStorage
- Add analytics to track which mode is more popular
- Consider adding presets: "Minimalist", "Bold", "Elegant"
