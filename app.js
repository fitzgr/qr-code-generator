// QR Code Generator Web App
let selectedLogo = null;
let currentQRDataURL = null;
let currentQRStyle = 'squares';
let currentDarkColor = '#000000';
let currentLightColor = '#ffffff';

// DOM Elements
const textInput = document.getElementById('textInput');
const logoInput = document.getElementById('logoInput');
const selectLogoBtn = document.getElementById('selectLogoBtn');
const clearLogoBtn = document.getElementById('clearLogoBtn');
const logoStatus = document.getElementById('logoStatus');
const generateBtn = document.getElementById('generateBtn');
const downloadPngBtn = document.getElementById('downloadPngBtn');
const downloadSvgBtn = document.getElementById('downloadSvgBtn');
const downloadJpgBtn = document.getElementById('downloadJpgBtn');
const clearBtn = document.getElementById('clearBtn');
const qrCanvas = document.getElementById('qrCanvas');
const previewPlaceholder = document.getElementById('previewPlaceholder');

// Range inputs
const sizeRange = document.getElementById('sizeRange');
const borderRange = document.getElementById('borderRange');
const logoSizeRange = document.getElementById('logoSizeRange');
const sizeValue = document.getElementById('sizeValue');
const borderValue = document.getElementById('borderValue');
const logoSizeValue = document.getElementById('logoSizeValue');

// Color inputs
const darkColorPicker = document.getElementById('darkColorPicker');
const lightColorPicker = document.getElementById('lightColorPicker');
const darkColorText = document.getElementById('darkColorText');
const lightColorText = document.getElementById('lightColorText');
const colorPresets = document.querySelectorAll('.color-preset');
const styleBtns = document.querySelectorAll('.style-btn');

// Quick template buttons
const templateBtns = document.querySelectorAll('.template-btn');

templateBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const template = btn.dataset.template;
        let templateText = '';
        
        switch(template) {
            case 'url':
                templateText = 'https://';
                break;
            case 'email':
                templateText = 'mailto:your@email.com';
                break;
            case 'phone':
                templateText = 'tel:+1234567890';
                break;
            case 'sms':
                templateText = 'sms:+1234567890?body=Your message here';
                break;
            case 'wifi':
                templateText = 'WIFI:T:WPA;S:NetworkName;P:Password;;';
                break;
        }
        
        textInput.value = templateText;
        textInput.focus();
        
        // Select the template text for easy editing
        if (template === 'url') {
            textInput.setSelectionRange(8, 8); // Place cursor after https://
        } else {
            textInput.select();
        }
    });
});

// Color preset buttons
colorPresets.forEach(btn => {
    btn.addEventListener('click', () => {
        const darkColor = btn.dataset.dark;
        const lightColor = btn.dataset.light;
        
        darkColorPicker.value = darkColor;
        lightColorPicker.value = lightColor;
        darkColorText.value = darkColor;
        lightColorText.value = lightColor;
        currentDarkColor = darkColor;
        currentLightColor = lightColor;
        
        // Update active state
        colorPresets.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Track color preset selection
        if (typeof gtag !== 'undefined') {
            gtag('event', 'color_preset_selected', {
                'dark_color': darkColor,
                'light_color': lightColor
            });
        }
    });
});

// Set first preset as active
colorPresets[0].classList.add('active');

// Color picker sync
darkColorPicker.addEventListener('input', (e) => {
    const color = e.target.value;
    darkColorText.value = color;
    currentDarkColor = color;
    colorPresets.forEach(b => b.classList.remove('active'));
});

lightColorPicker.addEventListener('input', (e) => {
    const color = e.target.value;
    lightColorText.value = color;
    currentLightColor = color;
    colorPresets.forEach(b => b.classList.remove('active'));
});

darkColorText.addEventListener('input', (e) => {
    let color = e.target.value;
    if (/^#[0-9A-F]{6}$/i.test(color)) {
        darkColorPicker.value = color;
        currentDarkColor = color;
        colorPresets.forEach(b => b.classList.remove('active'));
    }
});

