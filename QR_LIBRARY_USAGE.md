# QR Library Manager - Usage Guide

## Overview

The QR Library Manager provides a unified API for generating QR codes using multiple libraries. It automatically selects the best library based on your requirements and handles dynamic loading.

## Supported Libraries

1. **QRCode.js** (current default)
   - Basic QR generation
   - Canvas output
   - Fast and lightweight
   - ❌ No logo, SVG, or styling support

2. **QR Code Styling** (recommended for artistic QR)
   - ✅ Logo embedding
   - ✅ SVG/PNG export
   - ✅ Gradients & dot styling
   - ✅ Custom corners
   - ✅ High resolution

3. **node-qrcode**
   - ✅ SVG/PNG export
   - ✅ Fast generation
   - ✅ High resolution
   - ❌ No logo or styling

4. **kjua**
   - ✅ Logo embedding
   - ✅ Fast generation
   - ❌ No SVG or gradients

5. **Awesome QR** (future)
   - ✅ Background images
   - ✅ Logo embedding
   - ❌ Slower generation

## Quick Start

### Initialize Manager

```javascript
const qrManager = new QRLibraryManager();
```

### Basic QR Code (uses existing QRCode.js)

```javascript
const container = document.getElementById('qrcode-container');

await qrManager.generate(container, {
    text: 'https://example.com',
    width: 256,
    height: 256,
    colorDark: '#000000',
    colorLight: '#ffffff',
    errorCorrectionLevel: 'M'
});
```

### QR Code with Logo (auto-switches to QR Code Styling)

```javascript
await qrManager.generate(container, {
    text: 'https://example.com',
    width: 512,
    height: 512,
    logo: {
        src: '/path/to/logo.png',
        width: 80,
        height: 80
    },
    errorCorrectionLevel: 'H' // Higher correction for logo
});
```

### Artistic QR with Gradient (auto-switches to QR Code Styling)

```javascript
await qrManager.generate(container, {
    text: 'https://example.com',
    width: 512,
    height: 512,
    gradient: {
        type: 'linear',
        rotation: 0,
        colorStops: [
            { offset: 0, color: '#667eea' },
            { offset: 1, color: '#764ba2' }
        ]
    },
    dotsOptions: {
        type: 'rounded',
        color: '#667eea'
    },
    cornersSquareOptions: {
        type: 'extra-rounded',
        color: '#764ba2'
    },
    cornersDotOptions: {
        type: 'dot',
        color: '#667eea'
    },
    artistic: true
});
```

### SVG Export (auto-switches to node-qrcode or QR Code Styling)

```javascript
await qrManager.generate(container, {
    text: 'https://example.com',
    width: 512,
    height: 512,
    format: 'svg',
    colorDark: '#000000',
    colorLight: '#ffffff'
});
```

### PNG DataURL Export

```javascript
const result = await qrManager.generate(container, {
    text: 'https://example.com',
    width: 512,
    height: 512,
    format: 'dataURL'
});

// result.dataURL contains the PNG dataURL
console.log(result.dataURL);
```

## Unified Options Schema

```javascript
{
    // Required
    text: 'Data to encode',
    
    // Size
    width: 256,           // Default: 256
    height: 256,          // Default: 256
    
    // Error Correction
    errorCorrectionLevel: 'M', // L, M, Q, H
    
    // Colors
    colorDark: '#000000',      // QR code color
    colorLight: '#ffffff',     // Background color
    
    // Gradient (QR Code Styling only)
    gradient: {
        type: 'linear',        // 'linear' or 'radial'
        rotation: 0,           // Angle in degrees
        colorStops: [
            { offset: 0, color: '#667eea' },
            { offset: 1, color: '#764ba2' }
        ]
    },
    
    // Logo (QR Code Styling, kjua, Awesome QR)
    logo: {
        src: '/path/to/logo.png',
        width: 80,
        height: 80
    },
    
    // Dot Styling (QR Code Styling only)
    dotsOptions: {
        type: 'rounded',       // 'rounded', 'dots', 'classy', 'square'
        color: '#667eea'
    },
    
    // Corner Styling (QR Code Styling only)
    cornersSquareOptions: {
        type: 'extra-rounded', // 'dot', 'square', 'extra-rounded'
        color: '#764ba2'
    },
    
    cornersDotOptions: {
        type: 'dot',           // 'dot', 'square'
        color: '#667eea'
    },
    
    // Background (QR Code Styling, Awesome QR)
    backgroundOptions: {
        color: '#ffffff',
        image: '/path/to/background.png' // Awesome QR only
    },
    
    // Output Format
    format: 'canvas',      // 'canvas', 'svg', 'png', 'dataURL'
    
    // Margins
    quietZone: 4,          // Margin size
    
    // Performance mode
    artistic: false        // Enable artistic features
}
```

