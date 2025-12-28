# Artistic QR Code Generator - User Guide

## 🎨 New Features Added

Your QR code generator now supports creating artistic QR codes that blend beautiful imagery with functional QR codes!

## 📋 How to Use

### Option 1: Upload Your Own Background Image

1. **Enter your QR code data** (URL, text, etc.)
2. **Scroll to "🎨 Artistic QR Code" section**
3. **Click "📁 Upload Image"** (default selected)
4. **Click "Select Background Image"**
5. **Choose an image** from your computer
6. **Click "Generate QR Code"**
7. **Adjust the blend settings:**
   - **Blend Mode**: Try different artistic effects
     - Overlay: Best for most images
     - Multiply: Darker, artistic effect
     - Screen: Lighter blending
     - Normal: Simple transparency blend
   - **Background Opacity**: Control how visible the background is (10-100%)
   - **QR Code Strength**: Ensure the QR remains scannable (40-100%)

### Option 2: AI-Generated Background

1. **Enter your QR code data**
2. **Scroll to "🎨 Artistic QR Code" section**
3. **Click "🤖 AI Generate"**
4. **Enter a description** of the image you want:
   - Example: "A serene forest with sunlight filtering through trees, digital art style"
   - Example: "Neon cyberpunk city at night with flying cars"
   - Example: "Abstract geometric patterns in blue and purple"
5. **Click "Generate Image"** (wait ~5-10 seconds)
6. **Once generated, click "Generate QR Code"**
7. **Adjust blend settings** as needed

## ✅ QR Code Validation

After generating your artistic QR code, the system automatically tests if it's still scannable:

- **✓ Green**: QR code is scannable! You're good to go!
- **✗ Red**: QR may not scan properly. Try:
  - Increasing QR Code Strength (to 90-100%)
  - Decreasing Background Opacity (to 30-50%)
  - Changing the Blend Mode to "Overlay"
  - Using a less busy background image

## 🎯 Tips for Best Results

### For Scannable QR Codes:
1. **Start with these settings:**
   - Background Opacity: 40-50%
   - QR Code Strength: 80-90%
   - Blend Mode: Overlay

2. **Choose backgrounds with:**
   - Simple patterns or gradients
   - Not too many fine details
   - Good contrast areas

3. **Avoid backgrounds with:**
   - Very busy patterns
   - Text or QR-like patterns
   - High-frequency noise

### For AI Image Generation:
1. **Be specific** in your prompts
2. **Add style keywords**: "digital art", "watercolor", "minimalist", "photorealistic"
3. **Try multiple times** - each generation is unique
4. **Common subjects that work well:**
   - Nature scenes (forests, mountains, beaches)
   - Abstract patterns
   - Geometric designs
   - Gradients and color fields
   - Space/galaxy themes

## 🔄 Workflow Example

1. Enter QR data: `https://yourwebsite.com`
2. Click "🤖 AI Generate"
3. Prompt: "Abstract purple and blue gradient with geometric patterns"
4. Click "Generate Image"
5. Click "Generate QR Code"
6. Check validation - if red:
   - Increase QR Strength to 90%
   - Decrease Background Opacity to 40%
7. Click "Generate QR Code" again
8. Validation turns green ✓
9. Download as PNG/JPG/SVG

## 🆓 Free AI Generation

This implementation uses **Pollinations.ai**, which is:
- ✅ **Completely free**
- ✅ **No API key required**
- ✅ **No sign-up needed**
- ✅ **Works directly from your browser**
- ✅ **Generates 1024x1024 images**

## 🚀 Technical Details

### Blend Modes Explained:
- **Overlay**: Combines dark and light areas intelligently (recommended)
- **Multiply**: Darkens the image where QR is dark
- **Screen**: Lightens the image where QR is light
- **Normal**: Simple alpha blending
- **Darken**: Takes the darker of QR or background
- **Lighten**: Takes the lighter of QR or background

### Validation Process:
The app uses the jsQR library to scan your generated QR code in real-time, ensuring it actually works before you download it. This is the same technology used by phone cameras!

## 📝 Notes

- **All processing is done locally** in your browser
- **No data is sent to servers** (except AI image generation)
- **Works offline** (after first load, except AI generation)
- **Your QR data stays private**
- **AI images are generated fresh** each time

## 🎨 Examples of Good Prompts

### Nature Themes:
- "Peaceful mountain landscape at sunset with purple sky"
- "Underwater coral reef with colorful fish, vibrant"
- "Cherry blossom trees in spring, soft pink tones"

### Abstract/Artistic:
- "Fluid abstract art with gold and teal swirls"
- "Geometric low-poly background in pastel colors"
- "Watercolor splash in blue and purple tones"

### Modern/Tech:
- "Futuristic holographic interface, neon blue and pink"
- "Digital circuit board pattern, minimalist"
- "Cyberpunk cityscape at night, neon lights"

### Business/Professional:
- "Clean minimalist background with subtle gradient"
- "Professional marble texture with gold accents"
- "Corporate blue geometric pattern, modern"

## 🔧 Troubleshooting

**Problem**: AI image won't generate
- **Solution**: Check your internet connection. Pollinations.ai requires internet access.

**Problem**: QR code validation shows red
- **Solution**: Increase QR Strength to 85-95% and decrease Background Opacity to 35-45%

**Problem**: Background doesn't show
- **Solution**: Make sure you clicked "Generate QR Code" after selecting/generating the background

**Problem**: Generated QR has artifacts
- **Solution**: Try a simpler background image or adjust blend mode to "Overlay"

## 📱 Testing Your QR Code

Always test your artistic QR code with a real phone camera before printing or sharing widely:
1. Download the QR code
2. Open it on your computer screen or print it
3. Scan with your phone's camera app
4. Verify it opens the correct URL/content

Enjoy creating beautiful, functional QR codes! 🎉