lightColorText.addEventListener('input', (e) => {
    let color = e.target.value;
    if (/^#[0-9A-F]{6}$/i.test(color)) {
        lightColorPicker.value = color;
        currentLightColor = color;
        colorPresets.forEach(b => b.classList.remove('active'));
    }
});

// Style buttons
styleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        currentQRStyle = btn.dataset.style;
        styleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Track style selection
        if (typeof gtag !== 'undefined') {
            gtag('event', 'style_selected', {
                'style': currentQRStyle
            });
        }
    });
});

// Contrast validation function
function validateContrast(darkColor, lightColor) {
    // Convert hex to RGB
    const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    };
    
    // Calculate relative luminance
    const getLuminance = (rgb) => {
        const rsRGB = rgb.r / 255;
        const gsRGB = rgb.g / 255;
        const bsRGB = rgb.b / 255;
        
        const r = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
        const g = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
        const b = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
        
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    
    const rgb1 = hexToRgb(darkColor);
    const rgb2 = hexToRgb(lightColor);
    
    if (!rgb1 || !rgb2) return { valid: false, ratio: 0 };
    
    const lum1 = getLuminance(rgb1);
    const lum2 = getLuminance(rgb2);
    
    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    
    const ratio = (lighter + 0.05) / (darker + 0.05);
    
    // WCAG AA requires 4.5:1 for normal text, we'll use 3:1 for QR codes
    return {
        valid: ratio >= 3.0,
        ratio: ratio.toFixed(2)
    };
}

// Update range value displays
sizeRange.addEventListener('input', (e) => {
    sizeValue.textContent = e.target.value;
});

borderRange.addEventListener('input', (e) => {
    borderValue.textContent = e.target.value;
});

logoSizeRange.addEventListener('input', (e) => {
    logoSizeValue.textContent = e.target.value;
});

// Logo selection
selectLogoBtn.addEventListener('click', () => {
    logoInput.click();
});

logoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                selectedLogo = img;
                logoStatus.textContent = `Logo: ${file.name}`;
                logoStatus.style.color = '#4CAF50';
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

clearLogoBtn.addEventListener('click', () => {
    selectedLogo = null;
    logoInput.value = '';
    logoStatus.textContent = 'No logo selected';
    logoStatus.style.color = '#888';
});

// Generate QR Code
generateBtn.addEventListener('click', generateQRCode);

function generateQRCode() {
    const text = textInput.value.trim();
    
    if (!text) {
        alert('Please enter some text or URL!');
        return;
    }
    
    // Validate contrast
    const contrastCheck = validateContrast(currentDarkColor, currentLightColor);
    if (!contrastCheck.valid) {
        alert(`⚠️ Color Contrast Too Low!\n\nThe colors you selected don't have enough contrast for QR codes to scan reliably.\n\nContrast ratio: ${contrastCheck.ratio}:1 (minimum: 3.0:1)\n\nPlease choose colors with more contrast:\n• Dark QR code on light background\n• Light QR code on dark background\n• Use the color presets for safe combinations`);
        return;
    }

    try {
        // Clear previous QR code
        qrCanvas.getContext('2d').clearRect(0, 0, qrCanvas.width, qrCanvas.height);
        
        // QR code settings
        const size = parseInt(sizeRange.value);
        const border = parseInt(borderRange.value);
        const qrSize = size * 32; // Scale up for better quality
        
        // Create temporary container for QR generation
        const tempDiv = document.createElement('div');
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
        
        // Generate QR code
        const qr = new QRCode(tempDiv, {
            text: text,
            width: qrSize,
            height: qrSize,
            colorDark: currentDarkColor,
            colorLight: currentLightColor,
            correctLevel: QRCode.CorrectLevel.H
        });
        
        // Wait for QR code to be generated
        setTimeout(() => {
            const qrImage = tempDiv.querySelector('img');
            
            console.log('QR Image found:', qrImage);
            console.log('QR Image dimensions:', qrImage ? qrImage.width + 'x' + qrImage.height : 'none');
            console.log('QR Image src length:', qrImage ? qrImage.src.length : 0);
            
            if (qrImage && qrImage.complete) {
                drawQRWithLogo(qrImage, qrSize);
                document.body.removeChild(tempDiv);
            } else if (qrImage) {
                qrImage.onload = () => {
                    console.log('QR Image loaded:', qrImage.width + 'x' + qrImage.height);
                    drawQRWithLogo(qrImage, qrSize);
                    document.body.removeChild(tempDiv);
                };
            } else {
                console.error('No QR image generated!');
                document.body.removeChild(tempDiv);
            }
        }, 100);
        
    } catch (error) {
        alert('Failed to generate QR code: ' + error.message);
        console.error(error);
    }
}