## Advanced Usage

### Check Available Libraries

```javascript
const libraries = qrManager.getAvailableLibraries();
libraries.forEach(lib => {
    console.log(`${lib.name}: ${lib.loaded ? 'Loaded' : 'Not loaded'}`);
});
```

### Set Preferred Library

```javascript
// Force use of specific library (if it supports required features)
qrManager.setPreferredLibrary('qr-code-styling');
```

### Check Library Capabilities

```javascript
const capabilities = qrManager.getLibraryCapabilities('qr-code-styling');
console.log('Supports logo:', capabilities.features.logo_embedding);
console.log('Supports SVG:', capabilities.features.svg_output);
console.log('Supports gradients:', capabilities.features.gradient_support);
```

### Feature Detection

```javascript
// The manager automatically detects required features:
// - Logo present → needs logo_embedding feature
// - format: 'svg' → needs svg_output feature
// - gradient present → needs gradient_support feature
// - dotsOptions present → needs dot_styling feature
// - artistic: true → needs dot_styling + corner_styling

// It then selects the best library that supports all features
```

## Library Selection Logic

The manager automatically selects libraries based on:

1. **Required Features**: Analyzes your options to determine which features are needed
2. **Library Priority**: Higher priority libraries are preferred when multiple support features
3. **Fallback**: If no library supports all features, falls back to basic QRCode.js
4. **Performance**: Considers library file size and generation speed

### Priority Order

1. QR Code Styling (priority 10) - Best for artistic QR codes
2. Awesome QR (priority 9) - Best for background images
3. node-qrcode (priority 7) - Best for SVG/PNG export
4. kjua (priority 6) - Good for logo embedding
5. QRCode.js (priority 1) - Fallback for basic QR codes

## Examples by Use Case

### Business Card QR Code

```javascript
await qrManager.generate(container, {
    text: 'BEGIN:VCARD\nVERSION:3.0\nFN:John Doe\nTEL:+1234567890\nEND:VCARD',
    width: 512,
    height: 512,
    logo: {
        src: '/company-logo.png',
        width: 100,
        height: 100
    },
    colorDark: '#1a1a1a',
    errorCorrectionLevel: 'H',
    dotsOptions: {
        type: 'rounded',
        color: '#1a1a1a'
    },
    cornersSquareOptions: {
        type: 'extra-rounded',
        color: '#1a1a1a'
    }
});
// Auto-selects: QR Code Styling (logo + styling)
```

### WiFi QR Code

```javascript
await qrManager.generate(container, {
    text: 'WIFI:T:WPA;S:MyNetwork;P:MyPassword;;',
    width: 400,
    height: 400,
    colorDark: '#4A90E2',
    colorLight: '#f0f9ff',
    errorCorrectionLevel: 'M'
});
// Auto-selects: QRCode.js (basic, fast)
```

### Event Poster QR (High Resolution SVG)

```javascript
await qrManager.generate(container, {
    text: 'https://event.example.com',
    width: 2048,
    height: 2048,
    format: 'svg',
    gradient: {
        type: 'linear',
        rotation: 45,
        colorStops: [
            { offset: 0, color: '#FF6B6B' },
            { offset: 1, color: '#FFE66D' }
        ]
    },
    dotsOptions: {
        type: 'rounded'
    },
    cornersSquareOptions: {
        type: 'extra-rounded'
    },
    errorCorrectionLevel: 'H'
});
// Auto-selects: QR Code Styling (SVG + gradient + styling)
```

### Product Label QR (with Background)