function drawQRWithLogo(qrImage, qrSize) {
    const ctx = qrCanvas.getContext('2d');
    
    // Set canvas size
    qrCanvas.width = qrSize;
    qrCanvas.height = qrSize;
    
    // Disable image smoothing for crisp pixels (important for QR codes)
    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;
    
    // Draw QR code
    ctx.drawImage(qrImage, 0, 0, qrSize, qrSize);
    
    // Skip style effects entirely - they can cause rendering issues
    // Just use the original QR code from the library
    // if (currentQRStyle !== 'squares' && qrSize >= 200) {
    //     try {
    //         applyQRStyle(ctx, qrSize);
    //     } catch (error) {
    //         console.warn('Style application failed, using default squares:', error);
    //         // Redraw original if style fails
    //         ctx.clearRect(0, 0, qrSize, qrSize);
    //         ctx.drawImage(qrImage, 0, 0, qrSize, qrSize);
    //     }
    // }
    
    // Add logo if selected
    if (selectedLogo) {
        const logoSizePercent = parseInt(logoSizeRange.value) / 100;
        const logoSize = Math.floor(qrSize * logoSizePercent);
        const logoPos = (qrSize - logoSize) / 2;
        
        // Draw background for logo (use light color)
        const padding = 10;
        ctx.fillStyle = currentLightColor;
        ctx.fillRect(
            logoPos - padding,
            logoPos - padding,
            logoSize + padding * 2,
            logoSize + padding * 2
        );
        
        // Draw logo
        ctx.drawImage(selectedLogo, logoPos, logoPos, logoSize, logoSize);
    }
    
    // Show canvas and hide placeholder
    qrCanvas.classList.add('visible');
    previewPlaceholder.classList.add('hidden');
    
    // Store the data URL for download
    currentQRDataURL = qrCanvas.toDataURL('image/png');
    
    // Update analytics
    updateAnalytics(qrSize);
    
    // Track event in Google Analytics
    if (typeof gtag !== 'undefined') {
        gtag('event', 'qr_generated', {
            'qr_style': currentQRStyle,
            'has_logo': selectedLogo ? 'yes' : 'no',
            'logo_size': selectedLogo ? logoSizeRange.value : 0,
            'qr_size': size
        });
    }
    
    // Show success message
    showNotification('QR Code generated successfully!');
}

// Update analytics preview
function updateAnalytics(qrSize) {
    const text = textInput.value.trim();
    const textLength = text.length;
    
    // Estimate QR version based on data length and error correction
    // Version ranges: 1 (21x21) to 40 (177x177)
    let version = 1;
    const capacities = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271]; // Approximate for High EC
    for (let i = 0; i < capacities.length; i++) {
        if (textLength <= capacities[i]) {
            version = i + 1;
            break;
        }
    }
    if (textLength > capacities[capacities.length - 1]) {
        version = Math.min(40, Math.ceil(textLength / 100) + 10);
    }
    
    // Calculate modules (dots in QR code)
    const modules = 21 + (version - 1) * 4;
    
    // Calculate minimum print size (2.5mm per module minimum for scanning)
    const minSizeMM = Math.ceil(modules * 2.5);
    const minSizeInch = (minSizeMM / 25.4).toFixed(1);
    
    // Estimate data capacity remaining
    const maxCapacity = version <= 10 ? capacities[version - 1] : Math.floor(version * 100);
    const usedPercent = Math.round((textLength / maxCapacity) * 100);
    
    // Get contrast ratio
    const contrastCheck = validateContrast(currentDarkColor, currentLightColor);
    
    // Update UI
    document.getElementById('qrVersion').textContent = version;
    document.getElementById('qrModules').textContent = `${modules}×${modules}`;
    document.getElementById('qrMinSize').textContent = `${minSizeMM}mm (${minSizeInch}\")`;
    
    const capacityEl = document.getElementById('qrDataCapacity');
    capacityEl.textContent = `${usedPercent}% used`;
    capacityEl.className = 'analytics-value';
    if (usedPercent < 70) capacityEl.classList.add('good');
    else if (usedPercent < 90) capacityEl.classList.add('warning');
    else capacityEl.classList.add('error');
    
    const contrastEl = document.getElementById('qrContrast');
    contrastEl.textContent = `${contrastCheck.ratio}:1`;
    contrastEl.className = 'analytics-value';
    if (contrastCheck.ratio >= 7) contrastEl.classList.add('good');
    else if (contrastCheck.ratio >= 4.5) contrastEl.classList.add('warning');
    else contrastEl.classList.add('error');    
    // Calculate and display quality score
    calculateQualityScore(contrastCheck.ratio, usedPercent, qrSize);
}