```javascript
await qrManager.generate(container, {
    text: 'https://product.example.com/12345',
    width: 600,
    height: 600,
    backgroundOptions: {
        image: '/product-texture.png'
    },
    logo: {
        src: '/brand-logo.png',
        width: 120,
        height: 120
    },
    errorCorrectionLevel: 'H'
});
// Auto-selects: Awesome QR (background image)
```

## Integration with Existing Code

### Replace Existing QRCode.js Usage

**Before:**
```javascript
const qrcode = new QRCode(container, {
    text: url,
    width: 256,
    height: 256,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
});
```

**After:**
```javascript
const qrManager = new QRLibraryManager();
await qrManager.generate(container, {
    text: url,
    width: 256,
    height: 256,
    colorDark: '#000000',
    colorLight: '#ffffff',
    errorCorrectionLevel: 'M'
});
```

### Add Logo Support to Existing Generator

```javascript
const qrManager = new QRLibraryManager();

// Check if user uploaded logo
const logoFile = document.getElementById('logo-upload').files[0];
const options = {
    text: url,
    width: 512,
    height: 512,
    colorDark: '#000000',
    colorLight: '#ffffff',
    errorCorrectionLevel: 'H'
};

if (logoFile) {
    // Add logo to options
    options.logo = {
        src: URL.createObjectURL(logoFile),
        width: 100,
        height: 100
    };
}

// Manager automatically uses QR Code Styling if logo present
await qrManager.generate(container, options);
```

## Error Handling

```javascript
try {
    const result = await qrManager.generate(container, options);
    console.log('Generated with:', result.library);
} catch (error) {
    console.error('QR generation failed:', error);
    // Fallback to basic generation
    alert('Failed to generate artistic QR. Try basic mode.');
}
```

## Performance Considerations

- **First Load**: Libraries are loaded on-demand (~100-500ms delay)
- **Subsequent Calls**: Use cached libraries (instant)
- **Basic QR**: QRCode.js is already loaded (no delay)
- **Artistic QR**: QR Code Styling loads on first use (~400KB)
- **SVG Export**: node-qrcode loads on first use (~100KB)

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support
- Mobile: Full support

## CDN URLs (Auto-loaded)

The manager automatically loads libraries from CDN when needed:

- QRCode.js: `https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js`
- QR Code Styling: `https://cdn.jsdelivr.net/npm/qr-code-styling@1.6.0-rc.1/lib/qr-code-styling.js`
- node-qrcode: `https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js`
- kjua: `https://cdn.jsdelivr.net/npm/kjua@0.9.0/dist/kjua.min.js`

## Debugging

Enable console logging to see library selection:

```javascript
// The manager automatically logs:
// 📊 Required features: [basic_generation, logo_embedding, ...]
// 🎯 Selected library: QR Code Styling
// ⏳ Loading QR Code Styling...
// ✅ Loaded QR Code Styling
```

## Testing

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script src="qr-library-manager.js"></script>
</head>
<body>
    <div id="qr-basic"></div>
    <div id="qr-logo"></div>
    <div id="qr-artistic"></div>
    
    <script>
        const manager = new QRLibraryManager();
        
        // Test 1: Basic QR
        manager.generate(document.getElementById('qr-basic'), {
            text: 'https://example.com',
            width: 256,
            height: 256
        });
        
        // Test 2: QR with Logo
        manager.generate(document.getElementById('qr-logo'), {
            text: 'https://example.com',
            width: 512,
            height: 512,
            logo: {
                src: 'logo.png',
                width: 80,
                height: 80
            }
        });
        
        // Test 3: Artistic QR
        manager.generate(document.getElementById('qr-artistic'), {
            text: 'https://example.com',
            width: 512,
            height: 512,
            gradient: {
                type: 'linear',
                rotation: 45,
                colorStops: [
                    { offset: 0, color: '#667eea' },
                    { offset: 1, color: '#764ba2' }
                ]
            },
            dotsOptions: { type: 'rounded' },
            cornersSquareOptions: { type: 'extra-rounded' },
            artistic: true
        });
    </script>
</body>
</html>
```

## Migration Guide

See [MIGRATION.md](MIGRATION.md) for step-by-step guide to migrate existing app.js code.