// Calculate Quality Score
function calculateQualityScore(contrastRatio, dataUsage, qrSize) {
    let score = 0;
    const recommendations = [];
    
    // 1. Contrast Ratio (30 points)
    if (contrastRatio >= 21) {
        score += 30;
    } else if (contrastRatio >= 7) {
        score += 25;
        recommendations.push({
            type: 'info',
            icon: 'ℹ️',
            text: 'Good contrast! Consider darker colors for even better scanning.',
            action: null
        });
    } else if (contrastRatio >= 4.5) {
        score += 20;
        recommendations.push({
            type: 'warning',
            icon: '⚠️',
            text: 'Contrast is acceptable but could be improved. Try ',
            actionText: 'switching to black on white',
            action: () => applyColorPreset('#000000', '#ffffff')
        });
    } else if (contrastRatio >= 3) {
        score += 10;
        recommendations.push({
            type: 'warning',
            icon: '⚠️',
            text: 'Low contrast may affect scanning. Click to ',
            actionText: 'use high contrast colors',
            action: () => applyColorPreset('#000000', '#ffffff')
        });
    } else {
        score += 0;
        recommendations.push({
            type: 'warning',
            icon: '❌',
            text: 'Contrast too low! QR code may not scan. ',
            actionText: 'Fix contrast now',
            action: () => applyColorPreset('#000000', '#ffffff')
        });
    }
    
    // 2. Data Capacity (25 points)
    if (dataUsage < 50) {
        score += 25;
    } else if (dataUsage < 70) {
        score += 20;
    } else if (dataUsage < 85) {
        score += 15;
        recommendations.push({
            type: 'info',
            icon: 'ℹ️',
            text: 'QR code is getting full. Consider using a URL shortener for longer links.',
            action: null
        });
    } else if (dataUsage < 95) {
        score += 10;
        recommendations.push({
            type: 'warning',
            icon: '⚠️',
            text: 'QR code is very full. Less room for logo and error correction. Use a shorter URL.',
            action: null
        });
    } else {
        score += 5;
        recommendations.push({
            type: 'warning',
            icon: '❌',
            text: 'QR code is almost at capacity! Scanning may be unreliable. Shorten your text.',
            action: null
        });
    }
    
    // 3. Logo Size (20 points)
    const logoSize = selectedLogo ? parseInt(logoSizeRange.value) : 0;
    if (!selectedLogo) {
        score += 20;
    } else if (logoSize >= 15 && logoSize <= 25) {
        score += 20;
    } else if ((logoSize >= 10 && logoSize < 15) || (logoSize > 25 && logoSize <= 30)) {
        score += 15;
    } else if (logoSize > 30 && logoSize <= 35) {
        score += 10;
        recommendations.push({
            type: 'warning',
            icon: '⚠️',
            text: `Logo is ${logoSize}% of QR code. `,
            actionText: 'Reduce to 25% for better reliability',
            action: () => {
                logoSizeRange.value = 25;
                logoSizeValue.textContent = '25';
                generateQRCode();
            }
        });
    } else if (logoSize > 35) {
        score += 5;
        recommendations.push({
            type: 'warning',
            icon: '❌',
            text: `Logo covers ${logoSize}% of code! `,
            actionText: 'Reduce to 25% now',
            action: () => {
                logoSizeRange.value = 25;
                logoSizeValue.textContent = '25';
                generateQRCode();
            }
        });
    }
    
    // 4. Print Size (15 points)
    const printSizeMM = Math.ceil(qrSize / 10); // Rough estimate
    if (printSizeMM > 100) {
        score += 15;
    } else if (printSizeMM >= 50) {
        score += 12;
    } else if (printSizeMM >= 30) {
        score += 8;
    } else {
        score += 3;
        recommendations.push({
            type: 'info',
            icon: 'ℹ️',
            text: 'Small QR code may be hard to scan. ',
            actionText: 'Increase size to 15',
            action: () => {
                sizeRange.value = 15;
                sizeValue.textContent = '15';
                generateQRCode();
            }
        });
    }
    
    // 5. Style Choice (10 points)
    if (currentQRStyle === 'squares') {
        score += 10;
    } else if (currentQRStyle === 'rounded') {
        score += 8;
    } else {
        score += 6;
        if (logoSize > 30) {
            recommendations.push({
                type: 'info',
                icon: 'ℹ️',
                text: 'Dots style with large logo may affect scanning. ',
                actionText: 'Switch to squares',
                action: () => {
                    document.querySelector('.style-btn[data-style=\"squares\"]').click();
                    generateQRCode();
                }
            });
        }
    }
    
    // Add success message if score is high
    if (score >= 95) {
        recommendations.unshift({
            type: 'success',
            icon: '🎉',
            text: 'Perfect! This QR code will scan reliably in any conditions.',
            action: null
        });
    } else if (score >= 85) {
        recommendations.unshift({
            type: 'success',
            icon: '✅',
            text: 'Excellent QR code! Very reliable scanning expected.',
            action: null
        });
    }
    
    // Display score
    displayQualityScore(score, recommendations);
}

// Display Quality Score UI
function displayQualityScore(score, recommendations) {
    const scoreSection = document.getElementById('qualityScore');
    const scoreBar = document.getElementById('scoreBar');
    const scoreValue = document.getElementById('scoreValue');
    const scoreRating = document.getElementById('scoreRating');
    const recommendationsDiv = document.getElementById('recommendations');
    
    // Show section
    scoreSection.style.display = 'block';
    
    // Update score bar
    scoreBar.style.width = score + '%';
    scoreValue.textContent = score;
    
    // Determine rating class and text
    let ratingClass = '';
    let ratingText = '';
    if (score >= 95) {
        ratingClass = 'perfect';
        ratingText = '⭐⭐⭐⭐⭐ Perfect';
    } else if (score >= 85) {
        ratingClass = 'excellent';
        ratingText = '⭐⭐⭐⭐☆ Excellent';
    } else if (score >= 70) {
        ratingClass = 'good';
        ratingText = '⭐⭐⭐☆☆ Good';
    } else if (score >= 50) {
        ratingClass = 'fair';
        ratingText = '⭐⭐☆☆☆ Fair';
    } else {
        ratingClass = 'poor';
        ratingText = '⭐☆☆☆☆ Poor';
    }
    
    scoreBar.className = 'score-bar ' + ratingClass;
    scoreRating.textContent = ratingText;
    
    // Build recommendations HTML
    if (recommendations.length === 0) {
        recommendationsDiv.innerHTML = '<div class="recommendation-item success"><span class="recommendation-icon">✅</span><span class="recommendation-text">No issues found!</span></div>';
    } else {
        recommendationsDiv.innerHTML = recommendations.map(rec => {
            const actionHTML = rec.action 
                ? `<span class="recommendation-action">${rec.actionText}</span>`
                : '';
            
            return `
                <div class="recommendation-item ${rec.type}">
                    <span class="recommendation-icon">${rec.icon}</span>
                    <span class="recommendation-text">
                        ${rec.text}${actionHTML}
                    </span>
                </div>
            `;
        }).join('');
        
        // Attach click handlers to actions
        recommendationsDiv.querySelectorAll('.recommendation-action').forEach((el, index) => {
            const rec = recommendations.filter(r => r.action)[index];
            if (rec && rec.action) {
                el.addEventListener('click', rec.action);
            }
        });
    }
}

// Helper function to apply color preset
function applyColorPreset(dark, light) {
    darkColorPicker.value = dark;
    lightColorPicker.value = light;
    darkColorText.value = dark;
    lightColorText.value = light;
    currentDarkColor = dark;
    currentLightColor = light;
    
    // Update preset button states
    colorPresets.forEach(btn => {
        if (btn.dataset.dark === dark && btn.dataset.light === light) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Regenerate QR code
    generateQRCode();
}

// Apply QR code style (dots or rounded)
function applyQRStyle(ctx, qrSize) {
    const imageData = ctx.getImageData(0, 0, qrSize, qrSize);
    const data = imageData.data;
    
    // Create a new canvas for the styled QR code
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = qrSize;
    tempCanvas.height = qrSize;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Fill with background color
    tempCtx.fillStyle = currentLightColor;
    tempCtx.fillRect(0, 0, qrSize, qrSize);
    
    // Detect module size more accurately
    // QR codes are always odd-sized (21, 25, 29, 33, etc.)
    let moduleSize = Math.round(qrSize / 33); // Default estimate
    
    // Better detection: scan for transitions from light to dark
    let transitionCount = 0;
    for (let x = 0; x < qrSize - 1; x++) {
        const i1 = (0 * qrSize + x) * 4;
        const i2 = (0 * qrSize + x + 1) * 4;
        const bright1 = (data[i1] + data[i1 + 1] + data[i1 + 2]) / 3;
        const bright2 = (data[i2] + data[i2 + 1] + data[i2 + 2]) / 3;
        if (Math.abs(bright1 - bright2) > 100) {
            transitionCount++;
        }
    }
    
    // Estimate module size from transitions (QR codes typically have 21-177 modules)
    if (transitionCount > 0) {
        const estimatedModules = transitionCount * 2; // Approximate
        if (estimatedModules >= 21 && estimatedModules <= 177) {
            moduleSize = Math.round(qrSize / estimatedModules);
        }
    }
    
    // Ensure module size is at least 1 and makes sense
    moduleSize = Math.max(1, Math.min(moduleSize, Math.floor(qrSize / 21)));
    
    tempCtx.fillStyle = currentDarkColor;
    
    // Draw styled modules
    for (let y = 0; y < qrSize; y += moduleSize) {
        for (let x = 0; x < qrSize; x += moduleSize) {
            const i = (y * qrSize + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // Check if this pixel is dark (part of QR code)
            const isDark = (r + g + b) / 3 < 128;
            
            if (isDark) {
                if (currentQRStyle === 'dots') {
                    // Draw circle
                    tempCtx.beginPath();
                    tempCtx.arc(
                        x + moduleSize / 2,
                        y + moduleSize / 2,
                        moduleSize / 2.2,
                        0,
                        Math.PI * 2
                    );
                    tempCtx.fill();
                } else if (currentQRStyle === 'rounded') {
                    // Draw rounded rectangle (with fallback for older browsers)
                    const radius = moduleSize / 4;
                    if (typeof tempCtx.roundRect === 'function') {
                        tempCtx.beginPath();
                        tempCtx.roundRect(x, y, moduleSize, moduleSize, radius);
                        tempCtx.fill();
                    } else {
                        // Fallback: draw regular rectangle
                        tempCtx.fillRect(x, y, moduleSize, moduleSize);
                    }
                }
            }
        }
    }
    
    // Draw the styled version back to the main canvas
    ctx.clearRect(0, 0, qrSize, qrSize);
    ctx.drawImage(tempCanvas, 0, 0);
}

// Download QR Code as PNG
downloadPngBtn.addEventListener('click', () => {
    if (!currentQRDataURL) {
        alert('Please generate a QR code first!');
        return;
    }
    
    const link = document.createElement('a');
    link.download = 'qr-code.png';
    link.href = currentQRDataURL;
    link.click();
    
    // Track download
    if (typeof gtag !== 'undefined') {
        gtag('event', 'download', {
            'format': 'PNG'
        });
    }
    
    showNotification('QR Code downloaded as PNG!');
});

// Download QR Code as SVG
downloadSvgBtn.addEventListener('click', () => {
    if (!currentQRDataURL) {
        alert('Please generate a QR code first!');
        return;
    }
    
    // Convert canvas to SVG
    const svg = canvasToSVG();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.download = 'qr-code.svg';
    link.href = url;
    link.click();
    
    URL.revokeObjectURL(url);
    
    // Track download
    if (typeof gtag !== 'undefined') {
        gtag('event', 'download', {
            'format': 'SVG'
        });
    }
    
    showNotification('QR Code downloaded as SVG!');
});

// Download QR Code as JPG
downloadJpgBtn.addEventListener('click', () => {
    if (!currentQRDataURL) {
        alert('Please generate a QR code first!');
        return;
    }
    
    // Convert PNG to JPG (with white background)
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = qrCanvas.width;
        canvas.height = qrCanvas.height;
        const ctx = canvas.getContext('2d');
        
        // Fill white background (JPG doesn't support transparency)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        
        const link = document.createElement('a');
        link.download = 'qr-code.jpg';
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.click();
        
        // Track download
        if (typeof gtag !== 'undefined') {
            gtag('event', 'download', {
                'format': 'JPG'
            });
        }
        
        showNotification('QR Code downloaded as JPG!');
    };
    img.src = currentQRDataURL;
});

// Helper function to convert canvas to SVG
function canvasToSVG() {
    const canvas = qrCanvas;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">`;
    
    // Add white background
    svg += `<rect width="${canvas.width}" height="${canvas.height}" fill="white"/>`;
    
    // Convert pixels to rectangles (simplified approach)
    const pixelSize = 1;
    for (let y = 0; y < canvas.height; y += pixelSize) {
        for (let x = 0; x < canvas.width; x += pixelSize) {
            const i = (y * canvas.width + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3] / 255;
            
            // Only draw non-white pixels
            if (r < 250 || g < 250 || b < 250) {
                const color = `rgba(${r},${g},${b},${a})`;
                svg += `<rect x="${x}" y="${y}" width="${pixelSize}" height="${pixelSize}" fill="${color}"/>`;
            }
        }
    }
    
    svg += '</svg>';
    return svg;
}

// Clear all
clearBtn.addEventListener('click', () => {
    textInput.value = '';
    selectedLogo = null;
    logoInput.value = '';
    logoStatus.textContent = 'No logo selected';
    logoStatus.style.color = '#888';
    sizeRange.value = 10;
    borderRange.value = 2;
    logoSizeRange.value = 25;
    sizeValue.textContent = '10';
    borderValue.textContent = '2';
    logoSizeValue.textContent = '25';
    
    const ctx = qrCanvas.getContext('2d');
    ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
    qrCanvas.classList.remove('visible');
    previewPlaceholder.classList.remove('hidden');
    currentQRDataURL = null;
});

// Notification helper
function showNotification(message) {
    // Simple alert for now - you can make this fancier with a custom notification
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 2000);
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
